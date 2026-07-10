'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { collapseSnapshots, reconstruct, reconstructUS } = require('../scripts/wayback-backfill');

const cdx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/cdx-sample.json'), 'utf8'));
// guitarsgarden.com/products.json was never archived (confirmed via live CDX query at
// discovery time — empty result). Real fixture is an archived HTML product page instead
// (guitarsgarden.com/products/ffja-electric-guitars-cream-color-sb, captured 2022-06-28);
// reconstruct falls back to the JSON-LD parser (see scripts/wayback-backfill.js) and
// tags these rows confidence: 'range' rather than 'exact'.
const pageHtml = fs.readFileSync(path.join(__dirname, 'fixtures/wayback-product-page.html'), 'utf8');

const CDX_HEADER = ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'];

test('collapseSnapshots turns CDX rows into timestamped urls, sorted ascending', () => {
  const snaps = collapseSnapshots(cdx);
  assert.ok(snaps.length > 0);
  assert.match(snaps[0].ts14, /^\d{14}$/);
  assert.ok(snaps[0].url.includes('id_/'));
  for (let i = 1; i < snaps.length; i++) assert.ok(snaps[i - 1].ts14 <= snaps[i].ts14);
});

test('reconstructUS aggregates per-handle ranges from snapshots (HTML page fallback)', async () => {
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const { rows } = await reconstructUS(collapseSnapshots(cdx).slice(0, 1), fetchImpl, { delayMs: 0 });
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
  const { rows } = await reconstructUS(collapseSnapshots(cdx).slice(0, 1), fetchImpl, { delayMs: 0 });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.store, 'guitarsgarden.com');
  assert.equal(r.currency, 'USD');
  assert.equal(r.confidence, 'exact');
  assert.equal(r.handle, 'firefly-fflg');
  assert.equal(r.price, 199);
});

test('shared path: two snapshots of one handle fold to ONE row with min/max, upserted incrementally', async () => {
  const snaps = [
    { ts14: '20200101000000', url: 'https://web.archive.org/web/20200101000000id_/https://guitarsgarden.co.uk/products/x' },
    { ts14: '20210101000000', url: 'https://web.archive.org/web/20210101000000id_/https://guitarsgarden.co.uk/products/x?variant=abc' },
  ];
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const persisted = [];
  const { rows } = await reconstruct(snaps, fetchImpl, {
    store: 'guitarsgarden.co.uk', currency: 'GBP', delayMs: 0,
    persist: r => persisted.push({ ...r }),
  });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.store, 'guitarsgarden.co.uk');
  assert.equal(r.currency, 'GBP');
  assert.equal(r.handle, 'x');
  assert.equal(r.firstSnapshotAt, Date.parse('2020-01-01T00:00:00Z'));
  assert.equal(r.lastSnapshotAt, Date.parse('2021-01-01T00:00:00Z'));
  // one upsert per snapshot (incremental persistence), all under the same stable key
  assert.equal(persisted.length, 2);
  assert.ok(persisted.every(p => p.handle === 'x' && p.firstSnapshotAt === r.firstSnapshotAt));
  assert.equal(persisted[1].lastSnapshotAt, r.lastSnapshotAt);
});

test('out-of-order CDX rows are processed ascending: first_snapshot_at is the true earliest and never shifts', async () => {
  const mk = ts => ['com,guitarsgarden)/products/x', ts, 'https://guitarsgarden.com/products/x', 'text/html', '200', 'D' + ts, '1'];
  const outOfOrder = [CDX_HEADER, mk('20230101000000'), mk('20200101000000'), mk('20210101000000')];
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const persisted = [];
  const { rows } = await reconstructUS(collapseSnapshots(outOfOrder), fetchImpl, {
    delayMs: 0, persist: r => persisted.push({ ...r }),
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].firstSnapshotAt, Date.parse('2020-01-01T00:00:00Z'));
  assert.equal(rows[0].lastSnapshotAt, Date.parse('2023-01-01T00:00:00Z'));
  // every incremental upsert used the same (stable) first_snapshot_at key
  assert.equal(persisted.length, 3);
  assert.ok(persisted.every(p => p.firstSnapshotAt === Date.parse('2020-01-01T00:00:00Z')));
});

test('known (live-tracked) handles are skipped before folding and counted once', async () => {
  const snaps = [
    { ts14: '20200101000000', url: 'https://web.archive.org/web/20200101000000id_/https://guitarsgarden.com/products/live' },
    { ts14: '20210101000000', url: 'https://web.archive.org/web/20210101000000id_/https://guitarsgarden.com/products/live' },
    { ts14: '20220101000000', url: 'https://web.archive.org/web/20220101000000id_/https://guitarsgarden.com/products/archived-only' },
  ];
  const fetchImpl = async () => ({ ok: true, text: async () => pageHtml });
  const persisted = [];
  const { rows, skippedLive } = await reconstructUS(snaps, fetchImpl, {
    delayMs: 0, known: new Set(['live']), persist: r => persisted.push({ ...r }),
  });
  assert.equal(skippedLive, 1); // handle-level, not per-snapshot
  assert.equal(rows.length, 1);
  assert.equal(rows[0].handle, 'archived-only');
  assert.ok(persisted.every(p => p.handle !== 'live'));
});
