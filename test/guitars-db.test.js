'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../db/guitars');

const DB = path.join(os.tmpdir(), `ff-gdb-${process.pid}.db`);
const g = open(DB);
test.after(() => { g.close(); try { fs.unlinkSync(DB); } catch {} });

const row = (store, id, extra = {}) => ({
  store, id, variant_id: '1', sku: 's', handle: `h${id}`, title: `T${id}`, vendor: 'GG',
  product_type: 'PE', tags: '', image: null, is_new_title: 0, first_seen_at: 1000,
  launch_price: 100, launch_compare_at: null, initial_stock: 10, current_price: 100,
  current_compare_at: null, current_qty: 10, current_available: 1, sold_out_at: null,
  restock_count: 0, delisted_at: null, last_seen_at: 1000, last_pinged_at: null,
  currency: store === 'guitarsgarden.co.uk' ? 'GBP' : 'USD', raw_json: '{}', ...extra,
});

test('same id in two stores are distinct products', () => {
  g.insertProduct(row('guitarsgarden.com', '42'));
  g.insertProduct(row('guitarsgarden.co.uk', '42', { title: 'UK42' }));
  assert.equal(g.getProduct('guitarsgarden.com', 42).title, 'T42'); // number coerced
  assert.equal(g.getProduct('guitarsgarden.co.uk', '42').title, 'UK42');
});

test('markDelisted only touches its own store', () => {
  const flagged = g.markDelisted('guitarsgarden.com', [], 5000);
  assert.deepEqual(flagged, ['42']);
  assert.equal(g.getProduct('guitarsgarden.co.uk', '42').delisted_at, null);
});

test('live/drops filter by store and compute derived fields', () => {
  assert.equal(g.live({ store: 'guitarsgarden.co.uk' }).length, 1);
  assert.equal(g.live({ store: 'guitarsgarden.co.uk' })[0].pct_sold, 0);
  assert.equal(g.drops({}).length, 2);
});

test('readonly mode blocks writes but reads fine', () => {
  const r = open(DB, { readonly: true });
  assert.equal(r.getProduct('guitarsgarden.com', '42').title, 'T42');
  assert.throws(() => r.insertStock('guitarsgarden.com', '42', 1, 1, 1), /readonly/);
  assert.throws(() => r.insertProduct(row('guitarsgarden.com', '99')), /readonly/);
  assert.throws(() => r.updateProductState('guitarsgarden.com', '42', { title: 'new' }), /readonly/);
  assert.throws(() => r.markDelisted('guitarsgarden.com', [], 5000), /readonly/);
  r.close();
});
