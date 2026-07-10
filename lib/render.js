'use strict';
const { marked } = require('marked');
const cfg = require('../config');

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SYM = { USD: '$', GBP: '£' };
const money = (v, currency) => v == null ? '—' : `${SYM[currency] || ''}${Number(v).toFixed(2)}`;
function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const md = src => marked.parse(src, { mangle: false, headerIds: false });

const NAV = [['/live', 'Live'], ['/drops', 'Drops'], ['/models', 'Models'], ['/analytics', 'Analytics'], ['/about', 'About']];

function layout({ title, desc, path, body, jsonld = null, ogImage = null, noindexPage = false }) {
  const canonical = cfg.SITE_URL + path;
  const noindex = noindexPage || cfg.SITE_ENV !== 'production';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · ${esc(cfg.SITE_NAME)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="New drops" href="/feed.xml">
<link rel="stylesheet" href="/site.css">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head>
<body>
<header class="nav">
  <a class="brand" href="/">${esc(cfg.SITE_NAME)}</a>
  <nav>${NAV.map(([href, label]) => `<a href="${href}"${path === href ? ' class="on"' : ''}>${label}</a>`).join('')}</nav>
</header>
<main>${body}</main>
<footer>
  <p>Unofficial fan site — not affiliated with Firefly Guitars or Guitars Garden.</p>
  <p><a href="/privacy">Privacy</a>${cfg.BMAC_URL ? ` · <a href="${esc(cfg.BMAC_URL)}" rel="noopener">Buy me a coffee ☕</a>` : ''} · <a href="/feed.xml">RSS</a></p>
</footer>
</body>
</html>`;
}
module.exports = { esc, money, timeAgo, md, layout };
