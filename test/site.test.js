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
const now = Date.now();
const oldTime = now - 86400000; // 1 day ago
g.insertProduct({ store: 'guitarsgarden.com', id: '2', title: 'Firefly FF338 (Red)', handle: 'ff338-red',
  variant_id: '10', first_seen_at: oldTime, launch_price: 279, current_price: 279, currency: 'USD',
  current_qty: 0, current_available: 0, initial_stock: 10, last_seen_at: oldTime, raw_json: '{}', image: 'https://example.com/ff338-red.jpg', delisted_at: oldTime });
g.insertProduct({ store: 'guitarsgarden.com', id: '1', title: 'Firefly FF338 (Blue)', handle: 'ff338-blue',
  variant_id: '9', first_seen_at: now, launch_price: 279, current_price: 279, currency: 'USD',
  current_qty: 4, current_available: 1, initial_stock: 20, last_seen_at: now, raw_json: '{}', image: 'https://example.com/ff338-blue.jpg' });
g.recordRun('guitarsgarden.com', Date.now(), 2, 2, 100, null);
w.syncModels(require('../content/models.json'));
w.mapProduct({ store: 'guitarsgarden.com', productId: '2', modelSlug: 'ff338', finish: 'Red', source: 'auto' });
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

test('models index card shows most recent product image', async () => {
  const html = await (await fetch(base + '/models')).text();
  assert.ok(html.includes('https://example.com/ff338-blue.jpg'));
  assert.ok(!html.includes('https://example.com/ff338-red.jpg'));
});

test('listing with invalid store code 404s', async () => {
  const r = await fetch(base + '/listing/xx/1');
  assert.equal(r.status, 404);
  assert.ok((await r.text()).includes('Not found'));
});

test('listing with non-existent product id 404s', async () => {
  const r = await fetch(base + '/listing/us/999999');
  assert.equal(r.status, 404);
  assert.ok((await r.text()).includes('Not found'));
});
