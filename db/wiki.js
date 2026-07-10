'use strict';
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS models (
  slug TEXT PRIMARY KEY, name TEXT NOT NULL, family TEXT, status TEXT DEFAULT 'current',
  sort_order INTEGER DEFAULT 0, aliases TEXT DEFAULT '[]', specs_json TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS model_products (
  store TEXT NOT NULL, product_id TEXT NOT NULL, model_slug TEXT NOT NULL,
  finish TEXT, source TEXT NOT NULL CHECK (source IN ('auto','manual')),
  PRIMARY KEY (store, product_id)
);
CREATE TABLE IF NOT EXISTS wayback_drops (
  id INTEGER PRIMARY KEY AUTOINCREMENT, store TEXT NOT NULL, handle TEXT NOT NULL,
  title TEXT, model_slug TEXT, price REAL, currency TEXT,
  first_snapshot_at INTEGER NOT NULL, last_snapshot_at INTEGER, snapshot_url TEXT,
  confidence TEXT CHECK (confidence IN ('exact','range')),
  UNIQUE (store, handle, first_snapshot_at)
);
CREATE TABLE IF NOT EXISTS model_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT, model_slug TEXT NOT NULL, kind TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT, added_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_links_slug ON model_links(model_slug);
`;

function open(dbPath, { readonly = false } = {}) {
  const db = new Database(dbPath, { readonly });
  if (!readonly) { db.pragma('journal_mode = WAL'); db.exec(SCHEMA); }
  const assertWritable = () => { if (readonly) throw new Error('readonly'); };
  return {
    db,
    close: () => db.close(),
    syncModels(list) {
      assertWritable();
      const up = db.prepare(`INSERT INTO models (slug, name, family, status, sort_order, aliases, specs_json)
        VALUES (@slug, @name, @family, @status, @sort_order, @aliases, @specs_json)
        ON CONFLICT(slug) DO UPDATE SET name=@name, family=@family, status=@status, sort_order=@sort_order, aliases=@aliases, specs_json=@specs_json`);
      db.transaction(() => {
        for (const m of list) up.run({
          slug: m.slug, name: m.name, family: m.family || null, status: m.status || 'current',
          sort_order: m.sort_order || 0, aliases: JSON.stringify(m.aliases || []),
          specs_json: JSON.stringify(m.specs || {}),
        });
      })();
    },
    allModels: () => db.prepare('SELECT * FROM models ORDER BY sort_order, slug').all()
      .map(m => ({ ...m, aliases: JSON.parse(m.aliases), specs: JSON.parse(m.specs_json) })),
    getModel(slug) {
      const m = db.prepare('SELECT * FROM models WHERE slug = ?').get(slug);
      return m ? { ...m, aliases: JSON.parse(m.aliases), specs: JSON.parse(m.specs_json) } : null;
    },
    mapProduct({ store, productId, modelSlug, finish, source }) {
      assertWritable();
      db.prepare(`INSERT INTO model_products (store, product_id, model_slug, finish, source)
        VALUES (?,?,?,?,?)
        ON CONFLICT(store, product_id) DO UPDATE SET
          model_slug = excluded.model_slug, finish = excluded.finish, source = excluded.source
        WHERE NOT (model_products.source = 'manual' AND excluded.source = 'auto')`)
        .run(store, String(productId), modelSlug, finish || null, source);
    },
    mappingFor: (store, productId) => db.prepare('SELECT * FROM model_products WHERE store = ? AND product_id = ?').get(store, String(productId)),
    mappingsForModel: slug => db.prepare('SELECT * FROM model_products WHERE model_slug = ?').all(slug),
    insertWayback(r) {
      assertWritable();
      db.prepare(`INSERT INTO wayback_drops (store, handle, title, model_slug, price, currency, first_snapshot_at, last_snapshot_at, snapshot_url, confidence)
        VALUES (@store, @handle, @title, @modelSlug, @price, @currency, @firstSnapshotAt, @lastSnapshotAt, @snapshotUrl, @confidence)
        ON CONFLICT(store, handle, first_snapshot_at) DO UPDATE SET
          title = @title, model_slug = @modelSlug, price = @price, last_snapshot_at = @lastSnapshotAt, snapshot_url = @snapshotUrl, confidence = @confidence`)
        .run(r);
    },
    waybackForModel: slug => db.prepare('SELECT * FROM wayback_drops WHERE model_slug = ? ORDER BY first_snapshot_at DESC').all(slug),
    allWayback: () => db.prepare('SELECT * FROM wayback_drops ORDER BY first_snapshot_at DESC').all(),
    addLink(l) {
      assertWritable();
      db.prepare('INSERT INTO model_links (model_slug, kind, url, title, added_at) VALUES (?,?,?,?,?)')
        .run(l.modelSlug, l.kind, l.url, l.title || null, l.addedAt || Date.now());
    },
    linksFor: slug => db.prepare('SELECT * FROM model_links WHERE model_slug = ? ORDER BY kind, id').all(slug),
  };
}
module.exports = { open };
