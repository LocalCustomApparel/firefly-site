'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../db/wiki');
const models = require('../content/models.json');

const DB = path.join(os.tmpdir(), `ff-wiki-${process.pid}.db`);
const w = open(DB);
test.after(() => { w.close(); try { fs.unlinkSync(DB); } catch {} });

test('syncModels upserts and is idempotent', () => {
  w.syncModels(models);
  w.syncModels(models);
  assert.equal(w.allModels().length, models.length);
  assert.equal(w.getModel('ff338').name, 'FF338');
});

test('manual mapping beats auto and survives auto re-runs', () => {
  w.mapProduct({ store: 's', productId: '1', modelSlug: 'ff338', finish: 'Blue', source: 'auto' });
  w.mapProduct({ store: 's', productId: '1', modelSlug: 'ffdc', finish: 'Red', source: 'manual' });
  w.mapProduct({ store: 's', productId: '1', modelSlug: 'ff338', finish: 'Blue', source: 'auto' });
  const m = w.mappingFor('s', '1');
  assert.equal(m.model_slug, 'ffdc');
  assert.equal(m.source, 'manual');
});

test('wayback upsert is idempotent on (store,handle,first_snapshot_at)', () => {
  const row = { store: 's', handle: 'h', title: 't', modelSlug: 'ff338', price: 9, currency: 'USD',
    firstSnapshotAt: 1, lastSnapshotAt: 2, snapshotUrl: 'u', confidence: 'exact' };
  w.insertWayback(row);
  w.insertWayback({ ...row, lastSnapshotAt: 5 });
  const all = w.allWayback();
  assert.equal(all.length, 1);
  assert.equal(all[0].last_snapshot_at, 5);
});

test('links round-trip', () => {
  w.addLink({ modelSlug: 'ff338', kind: 'youtube', url: 'https://youtu.be/x', title: 'Demo', addedAt: 1 });
  assert.equal(w.linksFor('ff338').length, 1);
});

test('readonly mode: reads work, all writes throw', () => {
  const ro = open(DB, { readonly: true });

  // Reads work
  assert.equal(ro.getModel('ff338').name, 'FF338');
  assert(ro.linksFor('ff338').length > 0);

  // Writes throw with readonly message
  assert.throws(() => ro.syncModels([]), /readonly/);
  assert.throws(() => ro.mapProduct({ store: 's', productId: '999', modelSlug: 'ff338', finish: 'Blue', source: 'auto' }), /readonly/);
  assert.throws(() => ro.insertWayback({ store: 's', handle: 'hh', firstSnapshotAt: 100, lastSnapshotAt: 200 }), /readonly/);
  assert.throws(() => ro.addLink({ modelSlug: 'ff338', kind: 'blog', url: 'http://x', title: 'x' }), /readonly/);

  ro.close();
});
