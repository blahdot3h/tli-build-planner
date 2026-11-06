-- The public market: what people saw items listed for, and the prices folded from that.
-- Nothing identifies a player: reporter is a salted hash of a random id the planner makes once.

-- One sighting of an item at a price: an Exchange listing read from the log, a price typed into the
-- planner, or a screenshot read on the website. signature: server/cloud/signature.js in the planner
-- (a legendary with its roll buckets, a rare with its Ultimate lines, or a base id).
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  season TEXT NOT NULL,
  signature TEXT NOT NULL,
  family TEXT NOT NULL,
  kind TEXT NOT NULL,              -- legendary | rare | base
  unique_id TEXT,
  base_id TEXT,
  type TEXT,
  name TEXT,
  price REAL NOT NULL,             -- Flame Elementium per unit
  listings INTEGER,                -- how many listings the price was read from (1 for one item)
  source TEXT NOT NULL,            -- exchange | manual | screenshot
  mods TEXT,                       -- JSON: the lines that make the signature, with their rolls
  reporter TEXT NOT NULL,
  seen_at INTEGER NOT NULL,        -- ms since epoch, when the price was seen
  day INTEGER NOT NULL,            -- seen_at / 86400000, so one reporter counts once per item per day
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS obs_once_a_day ON observations (season, signature, reporter, day, source);
CREATE INDEX IF NOT EXISTS obs_recent ON observations (season, seen_at);
CREATE INDEX IF NOT EXISTS obs_family ON observations (season, family, seen_at);

-- Folded prices per exact signature (the hourly cron rebuilds these from the window)
CREATE TABLE IF NOT EXISTS item_prices (
  season TEXT NOT NULL,
  signature TEXT NOT NULL,
  family TEXT NOT NULL,
  kind TEXT NOT NULL,
  unique_id TEXT,
  base_id TEXT,
  type TEXT,
  name TEXT,
  n INTEGER NOT NULL,
  reporters INTEGER NOT NULL,
  min REAL, p10 REAL, p25 REAL, median REAL, p75 REAL, max REAL,
  mods TEXT,
  last_seen INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season, signature)
);
CREATE INDEX IF NOT EXISTS item_prices_family ON item_prices (season, family);
CREATE INDEX IF NOT EXISTS item_prices_name ON item_prices (season, name);

-- Folded prices per family (any roll of a legendary, any rare of a base)
CREATE TABLE IF NOT EXISTS family_prices (
  season TEXT NOT NULL,
  family TEXT NOT NULL,
  kind TEXT NOT NULL,
  unique_id TEXT,
  base_id TEXT,
  type TEXT,
  name TEXT,
  n INTEGER NOT NULL,
  reporters INTEGER NOT NULL,
  min REAL, p10 REAL, p25 REAL, median REAL, p75 REAL, max REAL,
  last_seen INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season, family)
);
CREATE INDEX IF NOT EXISTS family_prices_name ON family_prices (season, name);

-- Shared builds (server/cloud/signature.js buildSummary): hero, main skill, gear by signature, DPS
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  season TEXT,
  hero TEXT,
  main_skill TEXT,
  level INTEGER,
  dps REAL,
  dps_kind TEXT,
  json TEXT NOT NULL,
  reporter TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS builds_lookup ON builds (season, hero, main_skill, dps);
CREATE INDEX IF NOT EXISTS builds_reporter ON builds (reporter, created_at);

-- Which items each build wears, so "builds using Law of Greed" is one indexed query
CREATE TABLE IF NOT EXISTS build_items (
  build_id TEXT NOT NULL,
  family TEXT NOT NULL,
  signature TEXT NOT NULL,
  slot TEXT,
  PRIMARY KEY (build_id, slot)
);
CREATE INDEX IF NOT EXISTS build_items_family ON build_items (family);
