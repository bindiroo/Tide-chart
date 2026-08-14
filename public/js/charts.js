// ============================================================
// charts.js — thin Chart.js wrappers. Chart is loaded globally via CDN.
// ============================================================
import { CONFIG } from "./config.js";
import { fmtMoney, fmtNum, fmtMoneyShort, fmtNumShort } from "./format.js";

const registry = {};                       // canvasId -> Chart instance
const axisFmt = (m) => (m === "qty" ? fmtNumShort : fmtMoneyShort);
const fullFmt = (m) => (m === "qty" ? fmtNum : fmtMoney);
const metricLabel = (m) => (m === "qty" ? "Units" : "Dollars");

function mount(id, cfg) {
  if (registry[id]) registry[id].destroy();
  const el = document.getElementById(id);
  registry[id] = new window.Chart(el.getContext("2d"), cfg);
  return registry[id];
}
Chart_defaults();
function Chart_defaults() {
  if (!window.Chart) return;
  window.Chart.defaults.font.family =
    "Inter, system-ui, -apple-system, Helvetica, Arial, sans-serif";
  window.Chart.defaults.color = "#586D72";
  window.Chart.defaults.plugins.legend.labels.boxWidth = 12;
  window.Chart.defaults.plugins.legend.labels.usePointStyle = true;
}

/** Horizontal bar: single-dimension breakdown. */
export function renderBreakdown(id, items, metric) {
  const ff = fullFmt(metric);
  mount(id, {
    type: "bar",
    data: {
      labels: items.map((x) => x.label),
      datasets: [{
        data: items.map((x) => x.value),
        backgroundColor: items.map((_, i) => CONFIG.SERIES[i % CONFIG.SERIES.length]),
        borderRadius: 4, barThickness: "flex", maxBarThickness: 26,
      }],
    },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${metricLabel(metric)}: ${ff(c.parsed.x)}` } },
      },
      scales: {
        x: { ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" } },
        y: { grid: { display: false } },
      },
    },
  });
}

/** Multi-line: week-of-year 1..53, one line per year. */
export function renderWeekOfYear(id, woy, metric) {
  const ff = fullFmt(metric);
  const labels = Array.from({ length: 53 }, (_, i) => "W" + (i + 1));
  const datasets = woy.years.map((y, i) => ({
    label: String(y),
    data: Array.from({ length: 53 }, (_, k) => woy.byYear[y][k + 1] || 0),
    borderColor: CONFIG.LINE_SERIES[i % CONFIG.LINE_SERIES.length],
    backgroundColor: CONFIG.LINE_SERIES[i % CONFIG.LINE_SERIES.length],
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.3,
  }));
  mount(id, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${ff(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 27, autoSkip: true } },
        y: { ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" }, beginAtZero: true },
      },
    },
  });
}

/** Line: continuous week timeline (windowed). */
export function renderLinear(id, points, metric) {
  const ff = fullFmt(metric);
  mount(id, {
    type: "line",
    data: {
      labels: points.map((p) => p.key),
      datasets: [{
        label: metricLabel(metric),
        data: points.map((p) => p.value),
        borderColor: CONFIG.COLORS.deepSea, backgroundColor: "rgba(67,87,94,.12)",
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.25,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${metricLabel(metric)}: ${ff(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 16, autoSkip: true } },
        y: { ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" }, beginAtZero: true },
      },
    },
  });
}

/** Stacked bar: source composition per season. */
export function renderStackedBar(id, labels, datasets, metric) {
  const ff = fullFmt(metric);
  mount(id, {
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label, data: d.data,
        backgroundColor: CONFIG.SOURCE_COLORS[d.label] || CONFIG.COLORS.midTone,
        borderRadius: 3, maxBarThickness: 48,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${ff(c.parsed.y)}` } },
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" }, beginAtZero: true },
      },
    },
  });
}

/** Cumulative pace lines, one per season, x = weeks since first order. */
export function renderPace(id, pace, metric) {
  const ff = fullFmt(metric);
  const labels = Array.from({ length: pace.maxWeek + 1 }, (_, i) => "wk " + i);
  const datasets = pace.seasons.map((s, i) => ({
    label: s,
    data: Array.from({ length: pace.maxWeek + 1 }, (_, w) =>
      pace.series[s][w] != null ? pace.series[s][w] : (w < pace.series[s].length ? 0 : null)),
    borderColor: CONFIG.LINE_SERIES[i % CONFIG.LINE_SERIES.length],
    backgroundColor: CONFIG.LINE_SERIES[i % CONFIG.LINE_SERIES.length],
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, spanGaps: false,
  }));
  mount(id, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { title: (items) => "Booking week " + items[0].dataIndex,
          label: (c) => c.parsed.y == null ? null : `${c.dataset.label}: ${ff(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, title: { display: true, text: "weeks since the season's first order", color: "#8FA8AE", font: { size: 10 } } },
        y: { ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" }, beginAtZero: true },
      },
    },
  });
}

/** Week-of-year for two years + projection overlay. */
export function renderProjection(id, proj, metric) {
  const ff = fullFmt(metric);
  const labels = Array.from({ length: 53 }, (_, i) => "W" + (i + 1));
  const slice = (a) => a.slice(1, 54).map((v) => (v == null ? null : v));
  mount(id, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: `${proj.targetYear} actual`, data: slice(proj.actual),
          borderColor: CONFIG.COLORS.deepSea, backgroundColor: CONFIG.COLORS.deepSea,
          borderWidth: 2.5, pointRadius: 0, tension: 0.3, spanGaps: false },
        { label: `${proj.targetYear} projected`, data: slice(proj.projected),
          borderColor: CONFIG.COLORS.sand, backgroundColor: CONFIG.COLORS.sand,
          borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0.3, spanGaps: false },
        { label: `${proj.priorYear} actual`, data: slice(proj.prior),
          borderColor: CONFIG.COLORS.midTone, backgroundColor: CONFIG.COLORS.midTone,
          borderWidth: 1.5, pointRadius: 0, tension: 0.3, spanGaps: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { position: "top" },
        tooltip: { callbacks: { label: (c) => c.parsed.y == null ? null : `${c.dataset.label}: ${ff(c.parsed.y)}` } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 27, autoSkip: true } },
        y: { ticks: { callback: axisFmt(metric) }, grid: { color: "#EDECED" }, beginAtZero: true },
      },
    },
  });
}
