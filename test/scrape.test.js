'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../db/guitars');
const { scrapeStore } = require('../scrape/scrape');
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
