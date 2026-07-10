'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
// Set ping delays to 0 before requiring scrape.js so it reads them at require time
process.env.GUITARS_PING_BASE_MS = '0';
process.env.GUITARS_PING_JITTER_MS = '0';
const { open } = require('../db/guitars');
const { scrapeStore } = require('../scrape/scrape');
const { RateLimited } = require('../scrape/errors');
const cfg = require('../config');

const DB = path.join(os.tmpdir(), `ff-scr-${process.pid}.db`);
const g = open(DB);
test.after(() => { g.close(); try { fs.unlinkSync(DB); } catch {} });

const prod = (id, over = {}) => ({
  id: String(id), variantId: '9', sku: null, handle: `h${id}`, title: `Firefly FF338 (${id})`,
  vendor: 'GG', productType: '', tags: '', image: null, price: 250, compareAt: null,
  available: true, raw: {}, ...over,
});
const stubAdapter = products => ({
  supportsPings: false,
  fetchCatalog: async () => products,
});

test('new product creates drop event with store + currency', async () => {
  const r = await scrapeStore(cfg.STORES.uk, { g, adapter: stubAdapter([prod(1)]) });
  assert.equal(r.seen, 1);
  const p = g.getProduct('guitarsgarden.co.uk', '1');
  assert.equal(p.currency, 'GBP');
  assert.equal(p.current_qty, null); // no pings on uk
  const ev = g.db.prepare("SELECT * FROM events WHERE type='drop' AND store='guitarsgarden.co.uk'").all();
  assert.equal(ev.length, 1);
});

test('disappearance delists within the store only', async () => {
  g.insertProduct({ store: 'guitarsgarden.com', id: '1', currency: 'USD', title: 'us twin',
    variant_id: '9', handle: 'h', first_seen_at: 1, launch_price: 1, current_price: 1,
    current_qty: 1, current_available: 1, last_seen_at: 1, raw_json: '{}' });
  await scrapeStore(cfg.STORES.uk, { g, adapter: stubAdapter([]) });
  assert.ok(g.getProduct('guitarsgarden.co.uk', '1').delisted_at);
  assert.equal(g.getProduct('guitarsgarden.com', '1').delisted_at, null);
});

test('run rows are per-store', async () => {
  const rows = g.db.prepare("SELECT * FROM scrape_runs WHERE store='guitarsgarden.co.uk'").all();
  assert.ok(rows.length >= 2);
});

// Tests for ping-enabled path (cfg.STORES.us has pings: true)
test('ping budget cap: 10 max, 12 available → 10 pinged, 2 unpinged', async () => {
  const catalog = [];
  for (let i = 100; i < 112; i++) catalog.push(prod(i));
  let callCount = 0;
  const pingAdapter = {
    supportsPings: true,
    fetchCatalog: async () => catalog,
    fetchQuantity: async () => { callCount++; return 42; },
  };
  const r = await scrapeStore(cfg.STORES.us, { g, adapter: pingAdapter });
  assert.equal(callCount, 10, 'fetchQuantity called exactly 10 times');
  assert.equal(r.pinged, 10);
  // First 10 (sorted by rank: seen tier, low first, stale) should have qty pinged
  // Products are ranked by (seenTier, lowFirst, stale) — all new so seenTier=0
  // all available so lowFirst depends on qty (unknown for new, so 1)
  // So all tie on (0, 1, 0), order is insertion order: 100-109
  for (let i = 100; i < 110; i++) {
    const p = g.getProduct('guitarsgarden.com', String(i));
    assert.equal(p.current_qty, 42, `product ${i} should have qty pinged`);
    assert.ok(p.last_pinged_at, `product ${i} should have last_pinged_at`);
  }
  // Last 2 should not be pinged
  for (let i = 110; i < 112; i++) {
    const p = g.getProduct('guitarsgarden.com', String(i));
    assert.equal(p.current_qty, null, `product ${i} should have qty null`);
    assert.equal(p.last_pinged_at, null, `product ${i} should have last_pinged_at null`);
  }
});

test('rate-limited stops ping cycle mid-way', async () => {
  const catalog = [];
  for (let i = 200; i < 215; i++) catalog.push(prod(i));
  let callCount = 0;
  const pingAdapter = {
    supportsPings: true,
    fetchCatalog: async () => catalog,
    fetchQuantity: async () => {
      callCount++;
      if (callCount === 3) throw new RateLimited('quota exceeded');
      return 99;
    },
  };
  const r = await scrapeStore(cfg.STORES.us, { g, adapter: pingAdapter });
  assert.equal(callCount, 3, 'fetchQuantity called 3 times (2 successes + 1 throw)');
  assert.equal(r.pinged, 2, 'only 2 successful pings before rate limit');
  assert.ok(r.rateLimited, 'result.rateLimited should be true');
  // First 2 should have qty from successful pings
  for (let i = 200; i < 202; i++) {
    const p = g.getProduct('guitarsgarden.com', String(i));
    assert.equal(p.current_qty, 99, `product ${i} should have qty from ping`);
    assert.ok(p.last_pinged_at, `product ${i} should have last_pinged_at`);
  }
  // Product 202 (the one that threw) should have last_pinged_at set (attempted ping) but qty null
  const p202 = g.getProduct('guitarsgarden.com', '202');
  assert.equal(p202.current_qty, null, 'product 202 qty should be null (ping threw)');
  assert.ok(p202.last_pinged_at, 'product 202 should have last_pinged_at (attempted ping)');
  // Rest should have null qty and null last_pinged_at
  for (let i = 203; i < 215; i++) {
    const p = g.getProduct('guitarsgarden.com', String(i));
    assert.equal(p.current_qty, null, `product ${i} should have qty null`);
    assert.equal(p.last_pinged_at, null, `product ${i} should have last_pinged_at null`);
  }
  // Check scrape_runs error message
  const runRow = g.db.prepare("SELECT error FROM scrape_runs WHERE store='guitarsgarden.com' AND error IS NOT NULL ORDER BY ts DESC LIMIT 1").get();
  assert.ok(runRow, 'should have error row');
  assert.match(runRow.error, /rate-limited/, 'error message should contain rate-limited');
});

test('sold-out inference via ping: qty 5→0 records sold_out event', async () => {
  // Pre-insert a product with current_qty=5, available=true
  g.insertProduct({
    store: 'guitarsgarden.com', id: '300', currency: 'USD', title: 'Existing Guitar',
    variant_id: '9', handle: 'h300', first_seen_at: 1000, launch_price: 250,
    current_price: 250, current_qty: 5, current_available: 1, last_seen_at: 1000,
    raw_json: '{}',
  });
  // Catalog has same product but still marked available
  const catalog = [prod(300)];
  const pingAdapter = {
    supportsPings: true,
    fetchCatalog: async () => catalog,
    fetchQuantity: async () => 0, // Ping returns 0 (sold out)
  };
  const r = await scrapeStore(cfg.STORES.us, { g, adapter: pingAdapter });
  assert.equal(r.pinged, 1);
  const p = g.getProduct('guitarsgarden.com', '300');
  assert.equal(p.current_qty, 0, 'product should have qty=0 from ping');
  assert.ok(p.sold_out_at, 'product should have sold_out_at set');
  // Check for sold_out event
  const events = g.db.prepare("SELECT * FROM events WHERE store='guitarsgarden.com' AND product_id='300' AND type='sold_out'").all();
  assert.equal(events.length, 1, 'should have exactly one sold_out event');
});
