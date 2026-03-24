const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
if (DATABASE_URL) {
  const isInternal = DATABASE_URL.includes('.railway.internal');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: isInternal ? false : { rejectUnauthorized: false },
  });
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sprints (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  target_end  TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'complete'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id                SERIAL PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  category          TEXT NOT NULL DEFAULT 'improvement'
    CHECK (category IN ('ui', 'backend', 'new-feature', 'improvement')),
  status            TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','in_progress','on_staging','review','approved','complete')),
  priority          INTEGER NOT NULL DEFAULT 3
    CHECK (priority BETWEEN 1 AND 5),
  override_priority BOOLEAN NOT NULL DEFAULT FALSE,
  assignee          TEXT,
  branch            TEXT,
  sprint_id         INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
  created_by        TEXT NOT NULL DEFAULT 'system',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author     TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS files (
  id             SERIAL PRIMARY KEY,
  task_id        INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename       TEXT NOT NULL,
  url_or_content TEXT NOT NULL,
  uploaded_by    TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  actor      TEXT NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender      TEXT NOT NULL,
  recipient   TEXT NOT NULL,
  content     TEXT NOT NULL,
  thread_id   TEXT,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint    ON tasks(sprint_id);
CREATE INDEX IF NOT EXISTS idx_tasks_category  ON tasks(category);
CREATE INDEX IF NOT EXISTS idx_activity_task   ON activity_log(task_id);
CREATE INDEX IF NOT EXISTS idx_activity_time   ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_task   ON comments(task_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient, read);
CREATE INDEX IF NOT EXISTS idx_messages_thread    ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_time      ON messages(created_at DESC);
`;

async function query(text, params) {
  if (!pool) {
    const err = new Error("DATABASE_URL not set");
    err.code = "DB_UNAVAILABLE";
    throw err;
  }
  const result = await pool.query(text, params);
  return result;
}

async function initSchema() {
  if (!pool) {
    console.warn("WARNING: DATABASE_URL not set — database features disabled");
    return;
  }
  try {
    await pool.query(INIT_SQL);
    console.log("Database schema initialized");
  } catch (err) {
    console.error("Schema init failed:", err.message);
    console.error("DATABASE_URL prefix:", DATABASE_URL ? DATABASE_URL.substring(0, 30) + "..." : "NOT SET");
    throw err;
  }
}

module.exports = { query, initSchema };
