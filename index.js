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
  app.use((req, res, next) => {
    if (req.method !== 'GET' || cfg.SITE_ENV === 'dev') return next();
    const hit = cache.get(req.originalUrl);
    if (hit && hit.exp > Date.now()) { res.set(hit.headers); return res.status(hit.status).send(hit.body); }
    const send = res.send.bind(res);
    res.send = body => {
      if (res.statusCode === 200) cache.set(req.originalUrl, {
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
