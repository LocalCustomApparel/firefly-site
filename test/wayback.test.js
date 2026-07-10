'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { collapseSnapshots, reconstructUS } = require('../scripts/wayback-backfill');

const cdx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cdx-sample.json'), 'utf8'));
// guitarsgarden.com/products.json was never archived (confirmed via live CDX query at
// discovery time — empty result). Real fixture is an archived HTML product page instead
// (guitarsgarden.com/products/ffja-electric-guitars-cream-color-sb, captured 2022-06-28);
// reconstructUS falls back to the JSON-LD parser (see scripts/wayback-backfill.js) and
// tags these rows confidence: 'range' rather than 'exact'.
const pageHtml = fs.readFileSync(path.join(__dirname, 'fixtures/wayback-product-page.html'), 'utf8');

test('collapseSnapshots turns CDX rows into timestamped urls', () => {
  const snaps = collapseSnapshots(cdx);
  assert.ok(snaps.length > 0);
  assert.match(snaps[0].ts14, /^\d{14}$/);
  assert.ok(snaps[0].url.includes('id_/'));
});

test('reconstructUS aggregates per-handle ranges from snapshots (HTML page fallback)', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const rows = await reconstructUS(collapseSnapshots(cdx).slice(0, 1), fetchImpl, { delayMs: 0 });
  assert.ok(rows.length > 0);
  const r = rows[0];
  assert.equal(r.store, 'guitarsgarden.com');
  assert.equal(r.currency, 'USD');
  assert.equal(r.confidence, 'range');
  assert.ok(r.handle && r.firstSnapshotAt <= r.lastSnapshotAt);
});

test('reconstructUS aggregates per-handle ranges from snapshots (products.json catalog, forward-compat)', async () => {
  const productsJson = JSON.stringify({ products: [
    { handle: 'firefly-fflg', title: 'Firefly FFLG', variants: [{ price: '199.00' }] },
  ] });
  const fetchImpl = async () => ({ ok: true, text: async () => productsJson });
  const rows = await reconstructUS(collapseSnapshots(cdx).slice(0, 1), fetchImpl, { delayMs: 0 });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.store, 'guitarsgarden.com');
  assert.equal(r.currency, 'USD');
  assert.equal(r.confidence, 'exact');
  assert.equal(r.handle, 'firefly-fflg');
  assert.equal(r.price, 199);
});

test('reconstructUS aggregates min/max snapshot timestamps across repeated handles', async () => {
  const snaps = [
    { ts14: '20200101000000', url: 'https://web.archive.org/web/20200101000000id_/https://guitarsgarden.com/products/x' },
    { ts14: '20210101000000', url: 'https://web.archive.org/web/20210101000000id_/https://guitarsgarden.com/products/x' },
  ];
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const rows = await reconstructUS(snaps, fetchImpl, { delayMs: 0 });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.handle, 'x');
  assert.equal(r.firstSnapshotAt, Date.parse('2020-01-01T00:00:00Z'));
  assert.equal(r.lastSnapshotAt, Date.parse('2021-01-01T00:00:00Z'));
});

