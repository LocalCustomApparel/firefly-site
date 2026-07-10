'use strict';
const fs = require('fs');
const path = require('path');

// minimal .env loader — no dep
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const STORES = {
  us: { code: 'us', store: 'guitarsgarden.com', base: 'https://guitarsgarden.com', currency: 'USD', adapter: 'shopify', pings: true, label: 'US' },
  uk: { code: 'uk', store: 'guitarsgarden.co.uk', base: 'https://www.guitarsgarden.co.uk', currency: 'GBP', adapter: 'shoplazza', pings: false, label: 'UK' },
};
const byStore = {};
for (const s of Object.values(STORES)) byStore[s.store] = s;

module.exports = {
  STORES, byStore,
  storeByCode: code => STORES[code] || null,
  SITE_ENV: process.env.SITE_ENV || 'dev',
  SITE_URL: (process.env.SITE_URL || 'http://localhost:3003').replace(/\/$/, ''),
  SITE_NAME: process.env.SITE_NAME || 'FireflyDB',
  PORT: Number(process.env.PORT || 3003),
  GUITARS_DB: process.env.GUITARS_DB || path.join(__dirname, 'guitars.db'),
  FFWIKI_DB: process.env.FFWIKI_DB || path.join(__dirname, 'ffwiki.db'),
  BMAC_URL: process.env.BMAC_URL || '',
  CONTACT_EMAIL: process.env.CONTACT_EMAIL || '',
};
