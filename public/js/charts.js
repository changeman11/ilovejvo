// Small hand-made SVG charts (no chart library, to keep the site light).
//
// Line chart rules (see the dataviz guide): 2px lines, end dots with a surface-coloured ring,
// hairline gridlines, one y-axis, a legend for 2+ series, text in text colours (never series
// colours), a crosshair + tooltip on hover, and a table view for anyone who can't use the chart.

import { esc } from './ui.js';

// Categorical colours for up to 5 lines, validated on the site's dark card (#111827).
export const SERIES_COLOURS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= v / 4) * pow;
  return Math.ceil(v / step) * step;
}

// series: [{ id, name, values: [number per x] }]   xLabels: ['R1', 'R2', ...]
export function lineChart({ series, xLabels, yLabel, height = 260 }) {
  const W = 640;
  const H = height;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i) => pad.left + (xLabels.length === 1 ? innerW / 2 : (i / (xLabels.length - 1)) * innerW);
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const grid = ticks.map((t) => `
    <line x1="${pad.left}" x2="${W - pad.right}" y1="${y(t)}" y2="${y(t)}" class="chart-grid${t === 0 ? ' base' : ''}"/>
    <text x="${pad.left - 8}" y="${y(t) + 4}" class="chart-tick" text-anchor="end">${t}</text>`).join('');

  // Thin out x labels on narrow charts.
  const every = Math.ceil(xLabels.length / 10);
  const xTicks = xLabels.map((l, i) => (i % every === 0 || i === xLabels.length - 1
    ? `<text x="${x(i)}" y="${H - 8}" class="chart-tick" text-anchor="middle">${esc(l)}</text>` : '')).join('');

  const lines = series.map((s, si) => {
    const colour = SERIES_COLOURS[si % SERIES_COLOURS.length];
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const last = s.values.length - 1;
    return `
      <polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(last)}" cy="${y(s.values[last])}" r="4" fill="${colour}" class="chart-ring"/>`;
  }).join('');

  const legend = series.length > 1
    ? `<ul class="chart-legend">${series.map((s, si) => `<li><i style="background:${SERIES_COLOURS[si % SERIES_COLOURS.length]}"></i>${esc(s.name)}</li>`).join('')}</ul>`
    : '';

  const table = `
    <details class="chart-table">
      <summary>Show as a table</summary>
      <div class="table-wrap"><table class="data">
        <thead><tr><th class="team-col">${esc(yLabel)}</th>${xLabels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr></thead>
        <tbody>${series.map((s) => `<tr><td class="team-col">${esc(s.name)}</td>${s.values.map((v) => `<td class="num">${v}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
    </details>`;

  // Hover data for mountLineChart().
  const data = esc(JSON.stringify({ xLabels, series: series.map((s) => ({ name: s.name, values: s.values })), max, pad, W, H }));

  return `
    <figure class="chart" data-line-chart="${data}">
      ${legend}
      <div class="chart-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)} by round">
          ${grid}${xTicks}
          <line class="chart-cross" y1="${pad.top}" y2="${pad.top + innerH}" x1="0" x2="0" visibility="hidden"/>
          ${lines}
          <rect class="chart-hit" x="${pad.left}" y="${pad.top}" width="${innerW}" height="${innerH}" fill="transparent"/>
        </svg>
        <div class="chart-tip" hidden></div>
      </div>
      ${table}
    </figure>`;
}

// Crosshair + tooltip: nearest round to the pointer, values listed highest first.
export function mountLineChart(root) {
  root.querySelectorAll('[data-line-chart]').forEach((fig) => {
    const d = JSON.parse(fig.dataset.lineChart);
    const svg = fig.querySelector('svg');
    const cross = fig.querySelector('.chart-cross');
    const tip = fig.querySelector('.chart-tip');
    const innerW = d.W - d.pad.left - d.pad.right;
    const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };

    svg.addEventListener('pointermove', (e) => {
      const box = svg.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * d.W;
      const n = d.xLabels.length;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - d.pad.left) / innerW) * (n - 1))));
      const cx = d.pad.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.setAttribute('visibility', 'visible');
      const rows = d.series
        .map((s, si) => ({ name: s.name, v: s.values[i], c: SERIES_COLOURS[si % SERIES_COLOURS.length] }))
        .sort((a, b) => b.v - a.v)
        .map((r) => `<li><i style="background:${r.c}"></i>${esc(r.name)}<b>${r.v}</b></li>`)
        .join('');
      tip.innerHTML = `<strong>${esc(d.xLabels[i])}</strong><ul>${rows}</ul>`;
      tip.hidden = false;
      const left = (cx / d.W) * box.width;
      tip.style.left = `${Math.min(Math.max(left, 70), box.width - 70)}px`;
    });
    svg.addEventListener('pointerleave', hide);
  });
}
