'use strict';
const cfg = require('../config');
const gdb = require('../db/guitars').open(cfg.GUITARS_DB, { readonly: true });
const wdb = require('../db/wiki').open(cfg.FFWIKI_DB);
const { guessModel } = require('../lib/models');
const registry = require('../content/models.json');

wdb.syncModels(registry);
const models = wdb.allModels();
let mapped = 0, corrected = 0, skipped = 0;
const unmatched = [];
for (const p of gdb.allTitles()) {
  const existing = wdb.mappingFor(p.store, p.id);
  if (existing && existing.source === 'manual') { skipped++; continue; }
  const guess = guessModel(p.title, models);
  if (guess) {
    if (existing && existing.model_slug === guess.slug && existing.finish === guess.finish) { skipped++; continue; }
    wdb.mapProduct({ store: p.store, productId: p.id, modelSlug: guess.slug, finish: guess.finish, source: 'auto' });
    if (existing) corrected++; else mapped++;
  } else if (!existing) unmatched.push(`${p.store} ${p.id}  ${p.title}`);
}
console.log(`[map-models] mapped ${mapped}, corrected ${corrected}, already-mapped ${skipped}, unmatched ${unmatched.length}`);
for (const u of unmatched) console.log('  ? ' + u);
gdb.close(); wdb.close();
