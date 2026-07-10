'use strict';
const cfg = require('../config');
const { esc, money, timeAgo, md, layout } = require('../lib/render');

module.exports = (app, { gdb, wdb }) => {
  const codeOf = store => (cfg.byStore[store] || {}).code || 'us';
  const href = (mapping, store, id) => mapping ? `/models/${mapping.model_slug}` : `/listing/${codeOf(store)}/${id}`;
  const storeBadge = store => `<span class="badge">${esc((cfg.byStore[store] || {}).label || store)}</span>`;
  const mapOf = rows => {
    const m = new Map();
    for (const r of rows) m.set(`${r.store}|${r.id}`, wdb.mappingFor(r.store, r.id));
    return m;
  };

  app.get('/', (req, res) => {
    const live = gdb.live();
    const drops = gdb.drops({ limit: 8 });
    const maps = mapOf(drops);
    const body = `
<section class="hero">
  <h1>Every Firefly drop, tracked.</h1>
  <p>Live stock, drop history and a wiki for every Firefly guitar — data updated ${esc(timeAgo(gdb.lastRunTs()))}.</p>
  <p>${live.length} live now · <a href="/live">see the board</a></p>
</section>
<h2>Latest drops</h2>
<div class="grid">${drops.map(p => `
  <a class="card" href="${href(maps.get(`${p.store}|${p.id}`), p.store, p.id)}">
    ${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}
    <h3>${esc(p.title)}</h3>
    <p>${money(p.launch_price, p.currency)} ${storeBadge(p.store)} · ${esc(timeAgo(p.first_seen_at))}</p>
  </a>`).join('')}</div>`;
    res.send(layout({ title: 'Firefly guitar drop tracker & wiki', desc: 'Live stock, drop history, prices and specs for every Firefly guitar.', path: '/', body }));
  });

  app.get('/live', (req, res) => {
    const rows = gdb.live();
    const maps = mapOf(rows);
    const body = `
<h1>Live board</h1>
<p class="muted">Updated ${esc(timeAgo(gdb.lastRunTs()))} · auto-refreshes every 5 min</p>
<div class="grid">${rows.map(p => `
  <a class="card" href="${href(maps.get(`${p.store}|${p.id}`), p.store, p.id)}">
    ${p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="">` : ''}
    <h3>${esc(p.title)}</h3>
    <p>${money(p.current_price, p.currency)} ${storeBadge(p.store)} · ${p.current_qty != null ? `${p.current_qty} left` : 'qty unknown'}</p>
    ${p.initial_stock > 0 ? `<div class="bar"><i style="width:${p.pct_sold.toFixed(0)}%"></i></div>` : ''}
  </a>`).join('') || '<p>Nothing live right now — check the <a href="/drops">drop history</a>.</p>'}</div>
<script>setTimeout(() => location.reload(), 300000)</script>`;
    res.send(layout({ title: 'Live now', desc: 'Firefly guitars in stock right now across US and UK stores.', path: '/live', body }));
  });

  app.get('/drops', (req, res) => {
    const code = ['us', 'uk'].includes(req.query.store) ? req.query.store : null;
    const store = code ? cfg.storeByCode(code).store : undefined;
    const drops = gdb.drops({ store, limit: 500 }).map(p => ({
      kind: 'tracked', ts: p.first_seen_at, p,
    }));
    const wb = wdb.allWayback().filter(r => !store || r.store === store).map(r => ({ kind: 'archived', ts: r.first_snapshot_at, r }));
    const rows = drops.concat(wb).sort((a, b) => b.ts - a.ts);
    const maps = mapOf(drops.map(d => d.p));
    const body = `
<h1>Drop history</h1>
<p><a href="/drops"${!code ? ' class="on"' : ''}>All</a> · <a href="/drops?store=us"${code === 'us' ? ' class="on"' : ''}>US</a> · <a href="/drops?store=uk"${code === 'uk' ? ' class="on"' : ''}>UK</a></p>
<div class="table-wrap"><table class="table" role="table"><thead><tr><th>Dropped</th><th>Guitar</th><th>Store</th><th>Launch price</th><th>Status</th></tr></thead><tbody>
${rows.map(x => x.kind === 'tracked' ? `
  <tr><td>${new Date(x.p.first_seen_at).toISOString().slice(0, 10)}</td>
  <td><a href="${href(maps.get(`${x.p.store}|${x.p.id}`), x.p.store, x.p.id)}">${esc(x.p.title)}</a></td>
  <td>${storeBadge(x.p.store)}</td><td>${money(x.p.launch_price, x.p.currency)}</td>
  <td>${x.p.delisted_at ? 'delisted' : x.p.sold_out_at ? 'sold out' : x.p.current_available ? 'live' : 'unavailable'}</td></tr>` : `
  <tr class="archived"><td>${new Date(x.r.first_snapshot_at).toISOString().slice(0, 10)}</td>
  <td>${x.r.model_slug ? `<a href="/models/${esc(x.r.model_slug)}">${esc(x.r.title)}</a>` : esc(x.r.title)} <span class="badge">archived</span></td>
  <td>${storeBadge(x.r.store)}</td><td>${money(x.r.price, x.r.currency)}</td>
  <td><a href="${esc(x.r.snapshot_url)}" rel="noopener">snapshot</a></td></tr>`).join('')}
</tbody></table></div>`;
    res.send(layout({ title: 'Drop history', desc: 'Every Firefly guitar drop we have tracked or reconstructed from archives.', path: '/drops', body }));
  });
};
