'use strict';
const cfg = require('../config');
const gdb = require('../db/guitars').open(cfg.GUITARS_DB, { readonly: true });
const wdb = require('../db/wiki').open(cfg.FFWIKI_DB);
const { guessModel } = require('../lib/models');
const registry = require('../content/models.json');

wdb.syncModels(registry);
const models = wdb.allModels();
let mapped = 0, skipped = 0;
const unmatched = [];
for (const p of gdb.allTitles()) {
  if (wdb.mappingFor(p.store, p.id)) { skipped++; continue; }
  const guess = guessModel(p.title, models);
  if (guess) { wdb.mapProduct({ store: p.store, productId: p.id, modelSlug: guess.slug, finish: guess.finish, source: 'auto' }); mapped++; }
  else unmatched.push(`${p.store} ${p.id}  ${p.title}`);
}
console.log(`[map-models] mapped ${mapped}, already-mapped ${skipped}, unmatched ${unmatched.length}`);
for (const u of unmatched) console.log('  ? ' + u);
gdb.close(); wdb.close();
