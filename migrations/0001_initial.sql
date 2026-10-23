-- Brotime Attendance Tribunal: initial Cloudflare D1 schema.
-- Season 1 starts empty. Do not import legacy Discord records into live rows.
-- If old Discord data is imported later, keep it in closed seasons with imported=1.

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0 CHECK (closed IN (0, 1)),
  imported INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1)),
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT,
  CHECK (is_current = 0 OR (closed = 0 AND imported = 0)),
  CHECK (imported = 0 OR (closed = 1 AND is_current = 0))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_current_live
  ON seasons (is_current)
  WHERE is_current = 1 AND imported = 0;

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS app_users (
  discord_id TEXT PRIMARY KEY,
  member_id TEXT UNIQUE REFERENCES members(id) ON DELETE SET NULL,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS gatherings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  date TEXT NOT NULL
    CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  activity TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(activity)) > 0),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by_discord_id TEXT,
  UNIQUE (season_id, date, activity)
);

CREATE TABLE IF NOT EXISTS attendance (
  gathering_id INTEGER NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  present INTEGER NOT NULL CHECK (present IN (0, 1)),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recorded_by_discord_id TEXT,
  PRIMARY KEY (gathering_id, member_id)
);

CREATE TABLE IF NOT EXISTS beer_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE RESTRICT,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
  paid_on TEXT NOT NULL
    CHECK (paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  recorded_by_discord_id TEXT,
  reversed_at TEXT,
  reversed_by_discord_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_gatherings_season_date
  ON gatherings (season_id, date, id);

CREATE INDEX IF NOT EXISTS idx_attendance_member_gathering
  ON attendance (member_id, gathering_id);

CREATE INDEX IF NOT EXISTS idx_beer_payments_member_season
  ON beer_payments (member_id, season_id, paid_on, id);

INSERT OR IGNORE INTO seasons (id, name, closed, imported, is_current)
VALUES (1, 'Season 1', 0, 0, 1);

INSERT OR IGNORE INTO members (id, name, sort_order, is_active) VALUES
  ('s', 'Sterling', 1, 1),
  ('a', 'Adam', 2, 1),
  ('j', 'Julian', 3, 1),
  ('n', 'Nathan', 4, 1),
  ('i', 'Isaiah', 5, 1);
