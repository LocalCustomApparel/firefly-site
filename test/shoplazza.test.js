'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { parseSitemapProductUrls, parseProductPage, fetchCatalog, maybeGunzip } = require('../scrape/shoplazza');
const { RateLimited } = require('../scrape/errors');
const { setHttpImpl } = require('../scrape/http');

const xml = fs.readFileSync(path.join(__dirname, 'fixtures/shoplazza-sitemap.xml'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/shoplazza-product.html'), 'utf8');
const realGzipChildFixture = fs.readFileSync(path.join(__dirname, 'fixtures/shoplazza-sitemap-child.xml.gz'));

const fakeStore = { base: 'https://fake.test' };

test.after(() => setHttpImpl(require('../scrape/http').curlHttp)); // restore the real impl

function textResp(status, text) {
  return { status, ok: status >= 200 && status < 300, text, buffer: Buffer.from(text, 'utf8') };
}
function gzResp(status, text) {
  const buf = zlib.gzipSync(Buffer.from(text, 'utf8'));
  return { status, ok: status >= 200 && status < 300, text: buf.toString('utf8'), buffer: buf };
}
function urlset(locs) {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map(l => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
}
function sitemapIndex(locs) {
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map(l => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;
}
function productHtml({ name = 'Test Guitar', price = 249, available = true } = {}) {
  const block = {
    '@type': 'Product', name,
    offers: { '@type': 'Offer', price, availability: `http://schema.org/${available ? 'InStock' : 'OutOfStock'}` },
  };
  return `<html><body><script type="application/ld+json">${JSON.stringify(block)}</script></body></html>`;
}

// --- real-fixture tests (Step 2/5 from the brief) ---

test('sitemap yields product urls', () => {
  const urls = parseSitemapProductUrls(xml);
  assert.ok(urls.length > 0);
  assert.ok(urls.every(u => u.includes('/products/')));
});

test('product page parses to normalized shape', () => {
  const n = parseProductPage(html, 'https://www.guitarsgarden.co.uk/products/example');
  assert.ok(n.title.length > 0);
  assert.equal(typeof n.price, 'number');
  assert.equal(typeof n.available, 'boolean');
  assert.equal(n.handle, 'example');
  assert.equal(n.id, 'example'); // handle-keyed
});

test('product page: real fixture is OutOfStock, priced at 199, no sku, vendor falls back to Firefly', () => {
  const n = parseProductPage(html, 'https://www.guitarsgarden.co.uk/products/example');
  assert.equal(n.available, false);
  assert.equal(n.price, 199);
  assert.equal(n.sku, null);
  assert.equal(n.variantId, null);
  assert.equal(n.vendor, 'Firefly');
  assert.ok(typeof n.image === 'string' && n.image.startsWith('http'));
});

test('parseProductPage returns null when the page has no Product JSON-LD block', () => {
  const n = parseProductPage('<html><body>no ld+json here</body></html>', 'https://fake.test/products/x');
  assert.equal(n, null);
});

test('maybeGunzip decompresses real gzipped child sitemap fixture and yields product urls', () => {
  const inflated = maybeGunzip(realGzipChildFixture);
  const urls = parseSitemapProductUrls(inflated);
  assert.ok(urls.length > 0, 'real child sitemap should yield product urls');
  assert.ok(urls.every(u => u.includes('/products/')), 'all urls should be product urls');
});

// --- fetchCatalog behavior (mocked httpImpl; no live network in tests) ---

test('fetchCatalog reads product urls straight off sitemap.xml and normalizes each product', async () => {
  setHttpImpl(async url => {
    if (url === 'https://fake.test/sitemap.xml') {
      return textResp(200, urlset(['https://fake.test/products/p1', 'https://fake.test/products/p2']));
    }
    if (url === 'https://fake.test/products/p1') return textResp(200, productHtml({ name: 'P1', price: 100, available: true }));
    if (url === 'https://fake.test/products/p2') return textResp(200, productHtml({ name: 'P2', price: 200, available: false }));
    throw new Error(`unexpected url ${url}`);
  });
  const products = await fetchCatalog(fakeStore);
  assert.equal(products.length, 2);
  assert.deepEqual(products.map(p => p.handle), ['p1', 'p2']);
  assert.equal(products[0].price, 100);
  assert.equal(products[0].available, true);
  assert.equal(products[1].available, false);
});

test('fetchCatalog follows a sitemap index to a gzip-compressed product child sitemap', async () => {
  setHttpImpl(async url => {
    if (url === 'https://fake.test/sitemap.xml') {
      return textResp(200, sitemapIndex(['https://fake.test/sitemap_pages_1.xml.gz', 'https://fake.test/sitemap_products_1.xml.gz']));
    }
    if (url === 'https://fake.test/sitemap_pages_1.xml.gz') return gzResp(200, urlset(['https://fake.test/']));
    if (url === 'https://fake.test/sitemap_products_1.xml.gz') return gzResp(200, urlset(['https://fake.test/products/p1']));
    if (url === 'https://fake.test/products/p1') return textResp(200, productHtml({ name: 'P1', price: 150, available: true }));
    throw new Error(`unexpected url ${url}`);
  });
  const products = await fetchCatalog(fakeStore);
  assert.equal(products.length, 1);
  assert.equal(products[0].handle, 'p1');
  assert.equal(products[0].price, 150);
});

test('fetchCatalog skips a single bad product page and keeps going', async () => {
  setHttpImpl(async url => {
    if (url === 'https://fake.test/sitemap.xml') {
      return textResp(200, urlset(['https://fake.test/products/bad', 'https://fake.test/products/good']));
    }
    if (url === 'https://fake.test/products/bad') return textResp(200, '<html>no structured data</html>');
    if (url === 'https://fake.test/products/good') return textResp(200, productHtml({ name: 'Good', price: 300 }));
    throw new Error(`unexpected url ${url}`);
  });
  const products = await fetchCatalog(fakeStore);
  assert.equal(products.length, 1);
  assert.equal(products[0].handle, 'good');
});

test('fetchCatalog bails the whole cycle when a product page is rate-limited', async () => {
  setHttpImpl(async url => {
    if (url === 'https://fake.test/sitemap.xml') {
      return textResp(200, urlset(['https://fake.test/products/p1', 'https://fake.test/products/p2']));
    }
    if (url === 'https://fake.test/products/p1') return textResp(429, '');
    throw new Error(`unexpected url ${url}`);
  });
  await assert.rejects(() => fetchCatalog(fakeStore), RateLimited);
});

test('fetchCatalog throws RateLimited when sitemap.xml itself is blocked', async () => {
  for (const status of [429, 403, 503]) {
    setHttpImpl(async () => textResp(status, ''));
    await assert.rejects(() => fetchCatalog(fakeStore), RateLimited);
  }
});
