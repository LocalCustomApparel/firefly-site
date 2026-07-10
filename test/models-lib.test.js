'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { guessModel } = require('../lib/models');

const MODELS = [
  { slug: 'ff338', aliases: ['FF338', 'FF-338', '338'] },
  { slug: 'ffth', aliases: ['FFTH', 'Thinline'] },
  { slug: 'ffhb', aliases: ['FFHB', 'Hollow Body', 'Hollowbody'] },
];

test('longest alias wins and finish comes from parens', () => {
  assert.deepEqual(guessModel('NEW Firefly FF338 Semi-Hollow (Trans Blue)', MODELS), { slug: 'ff338', finish: 'Trans Blue' });
});
test('multi-word alias matches', () => {
  assert.equal(guessModel('Firefly Hollow Body guitar in Sunburst', MODELS).slug, 'ffhb');
  assert.equal(guessModel('Firefly Hollow Body guitar in Sunburst', MODELS).finish, 'Sunburst');
});
test('word boundary: 338 must not match 1338x', () => {
  assert.equal(guessModel('Model X1338Z', MODELS), null);
});
test('no match returns null', () => {
  assert.equal(guessModel('Gig bag deluxe', MODELS), null);
});
