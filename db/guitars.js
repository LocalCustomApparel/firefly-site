'use strict';
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  store TEXT NOT NULL,
  id TEXT NOT NULL,
  variant_id TEXT, sku TEXT, handle TEXT, title TEXT, vendor TEXT, product_type TEXT,
  tags TEXT, image TEXT, is_new_title INTEGER DEFAULT 0, first_seen_at INTEGER,
  launch_price REAL, launch_compare_at REAL, initial_stock INTEGER,
  current_price REAL, current_compare_at REAL, current_qty INTEGER, current_available INTEGER,
  sold_out_at INTEGER, restock_count INTEGER DEFAULT 0, delisted_at INTEGER,
  last_seen_at INTEGER, last_pinged_at INTEGER, currency TEXT NOT NULL DEFAULT 'USD',
  raw_json TEXT,
  PRIMARY KEY (store, id)
);
CREATE TABLE IF NOT EXISTS stock_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, product_id TEXT NOT NULL,
  ts INTEGER NOT NULL, quantity INTEGER, available INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stock_spid_ts ON stock_history(store, product_id, ts);
CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, product_id TEXT NOT NULL,
  ts INTEGER NOT NULL, price REAL, compare_at_price REAL
);
CREATE INDEX IF NOT EXISTS idx_price_spid_ts ON price_history(store, product_id, ts);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL DEFAULT '', product_id TEXT,
  ts INTEGER NOT NULL, type TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type_ts ON events(type, ts);
CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL,
  products_seen INTEGER, full INTEGER, duration_ms INTEGER, error TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

const PRODUCT_COLS = [
  'store','id','variant_id','sku','handle','title','vendor','product_type','tags','image',
  'is_new_title','first_seen_at','launch_price','launch_compare_at','initial_stock',
  'current_price','current_compare_at','current_qty','current_available','sold_out_at',
  'restock_count','delisted_at','last_seen_at','last_pinged_at','currency','raw_json',
];
const UPDATABLE = new Set(PRODUCT_COLS.filter(c => c !== 'store' && c !== 'id'));
const S = v => v === null || v === undefined ? v : String(v);

