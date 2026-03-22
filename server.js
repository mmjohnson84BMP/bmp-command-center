const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO_OWNER = process.env.REPO_OWNER || "mmjohnson84BMP";
const REPO_NAME = process.env.REPO_NAME || "flowstackclaude";
const STATUS_FILE = process.env.STATUS_FILE || "SOCRATES_STATUS.json";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

// API keys per agent — set these in Railway env vars
const API_KEYS = {
  atlas: process.env.ATLAS_API_KEY || "",
  titus: process.env.TITUS_API_KEY || "",
  socrates: process.env.SOCRATES_API_KEY || "",
};

// SQLite — persists to /data/monitor.db on Railway with a volume, falls back to local file
let db;
try {
  db = new Database(process.env.DB_PATH || "/data/monitor.db");
} catch {
  db = new Database("monitor.db");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'queued',
    priority TEXT DEFAULT 'medium',
    assigned_to TEXT DEFAULT 'socrates',
    created_by TEXT DEFAULT 'unknown',
    sprint_item_id INTEGER,
    branch TEXT,
    pr_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS sprint_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const validKeys = Object.values(API_KEYS).filter(Boolean);
  // If no keys are configured yet, allow all (open during setup)
  if (!validKeys.length) {
    req.caller = "unknown";
    return next();
  }
  if (validKeys.includes(token)) {
    req.caller = Object.entries(API_KEYS).find(([, v]) => v === token)?.[0] || "unknown";
    return next();
  }
  return res.status(401).json({ error: "unauthorized" });
}

// ── Slack notification helper ────────────────────────────────────────────────
async function notifySlack(message) {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (e) {
    console.error("Slack notification failed:", e.message);
  }
}

// ── GET /api/status — backward compat (DB first, GitHub fallback) ────────────
app.get("/api/status", async (req, res) => {
  const row = db.prepare("SELECT data FROM sprint_status WHERE id = 1").get();
  if (row) {
    try { return res.json(JSON.parse(row.data)); } catch {}
  }
  // GitHub fallback (transition period — until Socrates writes directly to Monitor)
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${STATUS_FILE}`;
    const headers = { Accept: "application/vnd.github.v3.raw", "User-Agent": "socrates-monitor" };
    if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;
    const response = await fetch(url, { headers });
    if (response.status === 404) return res.json({ error: "not_found" });
    if (!response.ok) return res.status(response.status).json({ error: "github_error" });
    return res.json(await response.json());
  } catch (error) {
    return res.status(500).json({ error: "fetch_error", message: error.message });
  }
});

// ── POST /api/status — Socrates updates sprint status ───────────────────────
app.post("/api/status", requireAuth, (req, res) => {
  const data = req.body;
  if (!data || typeof data !== "object") return res.status(400).json({ error: "invalid_body" });
  data.last_updated = new Date().toISOString();
  const json = JSON.stringify(data);
  db.prepare(`
    INSERT INTO sprint_status (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(json, data.last_updated);
  res.json({ ok: true });
});

// ── GET /api/tasks — list tasks (filterable) ─────────────────────────────────
app.get("/api/tasks", requireAuth, (req, res) => {
  const { assigned_to, status, priority } = req.query;
  let query = "SELECT * FROM tasks WHERE 1=1";
  const params = [];
  if (assigned_to) { query += " AND assigned_to = ?"; params.push(assigned_to); }
  if (status) {
    const statuses = status.split(",");
    query += ` AND status IN (${statuses.map(() => "?").join(",")})`;
    params.push(...statuses);
  }
  if (priority) { query += " AND priority = ?"; params.push(priority); }
  query += ` ORDER BY
    CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
    CASE status WHEN 'in_progress' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
    created_at ASC`;
  const tasks = db.prepare(query).all(...params);
  res.json(tasks.map(t => ({ ...t, notes: JSON.parse(t.notes || "[]") })));
});

// ── GET /api/tasks/:id — single task ─────────────────────────────────────────
app.get("/api/tasks/:id", requireAuth, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "not_found" });
  res.json({ ...task, notes: JSON.parse(task.notes || "[]") });
});

// ── POST /api/tasks — create task ────────────────────────────────────────────
app.post("/api/tasks", requireAuth, async (req, res) => {
  const { title, description = "", priority = "medium", assigned_to = "socrates", sprint_item_id } = req.body;
  if (!title) return res.status(400).json({ error: "title_required" });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, assigned_to, created_by, sprint_item_id, created_at, updated_at, notes)
    VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, '[]')
  `).run(id, title, description, priority, assigned_to, req.caller, sprint_item_id || null, now, now);
  const priorityEmoji = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" }[priority] || "⚪";
  await notifySlack(`${priorityEmoji} *New task assigned to ${assigned_to}*\n*${title}*${description ? `\n${description}` : ""}`);
  res.status(201).json({ id, title, description, status: "queued", priority, assigned_to, created_by: req.caller, notes: [] });
});

// ── PATCH /api/tasks/:id — update task ───────────────────────────────────────
app.patch("/api/tasks/:id", requireAuth, async (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "not_found" });
  const { status, priority, assigned_to, branch, pr_url, notes: newNote } = req.body;
  const existingNotes = JSON.parse(task.notes || "[]");
  if (newNote) {
    const noteText = Array.isArray(newNote) ? newNote[0] : newNote;
    existingNotes.push(`[${new Date().toISOString()}] ${noteText}`);
  }
  const updatedStatus = status || task.status;
  db.prepare(`
    UPDATE tasks SET
      status = ?, priority = ?, assigned_to = ?, branch = ?, pr_url = ?,
      notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    updatedStatus,
    priority || task.priority,
    assigned_to || task.assigned_to,
    branch !== undefined ? branch : task.branch,
    pr_url !== undefined ? pr_url : task.pr_url,
    JSON.stringify(existingNotes),
    new Date().toISOString(),
    task.id
  );
  // Notify Slack on meaningful status transitions
  if (status && status !== task.status && ["complete", "blocked"].includes(status)) {
    const emoji = status === "complete" ? "✅" : "🚧";
    await notifySlack(`${emoji} *${task.title}* — ${status}${pr_url ? `\nPR: ${pr_url}` : ""}`);
  }
  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);
  res.json({ ...updated, notes: JSON.parse(updated.notes || "[]") });
});

// ── DELETE /api/tasks/:id — cancel task ──────────────────────────────────────
app.delete("/api/tasks/:id", requireAuth, (req, res) => {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.id);
  if (!task) return res.status(404).json({ error: "not_found" });
  db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), task.id);
  res.json({ ok: true });
});

app.get("/health", (req, res) => res.send("ok"));

app.listen(PORT, () => {
  console.log(`Socrates Monitor v2 live on port ${PORT}`);
});
