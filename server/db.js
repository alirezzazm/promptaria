'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'promptaria.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name_fa     TEXT NOT NULL,
  name_en     TEXT NOT NULL,
  icon        TEXT DEFAULT '',
  description TEXT DEFAULT '',
  sort_order  INTEGER DEFAULT 100
);

CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  home_url      TEXT NOT NULL,
  kind          TEXT DEFAULT 'html',
  enabled       INTEGER DEFAULT 1,
  trust         INTEGER DEFAULT 70,
  license       TEXT DEFAULT '',
  last_run_at   TEXT,
  last_status   TEXT,
  last_error    TEXT,
  total_found   INTEGER DEFAULT 0,
  total_added   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  uid           TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL,
  body          TEXT NOT NULL,
  summary       TEXT DEFAULT '',
  how_to        TEXT DEFAULT '',
  tips          TEXT DEFAULT '[]',
  variables     TEXT DEFAULT '[]',
  example_use   TEXT DEFAULT '',
  expected_out  TEXT DEFAULT '',
  best_models   TEXT DEFAULT '[]',
  tags          TEXT DEFAULT '[]',
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  difficulty    TEXT DEFAULT 'medium',
  lang          TEXT DEFAULT 'en',
  quality       INTEGER DEFAULT 60,
  featured      INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'published',
  views         INTEGER DEFAULT 0,
  copies        INTEGER DEFAULT 0,
  likes         INTEGER DEFAULT 0,
  -- ADMIN ONLY FIELDS (never exposed on public API)
  source_id     INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  source_url    TEXT DEFAULT '',
  source_author TEXT DEFAULT '',
  body_hash     TEXT NOT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_prompts_cat    ON prompts(category_id);
CREATE INDEX IF NOT EXISTS idx_prompts_status ON prompts(status);
CREATE INDEX IF NOT EXISTS idx_prompts_hash   ON prompts(body_hash);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   INTEGER REFERENCES sources(id) ON DELETE CASCADE,
  started_at  TEXT DEFAULT (datetime('now')),
  finished_at TEXT,
  status      TEXT DEFAULT 'running',
  found       INTEGER DEFAULT 0,
  added       INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  skipped     INTEGER DEFAULT 0,
  error       TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
`);

/* The scraped corpus arrives with English titles. `title_fa` holds the Persian
 * title shown to visitors; `title` stays the original, for admin, dedupe and
 * people who search the English name. Slugs are never recomputed from it, so
 * adding a translation does not move a page Google has already indexed. */
try {
  db.exec('ALTER TABLE prompts ADD COLUMN title_fa TEXT');
} catch {
  /* already there */
}

module.exports = db;
