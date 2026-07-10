'use strict';
const http = require('./http');
const { RateLimited, browserHeaders } = require('./errors');
const { parseAddedQuantity } = require('../lib/decide');

const REQ_QTY = 9999;

function normalize(p, storeCfg) {
  const v = p.variants && p.variants[0];
  if (!v) return null;
  return {
    id: String(p.id), variantId: String(v.id), sku: v.sku || null, handle: p.handle,
    title: p.title, vendor: p.vendor, productType: p.product_type,
    tags: Array.isArray(p.tags) ? p.tags.join(',') : (p.tags || ''),
    image: (p.images && p.images[0] && p.images[0].src) || null,
    price: Number(v.price), compareAt: v.compare_at_price != null ? Number(v.compare_at_price) : null,
    available: !!v.available, raw: p,
  };
}

async function fetchCatalog(storeCfg) {
  const products = [];
  for (let page = 1; page <= 50; page++) {
    const r = await http.httpImpl(`${storeCfg.base}/products.json?limit=250&page=${page}`, {
      headers: browserHeaders({ 'Accept': 'application/json' }),
    });
    if (r.status === 429 || r.status === 403 || r.status === 503) throw new RateLimited(`products.json page ${page} → HTTP ${r.status}`);
    if (!r.ok) throw new Error(`products.json page ${page} → HTTP ${r.status}`);
    let batch;
    try { batch = JSON.parse(r.text).products || []; } catch { throw new RateLimited(`products.json page ${page} → non-JSON (challenge?)`); }
    if (!batch.length) break;
    products.push(...batch);
  }
  return products.map(p => normalize(p, storeCfg)).filter(Boolean);
}

// Returns exact stock (int), 0, or null when the reading is genuinely unknown (unexpected
// status). Throws RateLimited on a 429 / bot-challenge so the caller can back off.
async function fetchQuantity(storeCfg, variantId) {
  const r = await http.httpImpl(`${storeCfg.base}/cart/add.js`, {
    method: 'POST',
    headers: browserHeaders({
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${storeCfg.base}/`,
      'Origin': storeCfg.base,
    }),
    body: JSON.stringify({ items: [{ id: variantId, quantity: REQ_QTY }] }),
  });
  if (r.status === 429 || r.status === 403 || r.status === 503) throw new RateLimited(`cart/add.js ${variantId} → HTTP ${r.status}`);
  // Shopify serves cart/add.js as text/javascript (still a JSON body); a body that won't
  // parse is a challenge/interstitial page.
  let j;
  try { j = JSON.parse(r.text); } catch { throw new RateLimited(`cart/add.js ${variantId} → non-JSON body (challenge?)`); }
  if (r.status === 422) return parseAddedQuantity({ status: 422, message: j.message || j.description }, REQ_QTY);
  // A 200 means the store accepted all REQ_QTY (9999) — the product has inventory tracking
  // off / oversell on. Its true count is unknowable, so return null (unknown) rather than
  // recording the request ceiling, which would permanently poison initial_stock and stats.
  if (r.ok) return null;
  return null; // unexpected but non-challenge status → unknown, not fatal
}

module.exports = { normalize, fetchCatalog, fetchQuantity, supportsPings: true };
