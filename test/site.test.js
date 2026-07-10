'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SITE_ENV = 'staging';
const gopen = require('../db/guitars').open;
const wopen = require('../db/wiki').open;
const { createApp } = require('../index');

const GDB = path.join(os.tmpdir(), `ff-site-g-${process.pid}.db`);
const WDB = path.join(os.tmpdir(), `ff-site-w-${process.pid}.db`);
const g = gopen(GDB), w = wopen(WDB);
g.insertProduct({ store: 'guitarsgarden.com', id: '1', title: 'Firefly FF338 (Blue)', handle: 'ff338-blue',
  variant_id: '9', first_seen_at: Date.now(), launch_price: 279, current_price: 279, currency: 'USD',
  current_qty: 4, current_available: 1, initial_stock: 20, last_seen_at: Date.now(), raw_json: '{}' });
g.recordRun('guitarsgarden.com', Date.now(), 1, 1, 100, null);
w.syncModels(require('../content/models.json'));
w.mapProduct({ store: 'guitarsgarden.com', productId: '1', modelSlug: 'ff338', finish: 'Blue', source: 'auto' });

let server, base;
test.before(async () => {
  server = createApp({ gdb: g, wdb: w }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); g.close(); w.close(); try { fs.unlinkSync(GDB); fs.unlinkSync(WDB); } catch {} });

test('home renders with freshness stamp and noindex header in staging', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  const html = await r.text();
  assert.ok(html.includes('FF338'));
  assert.ok(/just now|min ago/.test(html));
});

test('live board links mapped product to its model page', async () => {
  const html = await (await fetch(base + '/live')).text();
  assert.ok(html.includes('href="/models/ff338"'));
  assert.ok(html.includes('US'));
});

test('drops filters by store', async () => {
  const all = await (await fetch(base + '/drops')).text();
  assert.ok(all.includes('FF338'));
  const uk = await (await fetch(base + '/drops?store=uk')).text();
  assert.ok(!uk.includes('FF338'));
});

test('model page renders specs, drop history and jsonld', async () => {
  const r = await fetch(base + '/models/ff338');
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('FF338'));
  assert.ok(html.includes('application/ld+json'));
  assert.ok(html.includes('Firefly FF338 (Blue)')); // mapped product listed
});
test('unknown model 404s with a page', async () => {
  const r = await fetch(base + '/models/nope');
  assert.equal(r.status, 404);
  assert.ok((await r.text()).includes('/models'));
});
test('listing page renders and is noindexed even in production markup', async () => {
  const html = await (await fetch(base + '/listing/us/1')).text();
  assert.ok(html.includes('Firefly FF338 (Blue)'));
  assert.ok(html.includes('noindex'));
});
