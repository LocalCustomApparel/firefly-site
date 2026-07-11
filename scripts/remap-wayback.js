'use strict';
// One-off: re-guess model_slug for wayback_drops rows where it's still null, against the
// current (expanded) registry. Never touches a row that already has a non-null slug —
// those may reflect a deliberate earlier decision, and this script only fills gaps.
const cfg = require('../config');
const wdb = require('../db/wiki').open(cfg.FFWIKI_DB);
const { guessModel } = require('../lib/models');
const registry = require('../content/models.json');

wdb.syncModels(registry);
const models = wdb.allModels();
const rows = wdb.db.prepare('SELECT id, title FROM wayback_drops WHERE model_slug IS NULL').all();
const upd = wdb.db.prepare('UPDATE wayback_drops SET model_slug = ? WHERE id = ? AND model_slug IS NULL');

let mapped = 0;
const stillUnmatched = [];
wdb.db.transaction(() => {
  for (const r of rows) {
    const guess = guessModel(r.title, models);
    if (guess) { upd.run(guess.slug, r.id); mapped++; }
    else stillUnmatched.push(r.title);
  }
})();

console.log(`[remap-wayback] null-slug rows: ${rows.length}, newly mapped: ${mapped}, still unmatched: ${stillUnmatched.length}`);
for (const t of stillUnmatched) console.log('  ? ' + t);
wdb.close();
