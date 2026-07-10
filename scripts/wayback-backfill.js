'use strict';
const cfg = require('../config');
const { sleep } = require('../scrape/errors');
const { guessModel } = require('../lib/models');
const { parseProductPage } = require('../scrape/shoplazza');

const CDX = 'http://web.archive.org/cdx/search/cdx';
const ts14ToMs = t => Date.parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}Z`);

// Ascending ts14 order matters: the first time a handle appears fixes firstSnapshotAt
// permanently, which keeps the (store, handle, first_snapshot_at) upsert key stable
// across the incremental per-snapshot writes below.
function collapseSnapshots(cdxRows) {
  const [header, ...rows] = cdxRows;
  const ti = header.indexOf('timestamp'), oi = header.indexOf('original');
  return rows
    .map(r => ({ ts14: r[ti], url: `https://web.archive.org/web/${r[ti]}id_/${r[oi]}` }))
    .sort((a, b) => (a.ts14 < b.ts14 ? -1 : a.ts14 > b.ts14 ? 1 : 0));
}

async function fetchWithRetry(url, fetchImpl, { delayMs = 1500 } = {}) {
  const waits = [10000, 30000, 60000];
  for (let i = 0; ; i++) {
    await sleep(delayMs);
    const r = await fetchImpl(url);
    if (r.ok) return r;
    if (i >= waits.length) throw new Error(`${url} → HTTP ${r.status}`);
    await sleep(waits[i]);
  }
}

// Neither store's products.json was ever archived by the Wayback Machine (confirmed via
// CDX — empty result at discovery time). Falls back to per-page CDX + JSON-LD parse (same
// parseProductPage used by the uk shoplazza adapter — it's generic ld+json extraction, not
// store-specific). A snapshot's text is tried as JSON first (the originally-designed
// products.json catalog shape, kept for forward-compat if archive.org ever captures it —
// exercised by the unit test's synthetic fetchImpl); anything that doesn't parse as
// `{ products: [...] }` is treated as an archived HTML product page.
//
// Shared fold-and-upsert for both stores: each snapshot's entries are folded into the
// per-handle map and the affected row is persisted (upserted) immediately, so a crash
// mid-run keeps all progress so far. Handles in `known` (live-tracked) are skipped
// before folding and counted once per handle.
async function reconstruct(snapshots, fetchImpl = fetch, opts = {}) {
  const { store = 'guitarsgarden.com', currency = 'USD', known = null, persist = null } = opts;
  const byHandle = new Map();
  const skippedHandles = new Set();
  for (const snap of snapshots) {
    let entries = [];
    try {
      const r = await fetchWithRetry(snap.url, fetchImpl, opts);
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON — archived HTML product page */ }
      if (json && Array.isArray(json.products)) {
        entries = json.products.map(p => {
          const v = p.variants && p.variants[0];
          return { handle: p.handle, title: p.title, price: v ? Number(v.price) : null, confidence: 'exact' };
        });
      } else {
        const original = snap.url.split('id_/')[1];
        const n = parseProductPage(text, original);
        if (n) entries = [{ handle: n.handle, title: n.title, price: n.price, confidence: 'range' }];
      }
    } catch { continue; } // one bad snapshot never kills the run
    const ms = ts14ToMs(snap.ts14);
    for (const e of entries) {
      if (!e.handle) continue;
      if (known && known.has(e.handle)) { skippedHandles.add(e.handle); continue; }
      let cur = byHandle.get(e.handle);
      if (!cur) {
        cur = {
          store, handle: e.handle, title: e.title, price: e.price, currency,
          firstSnapshotAt: ms, lastSnapshotAt: ms, snapshotUrl: snap.url, confidence: e.confidence,
        };
        byHandle.set(e.handle, cur);
      } else {
        cur.firstSnapshotAt = Math.min(cur.firstSnapshotAt, ms);
        cur.lastSnapshotAt = Math.max(cur.lastSnapshotAt, ms);
      }
      if (persist) persist(cur);
    }
  }
  return { rows: [...byHandle.values()], skippedLive: skippedHandles.size };
}

const reconstructUS = (snapshots, fetchImpl = fetch, opts = {}) =>
  reconstruct(snapshots, fetchImpl, { store: 'guitarsgarden.com', currency: 'USD', ...opts });

async function main() {
  const code = process.argv[2];
  if (!['us', 'uk'].includes(code)) { console.error('usage: node scripts/wayback-backfill.js us|uk'); process.exit(1); }
  const sc = cfg.storeByCode(code);
  const gdb = require('../db/guitars').open(cfg.GUITARS_DB, { readonly: true });
  const wdb = require('../db/wiki').open(cfg.FFWIKI_DB);
  const models = wdb.allModels();
  const known = new Set(gdb.db.prepare('SELECT handle FROM products WHERE store = ?').all(sc.store).map(r => r.handle));

  const persisted = new Set();
  const persist = row => {
    const g = guessModel(row.title, models);
    wdb.insertWayback({ ...row, modelSlug: g ? g.slug : null });
    persisted.add(row.handle);
  };

  // products.json fallback (see reconstruct comment above): CDX on product pages instead.
  const cdxUrl = code === 'us'
    ? `${CDX}?url=guitarsgarden.com/products/*&output=json&filter=statuscode:200&filter=mimetype:text/html&collapse=digest`
    : `${CDX}?url=guitarsgarden.co.uk/products/*&output=json&filter=statuscode:200&collapse=urlkey&limit=2000`;
  const cdx = await (await fetch(cdxUrl)).json();
  const { skippedLive } = await reconstruct(collapseSnapshots(cdx), fetch, {
    store: sc.store, currency: sc.currency, known, persist,
  });

  console.log(`[wayback] ${sc.store}: ${persisted.size} archived drops written, ${skippedLive} skipped (live-tracked)`);
  gdb.close(); wdb.close();
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { collapseSnapshots, reconstruct, reconstructUS };
