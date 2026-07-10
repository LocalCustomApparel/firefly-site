'use strict';
const zlib = require('zlib');
const http = require('./http');
const { RateLimited, browserHeaders, sleep } = require('./errors');

const PAGE_DELAY_MS = 1200;

function parseSitemapProductUrls(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
  return locs.filter(u => u.includes('/products/'));
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
}

// Shoplazza's per-type sitemaps (products/collections/pages) are served as raw gzip bodies
// (content-type application/x-gzip) even without a .gz URL suffix and without a
// Content-Encoding header — curl's --compressed doesn't touch them. Sniff the gzip magic
// bytes (1f 8b) rather than trust the URL, since the server ignores the extension anyway.
function maybeGunzip(buffer) {
  if (buffer && buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return zlib.gunzipSync(buffer).toString('utf8');
  }
  return buffer ? buffer.toString('utf8') : '';
}

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
    .map(m => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean);
}

function parseProductPage(html, url) {
  const handle = url.split('/products/')[1].split(/[?#]/)[0].replace(/\/$/, '');
  const blocks = jsonLdBlocks(html).flatMap(b => Array.isArray(b) ? b : [b]);
  const prod = blocks.find(b => b['@type'] === 'Product' || (Array.isArray(b['@type']) && b['@type'].includes('Product')));
  if (!prod) return null;
  const offers = [].concat(prod.offers || [])[0] || {};
  return {
    id: handle, variantId: null, sku: prod.sku || null, handle,
    title: prod.name || '', vendor: (prod.brand && prod.brand.name) || 'Firefly',
    productType: '', tags: '',
    image: [].concat(prod.image || [])[0] || null,
    price: Number(offers.price || 0),
    compareAt: null,
    available: /InStock/i.test(String(offers.availability || '')),
    raw: prod,
  };
}

async function fetchRaw(url, headers) {
  const r = await http.httpImpl(url, { headers: browserHeaders(headers) });
  if (r.status === 429 || r.status === 403 || r.status === 503) throw new RateLimited(`${url} → HTTP ${r.status}`);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r;
}

async function fetchPage(url) {
  const r = await fetchRaw(url, {});
  return r.text;
}

// Sitemap responses may be raw-gzip bodies (see maybeGunzip) — decode via the buffer, not text.
async function fetchSitemapXml(url) {
  const r = await fetchRaw(url, { Accept: 'application/xml, text/xml, */*' });
  return maybeGunzip(r.buffer);
}

async function fetchCatalog(storeCfg) {
  const rootXml = await fetchSitemapXml(`${storeCfg.base}/sitemap.xml`);
  let urls = parseSitemapProductUrls(rootXml);
  if (!urls.length) {
    // sitemap index: try each child sitemap until one yields product urls
    const children = extractLocs(rootXml);
    for (const child of children) {
      await sleep(PAGE_DELAY_MS);
      urls = parseSitemapProductUrls(await fetchSitemapXml(child));
      if (urls.length) break;
    }
  }
  const out = [];
  for (const url of urls) {
    await sleep(PAGE_DELAY_MS);
    try {
      const n = parseProductPage(await fetchPage(url), url);
      if (n) out.push(n);
    } catch (e) {
      if (e instanceof RateLimited) throw e; // bail the whole store cycle
      // single bad page: skip, keep going
    }
  }
  return out;
}

module.exports = { parseSitemapProductUrls, parseProductPage, fetchCatalog, supportsPings: false };
