'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.SITE_ENV = 'production';
const { esc, money, layout } = require('../lib/render');

test('esc escapes html', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});
test('money renders currency symbols', () => {
  assert.equal(money(279.9, 'USD'), '$279.90');
  assert.equal(money(199, 'GBP'), '£199.00');
  assert.equal(money(null, 'USD'), '—');
});
test('layout carries disclaimer, nav and canonical', () => {
  const html = layout({ title: 'T', desc: 'D', path: '/live', body: '<p>x</p>' });
  assert.ok(html.includes('Unofficial fan site — not affiliated with Firefly Guitars or Guitars Garden.'));
  assert.ok(html.includes('href="/models"'));
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(!html.includes('name="robots"')); // production, not a noindex page
});
test('noindexPage forces robots meta', () => {
  assert.ok(layout({ title: 'T', desc: '', path: '/x', body: '', noindexPage: true }).includes('noindex'));
});
