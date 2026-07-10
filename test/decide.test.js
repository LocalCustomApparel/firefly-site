'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isNewTitle, parseAddedQuantity, decideChanges } = require('../lib/decide');

test('isNewTitle detects NEW prefix, case-insensitive, word-boundary', () => {
  assert.equal(isNewTitle('NEW Pegasus Spalted Maple'), true);
  assert.equal(isNewTitle('New Firefly FFST'), true);
  assert.equal(isNewTitle('  new bass'), true);
  assert.equal(isNewTitle('Firefly FFJA Electric'), false);
  assert.equal(isNewTitle('Newton signature'), false); // word boundary, not "new..."
  assert.equal(isNewTitle(''), false);
});

test('parseAddedQuantity reads the 422 availability message', () => {
  assert.equal(parseAddedQuantity({ status: 422, message: 'Only 30 items were added to your cart due to availability.' }, 9999), 30);
  assert.equal(parseAddedQuantity({ status: 422, message: 'Only 1 item was added to your cart due to availability.' }, 9999), 1);
});

test('parseAddedQuantity returns requested when full add succeeded', () => {
  assert.equal(parseAddedQuantity({ status: 200, addedAll: true }, 9999), 9999);
});

test('parseAddedQuantity returns null when unparseable', () => {
  assert.equal(parseAddedQuantity({ status: 422, message: 'Cart error' }, 9999), null);
  assert.equal(parseAddedQuantity(null, 9999), null);
});

test('decideChanges: brand-new product emits a drop and writes both histories', () => {
  const r = decideChanges(null, { price: 279.91, compare_at: null, qty: 30, available: true }, 1000);
  assert.equal(r.isNew, true);
  assert.equal(r.writeStock, true);
  assert.equal(r.writePrice, true);
  assert.deepEqual(r.events.map(e => e.type), ['drop']);
  assert.equal(r.events[0].detail.initial_stock, 30);
  assert.equal(r.patch.current_qty, 30);
});

test('decideChanges: new product that arrives already sold out emits drop + sold_out', () => {
  const r = decideChanges(null, { price: 100, compare_at: null, qty: 0, available: false }, 1000);
  assert.deepEqual(r.events.map(e => e.type), ['drop', 'sold_out']);
  assert.equal(r.patch.sold_out_at, 1000);
});

test('decideChanges: no change writes nothing', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 5, current_available: 1, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 5, available: true }, 2000);
  assert.equal(r.writeStock, false);
  assert.equal(r.writePrice, false);
  assert.equal(r.events.length, 0);
});

test('decideChanges: stock drop to zero emits sold_out and records first sold_out_at', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 3, current_available: 1, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 0, available: false }, 3000);
  assert.equal(r.writeStock, true);
  assert.deepEqual(r.events.map(e => e.type), ['sold_out']);
  assert.equal(r.patch.sold_out_at, 3000);
});

test('decideChanges: second sellout emits event but keeps first sold_out_at', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 2, current_available: 1, sold_out_at: 500, restock_count: 1, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 0, available: false }, 9000);
  assert.deepEqual(r.events.map(e => e.type), ['sold_out']);
  assert.equal(r.patch.sold_out_at, undefined); // not overwritten
});

test('decideChanges: restock after zero bumps restock_count', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 0, current_available: 0, sold_out_at: 500, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 8, available: true }, 4000);
  assert.deepEqual(r.events.map(e => e.type), ['restock']);
  assert.equal(r.patch.restock_count, 1);
});

test('decideChanges: price change emits price_change and writes price', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 5, current_available: 1, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 120, compare_at: 150, qty: 5, available: true }, 5000);
  assert.equal(r.writePrice, true);
  assert.deepEqual(r.events.map(e => e.type), ['price_change']);
  assert.equal(r.events[0].detail.to, 120);
});

test('decideChanges: new product with unknown qty records drop but null initial_stock, no stock row, no sold_out', () => {
  const r = decideChanges(null, { price: 100, compare_at: null, qty: null, available: true }, 1000);
  assert.equal(r.isNew, true);
  assert.equal(r.writeStock, false);
  assert.equal(r.writePrice, true);
  assert.deepEqual(r.events.map(e => e.type), ['drop']);
  assert.equal(r.events[0].detail.initial_stock, null);
  assert.equal('current_qty' in r.patch, false); // never overwrite with a guess
});

test('decideChanges: existing product with unknown qty writes no stock, preserves qty, no events', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 5, current_available: 1, initial_stock: 20, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: null, available: true }, 2000);
  assert.equal(r.writeStock, false);
  assert.equal(r.events.length, 0);
  assert.equal('current_qty' in r.patch, false); // prev qty preserved
});

test('decideChanges: unknown qty still records a price change (price is always known)', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 5, current_available: 1, initial_stock: 20, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 90, compare_at: null, qty: null, available: true }, 2500);
  assert.equal(r.writePrice, true);
  assert.deepEqual(r.events.map(e => e.type), ['price_change']);
});

test('decideChanges: backfills initial_stock on first real reading, no spurious transition event', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: null, current_available: 1, initial_stock: null, sold_out_at: null, restock_count: 0, delisted_at: null };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 12, available: true }, 3000);
  assert.equal(r.writeStock, true); // baseline row
  assert.equal(r.patch.initial_stock, 12);
  assert.equal(r.events.length, 0); // no sold_out/restock without a prior baseline
});

test('decideChanges: reappearance after delist emits relisted and clears delisted_at', () => {
  const prev = { current_price: 100, current_compare_at: null, current_qty: 5, current_available: 1, sold_out_at: null, restock_count: 0, delisted_at: 700 };
  const r = decideChanges(prev, { price: 100, compare_at: null, qty: 5, available: true }, 6000);
  assert.ok(r.events.some(e => e.type === 'relisted'));
  assert.equal(r.patch.delisted_at, null);
});
