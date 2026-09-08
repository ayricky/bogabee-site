CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  starts_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS traffic (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pageview', 'instagram_click')),
  path TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traffic_day ON traffic(day);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
