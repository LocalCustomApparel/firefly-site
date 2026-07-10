'use strict';
const cfg = require('../config');
const { open } = require('../db/guitars');
const { isNewTitle, decideChanges } = require('../lib/decide');
const { RateLimited, sleep } = require('./errors');

const ADAPTERS = { shopify: require('./shopify'), shoplazza: require('./shoplazza') };
const MAX_PINGS_PER_CYCLE = Number(process.env.GUITARS_MAX_PINGS || 10);
const LOW_STOCK = 5;
const PING_BASE_MS = Number(process.env.GUITARS_PING_BASE_MS ?? 1400);
const PING_JITTER_MS = Number(process.env.GUITARS_PING_JITTER_MS ?? 700);
const pingDelay = () => PING_BASE_MS + Math.floor(Math.random() * PING_JITTER_MS);

async function scrapeStore(storeCfg, { g, adapter }) {
  adapter = adapter || ADAPTERS[storeCfg.adapter];
  const store = storeCfg.store;
  const started = Date.now();
  let catalog;
  try {
    catalog = await adapter.fetchCatalog(storeCfg);
  } catch (e) {
    g.recordRun(store, Date.now(), 0, 0, Date.now() - started, e.message);
    throw e;
  }
  const ts = Date.now();
  const items = catalog.map(n => ({ n, prev: g.getProduct(store, n.id) }));
  const pingsOn = storeCfg.pings && adapter.supportsPings;

  const rank = it => {
    const seenTier = it.prev ? 1 : 0;
    const q = it.prev && it.prev.current_qty != null ? it.prev.current_qty : null;
    const lowFirst = (q != null && q > 0 && q <= LOW_STOCK) ? 0 : 1;
    const stale = it.prev && it.prev.last_pinged_at ? it.prev.last_pinged_at : 0;
    return [seenTier, lowFirst, stale];
  };
  const cmp = (a, b) => { const ka = rank(a), kb = rank(b); return (ka[0] - kb[0]) || (ka[1] - kb[1]) || (ka[2] - kb[2]); };
  const toPing = pingsOn
    ? new Set(items.filter(x => x.n.available).sort(cmp).slice(0, MAX_PINGS_PER_CYCLE).map(x => x.n.id))
    : new Set();

  let eventCount = 0, pinged = 0, stopPinging = false, rateLimitedMsg = null;

  for (const { n, prev } of items) {
    let qty, attemptedPing = false;
    if (!n.available) qty = 0;
    else if (!toPing.has(n.id) || stopPinging) qty = null;
    else {
      attemptedPing = true;
      try { qty = await adapter.fetchQuantity(storeCfg, n.variantId); pinged++; await sleep(pingDelay()); }
      catch (e) { qty = null; if (e instanceof RateLimited) { stopPinging = true; rateLimitedMsg = e.message; } }
    }

    const curr = { price: n.price, compare_at: n.compareAt, qty, available: n.available };
    const { events, writeStock, writePrice, patch, isNew } = decideChanges(prev, curr, ts);
    if (attemptedPing) patch.last_pinged_at = ts;

    g.withTransaction(() => {
      if (isNew) {
        g.insertProduct({
          store, id: n.id, variant_id: n.variantId, sku: n.sku, handle: n.handle, title: n.title,
          vendor: n.vendor, product_type: n.productType, tags: n.tags, image: n.image,
          is_new_title: isNewTitle(n.title) ? 1 : 0,
          first_seen_at: ts, launch_price: n.price, launch_compare_at: n.compareAt,
          initial_stock: qty, current_price: n.price, current_compare_at: n.compareAt,
          current_qty: qty, current_available: n.available ? 1 : 0,
          sold_out_at: patch.sold_out_at || null, restock_count: 0, delisted_at: null,
          last_seen_at: ts, last_pinged_at: attemptedPing ? ts : null,
          currency: storeCfg.currency, raw_json: JSON.stringify(n.raw),
        });
      } else {
        g.updateProductState(store, n.id, patch);
      }
      if (writeStock) g.insertStock(store, n.id, ts, qty, n.available ? 1 : 0);
      if (writePrice) g.insertPrice(store, n.id, ts, n.price, n.compareAt);
      for (const ev of events) { g.insertEvent(store, n.id, ts, ev.type, ev.detail); eventCount++; }
    });
  }

  const delisted = g.markDelisted(store, catalog.map(n => n.id), ts);
  for (const id of delisted) { g.insertEvent(store, id, ts, 'delisted', {}); eventCount++; }

  const error = rateLimitedMsg ? `rate-limited after ${pinged} pings: ${rateLimitedMsg}` : null;
  g.recordRun(store, ts, catalog.length, 1, Date.now() - started, error);
  return { seen: catalog.length, pinged, events: eventCount, rateLimited: !!rateLimitedMsg };
}

async function main() {
  const arg = process.argv[2] || 'all';
  const codes = arg === 'all' ? Object.keys(cfg.STORES) : [arg];
  const g = open(cfg.GUITARS_DB);
  let failed = false;
  for (const code of codes) {
    const sc = cfg.storeByCode(code);
    if (!sc) { console.error(`[ff-scrape] unknown store: ${code}`); failed = true; continue; }
    try {
      const r = await scrapeStore(sc, { g });
      console.log(`[ff-scrape] ${sc.store}: ${r.seen} products, ${r.pinged} pings, ${r.events} events${r.rateLimited ? ' (RATE-LIMITED)' : ''}`);
    } catch (e) { failed = true; console.error(`[ff-scrape] ${sc.store} failed: ${e.message}`); }
  }
  g.close();
  process.exit(failed ? 1 : 0);
}
if (require.main === module) main();
module.exports = { scrapeStore };
