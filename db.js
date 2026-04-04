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

CREATE TABLE IF NOT EXISTS channels (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  members     JSONB NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id          SERIAL PRIMARY KEY,
  sender      TEXT NOT NULL,
  recipient   TEXT,
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
CREATE INDEX IF NOT EXISTS idx_channels_members   ON channels USING GIN(members);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, username)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(username);

CREATE TABLE IF NOT EXISTS services (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  payment_method TEXT,
  monthly_cost   TEXT,
  balance        TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  billing_url    TEXT,
  logo_url       TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_status   ON services(status);

CREATE TABLE IF NOT EXISTS usage_reports (
  id SERIAL PRIMARY KEY,
  agent VARCHAR(50) NOT NULL,
  session_id VARCHAR(100),
  model VARCHAR(50),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  cost_usd NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Clean duplicates before creating unique index
DELETE FROM usage_reports a USING usage_reports b WHERE a.id < b.id AND a.session_id IS NOT NULL AND a.session_id = b.session_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_session ON usage_reports(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage_reports(agent);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS teams_plan_tracking (
  id SERIAL PRIMARY KEY,
  month VARCHAR(7) NOT NULL,
  spend_limit NUMERIC(10,2) DEFAULT 1000,
  validated_spend NUMERIC(10,2),
  validated_at TIMESTAMPTZ,
  seats INTEGER DEFAULT 2,
  reset_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teams_plan_month ON teams_plan_tracking(month);
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

const MIGRATIONS = [
  // Add channel_id to existing messages table (v2 upgrade)
  `ALTER TABLE messages ADD COLUMN IF NOT EXISTS channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL`,
  // Make recipient nullable (channels don't need a recipient)
  `ALTER TABLE messages ALTER COLUMN recipient DROP NOT NULL`,
  // Index for channel messages
  `CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id)`,
  // Seed services table with known services (idempotent — only inserts if table is empty)
  `INSERT INTO services (name, category, status, notes)
   SELECT * FROM (VALUES
     ('Replit', 'Infrastructure', 'active', NULL),
     ('Claude Code Teams', 'AI/Dev Tools', 'active', 'Plus extra usage'),
     ('ElevenLabs', 'Narration/Music', 'active', NULL),
     ('Runway', 'Video Gen', 'active', NULL),
     ('OpenAI', 'AI/Dev Tools', 'active', NULL),
     ('Veo (Google)', 'Video Gen', 'active', NULL),
     ('Gemini (Google)', 'AI/Dev Tools', 'active', NULL),
     ('Suno', 'Narration/Music', 'active', NULL),
     ('Higgsfield', 'Video Gen', 'active', NULL),
     ('Railway', 'Infrastructure', 'active', NULL),
     ('DistroKid', 'Distribution', 'active', NULL),
     ('Meta (Facebook Ads)', 'Distribution', 'active', 'Ferron ad spend'),
     ('DALL-E (OpenAI)', 'Image Gen', 'active', NULL),
     ('Flux', 'Image Gen', 'active', NULL),
     ('Midjourney', 'Image Gen', 'unknown', 'Confirm if active'),
     ('Ideogram', 'Image Gen', 'unknown', 'Confirm if active'),
     ('GitHub', 'Infrastructure', 'active', NULL),
     ('Anthropic API', 'AI/Dev Tools', 'active', 'Separate from Claude Code Teams. Powers Slack bots (Titus, Atlas, Socrates)')
   ) AS seed(name, category, status, notes)
   WHERE NOT EXISTS (SELECT 1 FROM services LIMIT 1)`,
  // Usage dashboard: add seat + cache_savings columns
  `ALTER TABLE usage_reports ADD COLUMN IF NOT EXISTS seat VARCHAR(20) DEFAULT 'unknown'`,
  `ALTER TABLE usage_reports ADD COLUMN IF NOT EXISTS cache_savings_usd NUMERIC(10,4) DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_usage_seat ON usage_reports(seat)`,
  // Backfill seat from agent name
  `UPDATE usage_reports SET seat = 'will' WHERE (seat IS NULL OR seat = 'unknown') AND LOWER(agent) IN ('titus', 'davinci')`,
  `UPDATE usage_reports SET seat = 'mike' WHERE (seat IS NULL OR seat = 'unknown') AND LOWER(agent) IN ('socrates', 'atlas', 'forge', 'kubrick')`,
  // Recalculate all costs with correct cache pricing (cache_create at discounted rate, not full input)
  `UPDATE usage_reports SET
    cost_usd = ROUND(
      (COALESCE(input_tokens, 0)::numeric / 1000000) * CASE WHEN LOWER(model) LIKE '%opus%' THEN 15 WHEN LOWER(model) LIKE '%haiku%' THEN 0.80 ELSE 3 END
      + (COALESCE(output_tokens, 0)::numeric / 1000000) * CASE WHEN LOWER(model) LIKE '%opus%' THEN 75 WHEN LOWER(model) LIKE '%haiku%' THEN 4 ELSE 15 END
      + (COALESCE(cache_creation_tokens, 0)::numeric / 1000000) * CASE WHEN LOWER(model) LIKE '%opus%' THEN 3.75 WHEN LOWER(model) LIKE '%haiku%' THEN 0.20 ELSE 0.75 END
      + (COALESCE(cache_read_tokens, 0)::numeric / 1000000) * CASE WHEN LOWER(model) LIKE '%opus%' THEN 1.50 WHEN LOWER(model) LIKE '%haiku%' THEN 0.08 ELSE 0.30 END
    , 4),
    cache_savings_usd = ROUND(
      (COALESCE(cache_creation_tokens, 0)::numeric / 1000000) * (CASE WHEN LOWER(model) LIKE '%opus%' THEN 15 ELSE 3 END - CASE WHEN LOWER(model) LIKE '%opus%' THEN 3.75 ELSE 0.75 END)
      + (COALESCE(cache_read_tokens, 0)::numeric / 1000000) * (CASE WHEN LOWER(model) LIKE '%opus%' THEN 15 ELSE 3 END - CASE WHEN LOWER(model) LIKE '%opus%' THEN 1.50 ELSE 0.30 END)
    , 4)`,
  // Calibration settings for usage dashboard
  `CREATE TABLE IF NOT EXISTS usage_calibration (
    id SERIAL PRIMARY KEY,
    plan_type VARCHAR(20) DEFAULT 'team',
    session_budget NUMERIC(10,2) DEFAULT 27.00,
    weekly_budget NUMERIC(10,2) DEFAULT 10.00,
    overage_cap NUMERIC(10,2) DEFAULT 1000.00,
    reset_day VARCHAR(10) DEFAULT 'monday',
    reset_hour INTEGER DEFAULT 14,
    timezone VARCHAR(50) DEFAULT 'America/Los_Angeles',
    session_correction_factor NUMERIC(8,4) DEFAULT 1.0000,
    weekly_correction_factor NUMERIC(8,4) DEFAULT 1.0000,
    last_session_pct NUMERIC(5,2),
    last_weekly_pct NUMERIC(5,2),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `INSERT INTO usage_calibration (plan_type) SELECT 'team' WHERE NOT EXISTS (SELECT 1 FROM usage_calibration LIMIT 1)`,
  // Per-seat Anthropic actual billing columns
  `ALTER TABLE usage_calibration ADD COLUMN IF NOT EXISTS will_seat_actual NUMERIC(10,2)`,
  `ALTER TABLE usage_calibration ADD COLUMN IF NOT EXISTS mike_seat_actual NUMERIC(10,2)`,
  `ALTER TABLE usage_calibration ADD COLUMN IF NOT EXISTS seat_actual_month VARCHAR(7)`,
];

async function initSchema() {
  if (!pool) {
    console.warn("WARNING: DATABASE_URL not set — database features disabled");
    return;
  }
  try {
    await pool.query(INIT_SQL);
    console.log("Database schema initialized");
    // Run migrations for existing databases
    for (const sql of MIGRATIONS) {
      try { await pool.query(sql); } catch (e) { /* column may already exist */ }
    }
    console.log("Migrations complete");
  } catch (err) {
    console.error("Schema init failed:", err.message);
    console.error("DATABASE_URL prefix:", DATABASE_URL ? DATABASE_URL.substring(0, 30) + "..." : "NOT SET");
    throw err;
  }
}

module.exports = { query, initSchema };
