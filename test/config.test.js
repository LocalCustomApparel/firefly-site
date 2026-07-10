'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cfg = require('../config');

test('store registry shape', () => {
  assert.equal(cfg.STORES.us.store, 'guitarsgarden.com');
  assert.equal(cfg.STORES.us.currency, 'USD');
  assert.equal(cfg.STORES.us.pings, true);
  assert.equal(cfg.STORES.uk.store, 'guitarsgarden.co.uk');
  assert.equal(cfg.STORES.uk.currency, 'GBP');
  assert.equal(cfg.STORES.uk.pings, false);
  assert.equal(cfg.byStore['guitarsgarden.co.uk'].code, 'uk');
  assert.equal(cfg.storeByCode('us').base, 'https://guitarsgarden.com');
});
