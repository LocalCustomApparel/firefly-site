'use strict';
const Database = require('better-sqlite3');

function hasCol(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

function migrate(dbPath) {
  const db = new Database(dbPath);
  if (hasCol(db, 'products', 'store')) { db.close(); return 'already-migrated'; }
  db.pragma('journal_mode = WAL');
  const STORE = "'guitarsgarden.com'";
  db.exec(`
BEGIN;
ALTER TABLE products RENAME TO products_old;
CREATE TABLE products (
  store TEXT NOT NULL, id TEXT NOT NULL,
  variant_id TEXT, sku TEXT, handle TEXT, title TEXT, vendor TEXT, product_type TEXT,
  tags TEXT, image TEXT, is_new_title INTEGER DEFAULT 0, first_seen_at INTEGER,
  launch_price REAL, launch_compare_at REAL, initial_stock INTEGER,
  current_price REAL, current_compare_at REAL, current_qty INTEGER, current_available INTEGER,
  sold_out_at INTEGER, restock_count INTEGER DEFAULT 0, delisted_at INTEGER,
  last_seen_at INTEGER, last_pinged_at INTEGER, currency TEXT NOT NULL DEFAULT 'USD',
  raw_json TEXT, PRIMARY KEY (store, id));
INSERT INTO products SELECT ${STORE}, CAST(id AS TEXT), CAST(variant_id AS TEXT), sku, handle, title,
  vendor, product_type, tags, image, is_new_title, first_seen_at, launch_price, launch_compare_at,
  initial_stock, current_price, current_compare_at, current_qty, current_available, sold_out_at,
  restock_count, delisted_at, last_seen_at, last_pinged_at, 'USD', raw_json FROM products_old;
DROP TABLE products_old;

ALTER TABLE stock_history RENAME TO stock_old;
CREATE TABLE stock_history (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, product_id TEXT NOT NULL, ts INTEGER NOT NULL, quantity INTEGER, available INTEGER);
INSERT INTO stock_history (id, store, product_id, ts, quantity, available)
  SELECT id, ${STORE}, CAST(product_id AS TEXT), ts, quantity, available FROM stock_old;
DROP TABLE stock_old;
CREATE INDEX IF NOT EXISTS idx_stock_spid_ts ON stock_history(store, product_id, ts);

ALTER TABLE price_history RENAME TO price_old;
CREATE TABLE price_history (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, product_id TEXT NOT NULL, ts INTEGER NOT NULL, price REAL, compare_at_price REAL);
INSERT INTO price_history (id, store, product_id, ts, price, compare_at_price)
  SELECT id, ${STORE}, CAST(product_id AS TEXT), ts, price, compare_at_price FROM price_old;
DROP TABLE price_old;
CREATE INDEX IF NOT EXISTS idx_price_spid_ts ON price_history(store, product_id, ts);

ALTER TABLE events RENAME TO events_old;
CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL DEFAULT '', product_id TEXT, ts INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT);
INSERT INTO events (id, store, product_id, ts, type, detail)
  SELECT id, ${STORE}, CAST(product_id AS TEXT), ts, type, detail FROM events_old;
DROP TABLE events_old;
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);

ALTER TABLE scrape_runs ADD COLUMN store TEXT NOT NULL DEFAULT 'guitarsgarden.com';
COMMIT;
  `);
  db.close();
  return 'migrated';
}

if (require.main === module) {
  const p = process.env.GUITARS_DB || require('../config').GUITARS_DB;
  console.log(`[migrate] ${p}: ${migrate(p)}`);
}
module.exports = { migrate };
