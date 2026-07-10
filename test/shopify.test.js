'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize, fetchCatalog, fetchQuantity } = require('../scrape/shopify');
const { RateLimited } = require('../scrape/errors');
const { setHttpImpl } = require('../scrape/http');
const cfg = require('../config');
const fixture = require('./fixtures/shopify-product.json');

const fakeStore = { base: 'https://fake.test' };

function resp(status, obj) {
  const text = obj == null ? '<html>challenge</html>' : JSON.stringify(obj);
  return { status, ok: status >= 200 && status < 300, text };
}

function product(id, { title = 'Firefly X', price = '100.00', compareAt = null, available = true } = {}) {
  return {
    id, handle: 'h' + id, title, vendor: 'GG', product_type: 'PE', tags: ['t'],
    images: [{ src: 'img' + id }],
    variants: [{ id: id * 10, sku: 'SKU' + id, price, compare_at_price: compareAt, available }],
  };
}

test.after(() => setHttpImpl(require('../scrape/http').curlHttp)); // restore the real impl

test('normalize maps shopify product to adapter shape', () => {
  const n = normalize(fixture, cfg.STORES.us);
  assert.equal(typeof n.id, 'string');
  assert.equal(typeof n.variantId, 'string');
  assert.equal(typeof n.price, 'number');
  assert.equal(typeof n.available, 'boolean');
  assert.ok(n.title.length > 0);
  assert.ok(n.raw === fixture);
});

test('normalize returns null for variant-less product', () => {
  assert.equal(normalize({ id: 1, title: 'x', variants: [] }, cfg.STORES.us), null);
});

test('fetchCatalog paginates until an empty page and normalizes each product', async () => {
  const pages = [[product(1), product(2)], [product(3)], []];
  setHttpImpl(async url => {
    const m = url.match(/[?&]page=(\d+)/);
    const page = m ? Number(m[1]) : 1;
    return resp(200, { products: pages[page - 1] || [] });
  });
  const products = await fetchCatalog(fakeStore);
  assert.equal(products.length, 3);
  assert.deepEqual(products.map(p => p.id), ['1', '2', '3']);
  assert.equal(products[0].price, 100);
});

test('fetchCatalog drops variant-less products via normalize', async () => {
  const page1 = [product(1), { id: 2, handle: 'h2', title: 'No Variant', vendor: 'GG', product_type: 'X', tags: [], images: [], variants: [] }];
  setHttpImpl(async url => {
    const m = url.match(/[?&]page=(\d+)/);
    const page = m ? Number(m[1]) : 1;
    return resp(200, { products: page === 1 ? page1 : [] });
  });
  const products = await fetchCatalog(fakeStore);
  assert.equal(products.length, 1);
  assert.equal(products[0].id, '1');
});

test('fetchCatalog throws RateLimited on 429/403/503', async () => {
  for (const status of [429, 403, 503]) {
    setHttpImpl(async () => resp(status, null));
    await assert.rejects(() => fetchCatalog(fakeStore), RateLimited);
  }
});

test('fetchCatalog throws RateLimited on a non-JSON (challenge page) response', async () => {
  setHttpImpl(async () => ({ status: 200, ok: true, text: '<html>challenge</html>' }));
  await assert.rejects(() => fetchCatalog(fakeStore), RateLimited);
});

test('fetchQuantity 422 parses the added quantity from the availability message', async () => {
  setHttpImpl(async () => resp(422, { message: 'Only 7 items were added to your cart due to availability.' }));
  const qty = await fetchQuantity(fakeStore, 999);
  assert.equal(qty, 7);
});

test('fetchQuantity 200 (untracked inventory / addedAll) returns null, never the request ceiling', async () => {
  setHttpImpl(async () => resp(200, { items: [{ quantity: 9999 }] }));
  const qty = await fetchQuantity(fakeStore, 999);
  assert.equal(qty, null);
});

test('fetchQuantity 429 throws RateLimited', async () => {
  setHttpImpl(async () => resp(429, null));
  await assert.rejects(() => fetchQuantity(fakeStore, 999), RateLimited);
});

test('fetchQuantity non-JSON body (challenge page) throws RateLimited', async () => {
  setHttpImpl(async () => ({ status: 200, ok: true, text: '<html>challenge</html>' }));
  await assert.rejects(() => fetchQuantity(fakeStore, 999), RateLimited);
});
