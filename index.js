'use strict';
const express = require('express');
const path = require('path');
const cfg = require('./config');

function createApp({ gdb, wdb }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (cfg.SITE_ENV !== 'production') res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

  const cache = new Map();
  const MAX_CACHE_ENTRIES = 300;
  // Only query params a route actually reads belong in the cache key — anything else
  // (junk/tracking params) must collapse onto the canonical key or the Map is unbounded.
  const CACHEABLE_QUERY = { '/drops': { store: new Set(['us', 'uk']) } };
  const cacheKeyFor = req => {
    const spec = CACHEABLE_QUERY[req.path];
    if (!spec) return req.path;
    const parts = [];
    for (const k of Object.keys(spec)) {
      const v = req.query[k];
      if (spec[k].has(v)) parts.push(`${k}=${v}`);
    }
    return parts.length ? `${req.path}?${parts.join('&')}` : req.path;
  };
  const cacheSet = (key, entry) => {
    if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) {
      const now = Date.now();
      for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    }
    cache.set(key, entry);
  };
  app.use((req, res, next) => {
    if (req.method !== 'GET' || cfg.SITE_ENV === 'dev') return next();
    const key = cacheKeyFor(req);
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) { res.set(hit.headers); return res.status(hit.status).send(hit.body); }
    const send = res.send.bind(res);
    res.send = body => {
      if (res.statusCode === 200) cacheSet(key, {
        body, status: 200, exp: Date.now() + 300000,
        headers: { 'Content-Type': res.get('Content-Type') || 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
      });
      res.set('Cache-Control', 'public, max-age=300');
      return send(body);
    };
    next();
  });

  require('./routes/pages')(app, { gdb, wdb });
  return app;
}

if (require.main === module) {
  const gdb = require('./db/guitars').open(cfg.GUITARS_DB, { readonly: true });
  const wdb = require('./db/wiki').open(cfg.FFWIKI_DB, { readonly: true });
  createApp({ gdb, wdb }).listen(cfg.PORT, () => console.log(`[ffsite] ${cfg.SITE_ENV} on :${cfg.PORT}`));
}
module.exports = { createApp };
