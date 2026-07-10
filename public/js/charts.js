(() => {
  'use strict';
  const W = 640, H = 160, PAD = 4;
  const fmtDate = ts => new Date(ts).toISOString().slice(0, 10);

  const scaler = (points, key) => {
    const xs = points.map(p => p[0]), ys = points.map(p => p[key]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMin = Math.min(...ys), yMax = Math.max(...ys);
    const x = ts => xMax > xMin ? PAD + ((ts - xMin) / (xMax - xMin)) * (W - PAD * 2) : W / 2;
    const y = v => yMax > yMin ? H - PAD - ((v - yMin) / (yMax - yMin)) * (H - PAD * 2) : H / 2;
    return { x, y, xMin, xMax, yMin, yMax };
  };

  const stepPath = (rows, s) => {
    let d = `M${s.x(rows[0][0])},${s.y(rows[0][1])}`;
    for (let i = 1; i < rows.length; i++) {
      const prevY = s.y(rows[i - 1][1]);
      d += ` L${s.x(rows[i][0])},${prevY} L${s.x(rows[i][0])},${s.y(rows[i][1])}`;
    }
    return d;
  };

  const renderSeries = series => {
    const wrap = document.createElement('div');
    wrap.className = 'chart-series';
    if (series.title) {
      const h = document.createElement('h3');
      h.textContent = series.title;
      wrap.appendChild(h);
    }
    const price = (series.price || []).map(([ts, v]) => [ts, v]).filter(r => r[1] != null);
    const stock = (series.stock || []).map(([ts, q]) => [ts, q]).filter(r => r[1] != null);
    if (price.length < 2 && stock.length < 2) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'no data yet';
      wrap.appendChild(p);
      return wrap;
    }
    const all = price.concat(stock);
    const allX = { xMin: Math.min(...all.map(r => r[0])), xMax: Math.max(...all.map(r => r[0])) };
    const xFor = ts => allX.xMax > allX.xMin ? PAD + ((ts - allX.xMin) / (allX.xMax - allX.xMin)) * (W - PAD * 2) : W / 2;

    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="price and stock history">`;
    if (price.length >= 2) {
      const s = scaler(price, 1);
      s.x = xFor;
      const pts = price.map(([ts, v]) => `${s.x(ts)},${s.y(v)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>`;
      svg += `<text x="${PAD}" y="12" fill="var(--muted)" font-size="11">${series.currency || ''} ${s.yMax}</text>`;
      svg += `<text x="${PAD}" y="${H - 6}" fill="var(--muted)" font-size="11">${series.currency || ''} ${s.yMin}</text>`;
    }
    if (stock.length >= 2) {
      const s = scaler(stock, 1);
      s.x = xFor;
      svg += `<path d="${stepPath(stock, s)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 2"/>`;
      svg += `<text x="${W - 60}" y="12" fill="var(--muted)" font-size="11">${s.yMax} qty</text>`;
      svg += `<text x="${W - 60}" y="${H - 6}" fill="var(--muted)" font-size="11">${s.yMin} qty</text>`;
    }
    svg += `<text x="${PAD}" y="${H + 14}" fill="var(--muted)" font-size="11">${fmtDate(allX.xMin)}</text>`;
    svg += `<text x="${W - 80}" y="${H + 14}" fill="var(--muted)" font-size="11">${fmtDate(allX.xMax)}</text>`;
    svg += `</svg>`;
    wrap.insertAdjacentHTML('beforeend', svg);
    return wrap;
  };

  const mount = async el => {
    let url;
    if (el.dataset.slug) url = `/api/site/model/${encodeURIComponent(el.dataset.slug)}/history.json`;
    else if (el.dataset.listing) url = `/api/site/history/${el.dataset.listing}.json`;
    else return;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('bad response');
      const data = await r.json();
      const series = Array.isArray(data.series) ? data.series : [data];
      el.textContent = '';
      if (!series.length) { el.textContent = 'no data yet'; return; }
      series.forEach(s => el.appendChild(renderSeries(s)));
    } catch (e) {
      el.textContent = 'chart unavailable';
    }
  };

  document.querySelectorAll('.chart[data-slug], .chart[data-listing]').forEach(mount);
})();
