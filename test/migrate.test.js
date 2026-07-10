'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { migrate } = require('../db/migrate-guitars');

const DB = path.join(os.tmpdir(), `ff-mig-${process.pid}.db`);
test.after(() => { try { fs.unlinkSync(DB); } catch {} });

function makeOldDb() {
  const db = new Database(DB);
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, variant_id INTEGER, sku TEXT, handle TEXT,
      title TEXT, vendor TEXT, product_type TEXT, tags TEXT, image TEXT, is_new_title INTEGER DEFAULT 0,
      first_seen_at INTEGER, launch_price REAL, launch_compare_at REAL, initial_stock INTEGER,
      current_price REAL, current_compare_at REAL, current_qty INTEGER, current_available INTEGER,
      sold_out_at INTEGER, restock_count INTEGER DEFAULT 0, delisted_at INTEGER,
      last_seen_at INTEGER, last_pinged_at INTEGER, raw_json TEXT);
    CREATE TABLE stock_history (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, ts INTEGER NOT NULL, quantity INTEGER, available INTEGER);
    CREATE TABLE price_history (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, ts INTEGER NOT NULL, price REAL, compare_at_price REAL);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, ts INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT);
    CREATE TABLE scrape_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, products_seen INTEGER, full INTEGER, duration_ms INTEGER, error TEXT);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO products (id, title, first_seen_at, launch_price, current_qty, current_available) VALUES (123, 'FF338 Blue', 1000, 279, 5, 1);
    INSERT INTO stock_history (product_id, ts, quantity, available) VALUES (123, 1000, 5, 1);
    INSERT INTO price_history (product_id, ts, price, compare_at_price) VALUES (123, 1000, 279, NULL);
    INSERT INTO events (product_id, ts, type, detail) VALUES (123, 1000, 'drop', '{}');
    INSERT INTO scrape_runs (ts, products_seen, full, duration_ms, error) VALUES (1000, 1, 1, 50, NULL);
  `);
  db.close();
}

test('migrates old schema and joins still line up', () => {
  makeOldDb();
  assert.equal(migrate(DB), 'migrated');
  const { open } = require('../db/guitars');
  const g = open(DB, { readonly: true });
  const p = g.getProduct('guitarsgarden.com', 123);
  assert.equal(p.title, 'FF338 Blue');
  assert.equal(p.currency, 'USD');
  const d = g.detail('guitarsgarden.com', '123');
  assert.equal(d.stock.length, 1);
  assert.equal(d.price.length, 1);
  assert.equal(d.events[0].type, 'drop');
  g.close();
});

test('second run is a no-op', () => {
  assert.equal(migrate(DB), 'already-migrated');
});
