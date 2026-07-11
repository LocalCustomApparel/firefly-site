'use strict';
const cfg = require('../config');
const { esc, money, timeAgo, md, layout } = require('../lib/render');

module.exports = (app, { gdb, wdb }) => {
  const codeOf = store => (cfg.byStore[store] || {}).code || 'us';
  const href = (mapping, store, id) => mapping ? `/models/${esc(mapping.model_slug)}` : `/listing/${esc(codeOf(store))}/${esc(id)}`;
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

  const fs = require('fs');
  const path = require('path');
  const proseFor = slug => {
    const f = path.join(__dirname, '..', 'content', 'models', `${slug}.md`);
    return fs.existsSync(f) ? md(fs.readFileSync(f, 'utf8')) : null;
  };
  const productsOf = slug => wdb.mappingsForModel(slug)
    .map(m => ({ m, p: gdb.getProduct(m.store, m.product_id) })).filter(x => x.p);

  app.get('/models', (req, res) => {
    const models = wdb.allModels();
    const byFamily = new Map();
    for (const m of models) {
      const prods = productsOf(m.slug).sort((a, b) => (b.p.first_seen_at || 0) - (a.p.first_seen_at || 0));
      const entry = { ...m, count: prods.length, image: (prods.find(x => x.p.image) || {}).p?.image || null,
        liveCount: prods.filter(x => !x.p.delisted_at && (x.p.current_qty > 0 || (x.p.current_available && x.p.current_qty == null))).length };
      if (!byFamily.has(m.family)) byFamily.set(m.family, []);
      byFamily.get(m.family).push(entry);
    }
    const body = `<h1>Models</h1>` + [...byFamily.entries()].map(([fam, list]) => `
<h2>${esc(fam)}</h2>
<div class="grid">${list.map(m => `
  <a class="card" href="/models/${esc(m.slug)}">
    ${m.image ? `<img loading="lazy" src="${esc(m.image)}" alt="">` : ''}
    <h3>${esc(m.name)}</h3>
    <p>${m.count} tracked drops${m.liveCount ? ` · <strong>${m.liveCount} live</strong>` : ''}</p>
  </a>`).join('')}</div>`).join('');
    res.send(layout({ title: 'Firefly guitar models', desc: 'Every Firefly guitar model — specs, drops, prices, history.', path: '/models', body }));
  });

  app.get('/models/:slug', (req, res) => {
    const m = wdb.getModel(req.params.slug);
    if (!m) return notFound(res);
    const prods = productsOf(m.slug).sort((a, b) => (b.p.first_seen_at || 0) - (a.p.first_seen_at || 0));
    const live = prods.filter(x => !x.p.delisted_at && (x.p.current_qty > 0 || (x.p.current_available && x.p.current_qty == null)));
    const wayback = wdb.waybackForModel(m.slug);
    const links = wdb.linksFor(m.slug);
    const prose = proseFor(m.slug);
    const image = (prods.find(x => x.p.image) || {}).p?.image || null;
    const specRows = Object.entries(m.specs);
    const jsonld = {
      '@context': 'https://schema.org', '@type': 'Product', name: `Firefly ${m.name}`,
      ...(image ? { image } : {}), brand: { '@type': 'Brand', name: 'Firefly' },
      offers: live.map(x => ({ '@type': 'Offer', price: x.p.current_price, priceCurrency: x.p.currency,
        availability: 'https://schema.org/InStock', url: `${cfg.SITE_URL}/models/${m.slug}` })),
    };
    const body = `
<h1>Firefly ${esc(m.name)}</h1>
<p class="muted">${esc(m.family || '')}${m.status !== 'current' ? ` · ${esc(m.status)}` : ''}</p>
${prose ? `<section class="prose">${prose}</section>` : ''}
${specRows.length ? `<h2>Specs</h2><div class="table-wrap"><table class="table">${specRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></div>` : ''}
${live.length ? `<h2>Live now</h2><div class="grid">${live.map(x => `
  <span class="card"><h3>${esc(x.p.title)}</h3><p>${money(x.p.current_price, x.p.currency)} ${storeBadge(x.p.store)} · ${x.p.current_qty != null ? `${x.p.current_qty} left` : 'qty unknown'}</p></span>`).join('')}</div>` : ''}
${prods.length || wayback.length ? `<h2>Drop history</h2><div class="table-wrap"><table class="table"><tbody>
${prods.map(x => `<tr><td>${new Date(x.p.first_seen_at).toISOString().slice(0, 10)}</td><td>${esc(x.p.title)}</td><td>${storeBadge(x.p.store)}</td><td>${money(x.p.launch_price, x.p.currency)}</td><td>${x.p.sold_out_at ? 'sold out ' + esc(timeAgo(x.p.sold_out_at)) : x.p.delisted_at ? 'delisted' : 'live'}</td></tr>`).join('')}
${wayback.map(r => `<tr class="archived"><td>${new Date(r.first_snapshot_at).toISOString().slice(0, 10)}</td><td>${esc(r.title)} <span class="badge">archived</span></td><td>${storeBadge(r.store)}</td><td>${money(r.price, r.currency)}</td><td><a href="${esc(r.snapshot_url)}" rel="noopener">snapshot</a></td></tr>`).join('')}
</tbody></table></div>` : ''}
${prods.length ? `<h2>Price & stock</h2><div class="chart" data-slug="${esc(m.slug)}"></div><script src="/js/charts.js" defer></script>` : ''}
${links.length ? `<h2>Around the web</h2><ul>${links.map(l => `<li><a href="${esc(l.url)}" rel="noopener">${esc(l.title || l.url)}</a> <span class="muted">(${esc(l.kind)})</span></li>`).join('')}</ul>` : ''}`;
    res.send(layout({ title: `Firefly ${m.name} — specs, drops & prices`, desc: `Firefly ${m.name}: specs, every tracked drop, launch prices and stock history.`, path: `/models/${m.slug}`, body, jsonld, ogImage: image }));
  });

  app.get('/listing/:code/:id', (req, res) => {
    const sc = cfg.storeByCode(req.params.code);
    if (!sc) return notFound(res);
    const d = gdb.detail(sc.store, req.params.id);
    if (!d) return notFound(res);
    const p = d.product;
    const body = `
<h1>${esc(p.title)}</h1>
<p>${money(p.current_price, p.currency)} ${storeBadge(p.store)} · ${p.delisted_at ? 'delisted' : p.sold_out_at ? 'sold out' : p.current_available ? 'live' : 'unavailable'}</p>
${p.image ? `<img class="hero-img" src="${esc(p.image)}" alt="">` : ''}
<p class="muted">This listing isn't linked to a model page yet.</p>
<div class="chart" data-listing="${esc(req.params.code)}/${esc(p.id)}"></div><script src="/js/charts.js" defer></script>`;
    res.send(layout({ title: p.title, desc: `Tracked Firefly listing: ${p.title}`, path: `/listing/${req.params.code}/${p.id}`, body, noindexPage: true }));
  });

  const historyOf = (store, id) => {
    const d = gdb.detail(store, id);
    if (!d) return null;
    return { title: d.product.title, currency: d.product.currency,
      price: d.price.map(r => [r.ts, r.price]), stock: d.stock.map(r => [r.ts, r.quantity]) };
  };
  app.get('/api/site/history/:code/:id.json', (req, res) => {
    const sc = cfg.storeByCode(req.params.code);
    const h = sc && historyOf(sc.store, req.params.id);
    if (!h) return res.status(404).json({ error: 'not found' });
    res.json(h);
  });
  app.get('/api/site/model/:slug/history.json', (req, res) => {
    if (!wdb.getModel(req.params.slug)) return res.status(404).json({ error: 'not found' });
    const series = wdb.mappingsForModel(req.params.slug)
      .map(m => historyOf(m.store, m.product_id)).filter(Boolean);
    res.json({ series });
  });
  app.get('/analytics', (req, res) => {
    const fmtH = ms => ms ? `${(ms / 3600000).toFixed(1)} h` : '—';
    const block = (label, s) => `
<section class="card"><h2>${label}</h2>
<p>${s.total_drops} drops tracked · ${s.drops_last_30d} in the last 30 days</p>
<p>Avg time to sell out: ${fmtH(s.avg_time_to_sellout_ms)} · Avg sell-through: ${(s.sell_through_avg * 100).toFixed(0)}%</p></section>`;
    const body = `<h1>Analytics</h1>
${block('US store', gdb.stats({ store: cfg.STORES.us.store }))}
${block('UK store', gdb.stats({ store: cfg.STORES.uk.store }))}`;
    res.send(layout({ title: 'Drop analytics', desc: 'How fast Firefly drops sell out, drop cadence and pricing trends.', path: '/analytics', body }));
  });

  function notFound(res) {
    res.status(404).send(layout({ title: 'Not found', desc: '', path: '/404', body: '<h1>Not found</h1><p>Try the <a href="/models">model index</a> or <a href="/drops">drop history</a>.</p>', noindexPage: true }));
  }

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(cfg.SITE_ENV === 'production'
      ? `User-agent: *\nAllow: /\nDisallow: /listing/\nSitemap: ${cfg.SITE_URL}/sitemap.xml\n`
      : 'User-agent: *\nDisallow: /\n');
  });

  app.get('/sitemap.xml', (req, res) => {
    const statics = ['/', '/live', '/drops', '/models', '/analytics', '/about', '/privacy'];
    const lastEvent = gdb.db.prepare('SELECT MAX(ts) t FROM events').get().t || Date.now();
    const lastmod = new Date(lastEvent).toISOString().slice(0, 10);
    const urls = statics.concat(wdb.allModels().map(m => `/models/${m.slug}`))
      .map(u => `<url><loc>${cfg.SITE_URL}${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  app.get('/feed.xml', (req, res) => {
    const evs = gdb.db.prepare("SELECT * FROM events WHERE type='drop' ORDER BY ts DESC LIMIT 50").all();
    const items = evs.map(e => {
      const p = gdb.getProduct(e.store, e.product_id);
      if (!p) return '';
      const mapping = wdb.mappingFor(e.store, e.product_id);
      const link = cfg.SITE_URL + href(mapping, e.store, e.product_id);
      const label = (cfg.byStore[e.store] || {}).label || e.store;
      return `<item><title>${esc(`[${label}] ${p.title} — ${money(p.launch_price, p.currency)}`)}</title><link>${esc(link)}</link><guid isPermaLink="false">${esc(`${e.store}:${e.product_id}:${e.ts}`)}</guid><pubDate>${new Date(e.ts).toUTCString()}</pubDate></item>`;
    }).join('');
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(cfg.SITE_NAME)} — new Firefly drops</title><link>${cfg.SITE_URL}</link><description>New Firefly guitar drops as we detect them.</description>${items}</channel></rss>`);
  });

  app.get('/about', (req, res) => {
    const body = `<h1>About</h1>
<p>${esc(cfg.SITE_NAME)} tracks every Firefly guitar drop across the US and UK Guitars Garden stores — live stock, launch prices, sell-out times — and collects what the community knows about each model.</p>
<p>Data updates every few minutes; history before mid-2026 is reconstructed from the Internet Archive and labelled <span class="badge">archived</span>.</p>
<p>Unofficial fan site — not affiliated with Firefly Guitars or Guitars Garden.</p>
${cfg.CONTACT_EMAIL ? `<p>Contact: <a href="mailto:${esc(cfg.CONTACT_EMAIL)}">${esc(cfg.CONTACT_EMAIL)}</a></p>` : ''}
${cfg.BMAC_URL ? `<p>If this site saved you from missing a drop: <a href="${esc(cfg.BMAC_URL)}" rel="noopener">buy me a coffee ☕</a></p>` : ''}`;
    res.send(layout({ title: 'About', desc: 'What this site is and where the data comes from.', path: '/about', body }));
  });

  app.get('/privacy', (req, res) => {
    const body = `<h1>Privacy</h1>
<p>This site sets no cookies and runs no trackers. Aggregate, cookieless traffic analytics are provided by Cloudflare. Product images are served from the stores' own CDNs. If ads are introduced in future, this policy will be updated first.</p>`;
    res.send(layout({ title: 'Privacy', desc: 'No cookies, no trackers.', path: '/privacy', body }));
  });

  app.use((req, res) => notFound(res));
};
