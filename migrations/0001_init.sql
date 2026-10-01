-- 補助資料（舊年度資料永久保留，不刪除）
CREATE TABLE subsidies (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  agency TEXT NOT NULL,
  announce_date TEXT,              -- YYYY-MM-DD（西元，台灣日期）
  year INTEGER,                    -- 公告年度（西元）
  apply_start TEXT,
  apply_end TEXT,
  apply_end_time TEXT,             -- HH:MM，官方未寫時間則為 NULL（視為 23:59:59）
  deadline_text TEXT,              -- 官方期限原文
  until_quota INTEGER NOT NULL DEFAULT 0,
  status_flag TEXT,                -- quota_full / budget_exhausted / closed_early / closed
  target TEXT,
  target_types TEXT NOT NULL DEFAULT '[]',
  amount_text TEXT,
  amount_details TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  content TEXT,
  official_url TEXT NOT NULL,
  source_urls TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  signals TEXT NOT NULL DEFAULT '[]',
  doc_no TEXT,
  program_name TEXT,
  link_status TEXT NOT NULL DEFAULT 'ok',   -- ok / dead
  content_hash TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_subsidies_year ON subsidies(year, hidden);

-- 爬蟲看過的候選網址（避免重複抓取）
CREATE TABLE crawl_urls (
  url TEXT PRIMARY KEY,
  source_id TEXT,
  title TEXT,
  list_date TEXT,
  verdict TEXT,                    -- subsidy / not / error
  reason TEXT,
  subsidy_id TEXT,
  content_hash TEXT,
  first_seen_at TEXT NOT NULL,
  last_checked_at TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);

-- 各資料來源狀態
CREATE TABLE sources_status (
  source_id TEXT PRIMARY KEY,
  agency TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  discovered_lists TEXT NOT NULL DEFAULT '[]',
  discovered_at TEXT
);

-- 人工修正（由 crawler/config/manual_overrides.json 同步）
CREATE TABLE overrides (
  target TEXT PRIMARY KEY,         -- 補助 id 或官方網址
  data TEXT NOT NULL,
  note TEXT
);

-- 人工排除（由 crawler/config/exclusions.json 同步）
CREATE TABLE exclusions (
  target TEXT PRIMARY KEY,         -- 補助 id 或網址
  note TEXT
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);

-- 智慧小幫手每日用量（client 為每日變動的匿名雜湊，不存原始 IP）
CREATE TABLE ask_usage (
  day TEXT NOT NULL,
  client TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, client)
);

CREATE TABLE scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT,
  finished_at TEXT,
  ok INTEGER,
  stats TEXT,
  errors TEXT
);

INSERT INTO counters (key, value) VALUES ('site_views', 0);