function open(dbPath, { readonly = false } = {}) {
  const db = new Database(dbPath, { readonly });
  if (!readonly) { db.pragma('journal_mode = WAL'); db.exec(SCHEMA); }

  const q = {
    get: db.prepare('SELECT * FROM products WHERE store = ? AND id = ?'),
    insert: db.prepare(`INSERT INTO products (${PRODUCT_COLS.join(',')}) VALUES (${PRODUCT_COLS.map(c => '@' + c).join(',')})`),
    stock: readonly ? null : db.prepare('INSERT INTO stock_history (store, product_id, ts, quantity, available) VALUES (?,?,?,?,?)'),
    price: readonly ? null : db.prepare('INSERT INTO price_history (store, product_id, ts, price, compare_at_price) VALUES (?,?,?,?,?)'),
    event: readonly ? null : db.prepare('INSERT INTO events (store, product_id, ts, type, detail) VALUES (?,?,?,?,?)'),
    run: readonly ? null : db.prepare('INSERT INTO scrape_runs (store, ts, products_seen, full, duration_ms, error) VALUES (?,?,?,?,?,?)'),
  };
  const w = stmt => { if (!stmt) throw new Error('readonly'); return stmt; };
  const assertWritable = () => { if (readonly) throw new Error('readonly'); };
  const storeFilter = store => store ? { sql: ' AND store = ?', args: [store] } : { sql: '', args: [] };

  return {
    db,
    close: () => db.close(),
    getProduct: (store, id) => q.get.get(store, S(id)),
    insertProduct(row) {
      assertWritable();
      const full = {};
      for (const c of PRODUCT_COLS) full[c] = c in row ? row[c] : null;
      full.id = S(full.id); full.variant_id = S(full.variant_id);
      w(q.insert).run(full);
    },
    updateProductState(store, id, patch) {
      assertWritable();
      const keys = Object.keys(patch).filter(k => UPDATABLE.has(k));
      if (!keys.length) return;
      const set = keys.map(k => `${k} = @${k}`).join(', ');
      const bind = { store, id: S(id) };
      for (const k of keys) bind[k] = patch[k];
      db.prepare(`UPDATE products SET ${set} WHERE store = @store AND id = @id`).run(bind);
    },
    insertStock: (store, id, ts, qty, avail) => { assertWritable(); return w(q.stock).run(store, S(id), ts, qty, avail); },
    insertPrice: (store, id, ts, price, compareAt) => { assertWritable(); return w(q.price).run(store, S(id), ts, price, compareAt); },
    insertEvent: (store, id, ts, type, detail) => { assertWritable(); return w(q.event).run(store, S(id), ts, type, JSON.stringify(detail || {})); },
    recordRun: (store, ts, seen, full, ms, err) => { assertWritable(); return w(q.run).run(store, ts, seen, full ? 1 : 0, ms, err); },
    markDelisted(store, seenIds, ts) {
      assertWritable();
      const seen = new Set(seenIds.map(S));
      const rows = db.prepare('SELECT id FROM products WHERE store = ? AND delisted_at IS NULL').all(store);
      const flagged = [];
      const upd = db.prepare('UPDATE products SET delisted_at = ? WHERE store = ? AND id = ?');
      db.transaction(() => {
        for (const r of rows) if (!seen.has(r.id)) { upd.run(ts, store, r.id); flagged.push(r.id); }
      })();
      return flagged;
    },
    withTransaction: fn => { assertWritable(); return db.transaction(fn)(); },
    live({ store } = {}) {
      const f = storeFilter(store);
      const rows = db.prepare(
        `SELECT * FROM products WHERE (current_qty > 0 OR (current_available = 1 AND current_qty IS NULL)) AND delisted_at IS NULL${f.sql} ORDER BY first_seen_at DESC`
      ).all(...f.args);
      const now = Date.now();
      return rows.map(r => ({
        ...r,
        pct_sold: r.initial_stock > 0 ? Math.max(0, Math.min(100, ((r.initial_stock - r.current_qty) / r.initial_stock) * 100)) : 0,
        days_live: r.first_seen_at ? (now - r.first_seen_at) / 86400000 : 0,
      }));
    },
    drops({ store, limit = 200 } = {}) {
      const f = storeFilter(store);
      const rows = db.prepare(`SELECT * FROM products WHERE 1=1${f.sql} ORDER BY first_seen_at DESC LIMIT ?`).all(...f.args, limit);
      return rows.map(r => ({ ...r, time_to_sellout_ms: r.sold_out_at && r.first_seen_at ? r.sold_out_at - r.first_seen_at : null }));
    },
    detail(store, id) {
      const product = q.get.get(store, S(id));
      if (!product) return null;
      return {
        product,
        stock: db.prepare('SELECT ts, quantity, available FROM stock_history WHERE store = ? AND product_id = ? ORDER BY ts').all(store, S(id)),
        price: db.prepare('SELECT ts, price, compare_at_price FROM price_history WHERE store = ? AND product_id = ? ORDER BY ts').all(store, S(id)),
        events: db.prepare('SELECT ts, type, detail FROM events WHERE store = ? AND product_id = ? ORDER BY ts').all(store, S(id))
          .map(e => ({ ...e, detail: JSON.parse(e.detail || '{}') })),
      };
    },
    stats({ store } = {}) {
      const f = storeFilter(store);
      const total_drops = db.prepare(`SELECT COUNT(*) n FROM events WHERE type='drop'${f.sql}`).get(...f.args).n;
      const cutoff = Date.now() - 30 * 86400000;
      const drops_last_30d = db.prepare(`SELECT COUNT(*) n FROM events WHERE type='drop' AND ts > ?${f.sql}`).get(cutoff, ...f.args).n;
      const sold = db.prepare(`SELECT first_seen_at, sold_out_at, initial_stock, current_qty, launch_price FROM products WHERE 1=1${f.sql}`).all(...f.args);
      const soldOutTimes = sold.filter(p => p.sold_out_at && p.first_seen_at).map(p => p.sold_out_at - p.first_seen_at);
      const avg_time_to_sellout_ms = soldOutTimes.length ? soldOutTimes.reduce((a, b) => a + b, 0) / soldOutTimes.length : 0;
      const sellThroughs = sold.filter(p => p.initial_stock > 0).map(p => (p.initial_stock - p.current_qty) / p.initial_stock);
      const sell_through_avg = sellThroughs.length ? sellThroughs.reduce((a, b) => a + b, 0) / sellThroughs.length : 0;
      return { total_drops, drops_last_30d, avg_time_to_sellout_ms, sell_through_avg };
    },
    lastRunTs() {
      const r = db.prepare('SELECT MAX(ts) t FROM scrape_runs WHERE error IS NULL').get();
      return r && r.t ? r.t : null;
    },
    allTitles() {
      return db.prepare('SELECT store, id, title, handle FROM products').all();
    },
  };
}

module.exports = { open };
