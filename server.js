const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const REPO_OWNER = process.env.REPO_OWNER || "mmjohnson84BMP";
const REPO_NAME = process.env.REPO_NAME || "flowstackclaude";
const STATUS_FILE = process.env.STATUS_FILE || "SOCRATES_STATUS.json";

const API_KEYS = {
  [process.env.TITUS_API_KEY]: "titus",
  [process.env.ATLAS_API_KEY]: "atlas",
  [process.env.SOCRATES_API_KEY]: "socrates",
};

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function apiKeyAuth(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key) { req.actor = "browser"; return next(); }
  const actor = API_KEYS[key];
  if (!actor) return res.status(401).json({ error: "invalid_api_key" });
  req.actor = actor;
  next();
}

app.use("/api", apiKeyAuth);

function logActivity(taskId, action, actor, details) {
  db.query("INSERT INTO activity_log (task_id, action, actor, details) VALUES ($1, $2, $3, $4)",
    [taskId, action, actor, details ? JSON.stringify(details) : null]
  ).catch((err) => console.error("Activity log error:", err.message));
}

async function fetchGitHubStatus() {
  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${STATUS_FILE}`;
    const headers = { Accept: "application/vnd.github.v3.raw", "User-Agent": "socrates-monitor" };
    if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;
    const response = await fetch(url, { headers });
    if (response.status === 404) return { error: "not_found" };
    if (!response.ok) return { error: "github_error", status: response.status };
    return await response.json();
  } catch (err) { return { error: "fetch_error", message: err.message }; }
}

app.get("/api/status", async (req, res) => {
  const data = await fetchGitHubStatus();
  if (data.error === "github_error") return res.status(data.status).json(data);
  res.json(data);
});

app.get("/api/overview", async (req, res) => {
  try {
    const sprintRes = await db.query("SELECT * FROM sprints WHERE status = 'active' ORDER BY started_at DESC LIMIT 1");
    const activeSprint = sprintRes.rows[0] || null;
    let taskCounts = null, inProgress = [], completedToday = [];
    if (activeSprint) {
      const allTasks = await db.query("SELECT id, title, category, status, priority, override_priority, assignee, branch, updated_at FROM tasks WHERE sprint_id = $1 ORDER BY priority ASC, created_at ASC", [activeSprint.id]);
      const tasks = allTasks.rows;
      const byCategory = {};
      for (const t of tasks) {
        if (!byCategory[t.category]) byCategory[t.category] = { total: 0, complete: 0 };
        byCategory[t.category].total++;
        if (t.status === "complete") byCategory[t.category].complete++;
      }
      taskCounts = { total: tasks.length, complete: tasks.filter(t => t.status === "complete").length, in_progress: tasks.filter(t => t.status === "in_progress").length, on_staging: tasks.filter(t => t.status === "on_staging").length, queued: tasks.filter(t => t.status === "queued").length, by_category: byCategory };
      inProgress = tasks.filter(t => ["in_progress", "on_staging", "review"].includes(t.status));
      completedToday = tasks.filter(t => t.status === "complete" && new Date(t.updated_at).toDateString() === new Date().toDateString());
    }
    const socratesStatus = await fetchGitHubStatus();
    res.json({ active_sprint: activeSprint ? { ...activeSprint, task_counts: taskCounts } : null, completed_today: completedToday, in_progress: inProgress, socrates_status: socratesStatus.error ? null : socratesStatus });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    console.error("Overview error:", err);
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/api/tasks", async (req, res) => {
  try {
    const conditions = [], params = []; let i = 1;
    if (req.query.status) { conditions.push(`status = $${i++}`); params.push(req.query.status); }
    if (req.query.category) { conditions.push(`category = $${i++}`); params.push(req.query.category); }
    if (req.query.sprint_id) { conditions.push(`sprint_id = $${i++}`); params.push(req.query.sprint_id); }
    if (req.query.assignee) { conditions.push(`assignee = $${i++}`); params.push(req.query.assignee); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const result = await db.query(`SELECT * FROM tasks ${where} ORDER BY override_priority DESC, priority ASC, created_at ASC`, params);
    res.json({ tasks: result.rows });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const { title, description, category, priority, assignee, branch, sprint_id } = req.body;
    if (!title || !category) return res.status(400).json({ error: "missing_fields", message: "title and category required" });
    const result = await db.query(`INSERT INTO tasks (title, description, category, priority, assignee, branch, sprint_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [title, description || null, category, priority || 3, assignee || null, branch || null, sprint_id || null, req.actor]);
    logActivity(result.rows[0].id, "task_created", req.actor, { title, category });
    res.status(201).json({ task: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    if (err.code === "23514") return res.status(400).json({ error: "invalid_value", message: err.message });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/api/tasks/:id", async (req, res) => {
  try {
    const taskRes = await db.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    if (!taskRes.rows.length) return res.status(404).json({ error: "not_found" });
    const commentsRes = await db.query("SELECT * FROM comments WHERE task_id = $1 ORDER BY created_at ASC", [req.params.id]);
    const filesRes = await db.query("SELECT * FROM files WHERE task_id = $1 ORDER BY created_at ASC", [req.params.id]);
    res.json({ task: taskRes.rows[0], comments: commentsRes.rows, files: filesRes.rows });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.patch("/api/tasks/:id", async (req, res) => {
  try {
    const allowed = ["title", "description", "category", "status", "priority", "override_priority", "assignee", "branch", "sprint_id"];
    const sets = [], params = []; let i = 1;
    const oldRes = await db.query("SELECT * FROM tasks WHERE id = $1", [req.params.id]);
    if (!oldRes.rows.length) return res.status(404).json({ error: "not_found" });
    const old = oldRes.rows[0];
    for (const key of allowed) { if (req.body[key] !== undefined) { sets.push(`${key} = $${i++}`); params.push(req.body[key]); } }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    sets.push(`updated_at = NOW()`); params.push(req.params.id);
    const result = await db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, params);
    const changes = {};
    for (const key of allowed) { if (req.body[key] !== undefined && String(old[key]) !== String(req.body[key])) changes[key] = { from: old[key], to: req.body[key] }; }
    if (Object.keys(changes).length) logActivity(result.rows[0].id, "task_updated", req.actor, changes);
    res.json({ task: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    if (err.code === "23514") return res.status(400).json({ error: "invalid_value", message: err.message });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.delete("/api/tasks/:id", async (req, res) => {
  try {
    const result = await db.query("DELETE FROM tasks WHERE id = $1", [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: "not_found" });
    logActivity(null, "task_deleted", req.actor, { task_id: req.params.id });
    res.status(204).send();
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.post("/api/tasks/:id/comments", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: "missing_fields", message: "content required" });
    const author = req.body.author || req.actor;
    const taskCheck = await db.query("SELECT id FROM tasks WHERE id = $1", [req.params.id]);
    if (!taskCheck.rows.length) return res.status(404).json({ error: "task_not_found" });
    const result = await db.query("INSERT INTO comments (task_id, author, content) VALUES ($1, $2, $3) RETURNING *", [req.params.id, author, content]);
    logActivity(parseInt(req.params.id), "comment_added", author, { preview: content.slice(0, 100) });
    res.status(201).json({ comment: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.post("/api/tasks/:id/files", async (req, res) => {
  try {
    const { filename, url_or_content } = req.body;
    if (!filename || !url_or_content) return res.status(400).json({ error: "missing_fields", message: "filename and url_or_content required" });
    const uploaded_by = req.body.uploaded_by || req.actor;
    const taskCheck = await db.query("SELECT id FROM tasks WHERE id = $1", [req.params.id]);
    if (!taskCheck.rows.length) return res.status(404).json({ error: "task_not_found" });
    const result = await db.query("INSERT INTO files (task_id, filename, url_or_content, uploaded_by) VALUES ($1, $2, $3, $4) RETURNING *", [req.params.id, filename, url_or_content, uploaded_by]);
    logActivity(parseInt(req.params.id), "file_attached", uploaded_by, { filename });
    res.status(201).json({ file: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

// ── Messages ──

app.post("/api/messages", async (req, res) => {
  try {
    const { recipient, content, thread_id } = req.body;
    if (!recipient || !content) return res.status(400).json({ error: "missing_fields", message: "recipient and content required" });
    const sender = req.actor;
    const result = await db.query(
      "INSERT INTO messages (sender, recipient, content, thread_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [sender, recipient, content, thread_id || null]
    );
    logActivity(null, "message_sent", sender, { recipient, thread_id, preview: content.slice(0, 100) });
    res.status(201).json({ message: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/api/messages", async (req, res) => {
  try {
    const conditions = [], params = []; let i = 1;
    if (req.query.to) { conditions.push(`recipient = $${i++}`); params.push(req.query.to); }
    if (req.query.from) { conditions.push(`sender = $${i++}`); params.push(req.query.from); }
    if (req.query.unread === "true") { conditions.push(`read = FALSE`); }
    if (req.query.thread_id) { conditions.push(`thread_id = $${i++}`); params.push(req.query.thread_id); }
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    params.push(limit);
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const result = await db.query(`SELECT * FROM messages ${where} ORDER BY created_at ASC LIMIT $${i}`, params);
    res.json({ messages: result.rows });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

// Bulk mark read — must come before the parameterized :id route
app.patch("/api/messages/read", async (req, res) => {
  try {
    const { ids, thread_id } = req.body;
    let result;
    if (thread_id) {
      result = await db.query("UPDATE messages SET read = TRUE WHERE thread_id = $1", [thread_id]);
    } else if (ids && ids.length) {
      result = await db.query("UPDATE messages SET read = TRUE WHERE id = ANY($1::int[])", [ids]);
    } else {
      return res.status(400).json({ error: "missing_fields", message: "ids or thread_id required" });
    }
    res.json({ updated: result.rowCount });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.patch("/api/messages/:id/read", async (req, res) => {
  try {
    const result = await db.query("UPDATE messages SET read = TRUE WHERE id = $1 RETURNING *", [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ message: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/api/sprints", async (req, res) => {
  try { const result = await db.query("SELECT * FROM sprints ORDER BY started_at DESC"); res.json({ sprints: result.rows }); }
  catch (err) { if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" }); res.status(500).json({ error: "db_error", message: err.message }); }
});

app.post("/api/sprints", async (req, res) => {
  try {
    const { name, target_end } = req.body;
    if (!name) return res.status(400).json({ error: "missing_fields", message: "name required" });
    const result = await db.query("INSERT INTO sprints (name, target_end) VALUES ($1, $2) RETURNING *", [name, target_end || null]);
    logActivity(null, "sprint_created", req.actor, { name });
    res.status(201).json({ sprint: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.patch("/api/sprints/:id", async (req, res) => {
  try {
    const allowed = ["name", "target_end", "status"];
    const sets = [], params = []; let i = 1;
    for (const key of allowed) { if (req.body[key] !== undefined) { sets.push(`${key} = $${i++}`); params.push(req.body[key]); } }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    params.push(req.params.id);
    const result = await db.query(`UPDATE sprints SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, params);
    if (!result.rows.length) return res.status(404).json({ error: "not_found" });
    res.json({ sprint: result.rows[0] });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/api/activity", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const params = [limit];
    const conditions = [];
    if (req.query.task_id) { conditions.push("task_id = $2"); params.push(req.query.task_id); }
    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const result = await db.query(`SELECT a.*, t.title as task_title FROM activity_log a LEFT JOIN tasks t ON a.task_id = t.id ${where} ORDER BY a.created_at DESC LIMIT $1`, params);
    res.json({ activity: result.rows });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE") return res.status(503).json({ error: "database_unavailable" });
    res.status(500).json({ error: "db_error", message: err.message });
  }
});

app.get("/health", (req, res) => res.send("ok"));
app.get("/legacy", (req, res) => res.sendFile(path.join(__dirname, "public", "legacy.html")));

async function boot() {
  await db.initSchema();
  const keys = ["TITUS_API_KEY", "ATLAS_API_KEY", "SOCRATES_API_KEY"];
  for (const k of keys) { if (!process.env[k]) console.warn(`WARNING: ${k} not set`); }
  app.listen(PORT, () => console.log(`BMP Command Center live on port ${PORT}`));
}

boot().catch((err) => { console.error("Boot failed:", err); process.exit(1); });
