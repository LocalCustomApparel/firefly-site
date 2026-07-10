'use strict';
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function guessModel(title, models) {
  if (!title) return null;
  const candidates = [];
  for (const m of models) {
    for (const alias of m.aliases) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRe(alias)}($|[^A-Za-z0-9])`, 'i');
      if (re.test(title)) candidates.push({ slug: m.slug, len: alias.length });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.len - a.len);
  let finish = null;
  const paren = /\(([^)]+)\)\s*$/.exec(title.trim());
  if (paren) finish = paren[1].trim();
  else {
    const tail = /\bin\s+([A-Z][\w\s-]{2,30})$/i.exec(title.trim());
    if (tail) finish = tail[1].trim();
  }
  return { slug: candidates[0].slug, finish };
}
module.exports = { guessModel };
