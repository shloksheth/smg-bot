CREATE TABLE IF NOT EXISTS runs (
 id TEXT PRIMARY KEY, started TEXT NOT NULL, status TEXT NOT NULL,
 report TEXT, finished TEXT
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, symbol TEXT NOT NULL,
 action TEXT NOT NULL, quantity INTEGER NOT NULL, status TEXT NOT NULL,
 confirmation TEXT, baseline_shares INTEGER NOT NULL, created TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS history (
 symbol TEXT NOT NULL, date TEXT NOT NULL, price REAL NOT NULL,
 PRIMARY KEY(symbol,date)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings VALUES ('paused','false');
