// ============================================================
// compute.js — filtering + aggregation. One filtered pass per render;
// every chart/KPI derives from the same filtered row set.
// ============================================================
import { CONFIG } from "./config.js";
const I = CONFIG.IDX;

/** Return the array of rows passing the current filters + date ranges. */
export function filterRows(data, state) {
  const rows = data.rows;
  const f = state.filters;
  // Pre-pull the active (non-empty) filter sets to avoid per-row lookups.
  const active = [];
  for (const dim of CONFIG.FILTER_DIMS) {
    const set = f[dim.key];
    if (set && set.size) active.push([I[dim.key], set]);
  }
  const { orderRange, shipRange } = state;
  const oOn = orderRange.from || orderRange.to;
  const sOn = shipRange.from || shipRange.to;
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let ok = true;
    for (let a = 0; a < active.length; a++) {
      if (!active[a][1].has(r[active[a][0]])) { ok = false; break; }
    }
    if (!ok) continue;
    if (oOn) {
      const d = r[I.oDate];
      if (!d) continue;
      if (orderRange.from && d < orderRange.from) continue;
      if (orderRange.to && d > orderRange.to) continue;
    }
    if (sOn) {
      const d = r[I.sDate];
      if (!d) continue;
      if (shipRange.from && d < shipRange.from) continue;
      if (shipRange.to && d > shipRange.to) continue;
    }
    out.push(r);
  }
  return out;
}

const val = (r, metric) => (metric === "qty" ? r[CONFIG.IDX.qty] : r[CONFIG.IDX.amt]);

/** KPI roll-up over filtered rows. */
export function kpis(rows) {
  let amt = 0, qty = 0;
  for (const r of rows) { amt += r[I.amt]; qty += r[I.qty]; }
  return { amt, qty, lines: rows.length, aov: qty ? amt / qty : 0 };
}

/** Sum a metric by a dimension -> sorted desc [{label,value}]. */
export function breakdownBy(data, rows, dimKey, metric, topN = 14) {
  const idx = I[dimKey];
  const labels = data.dims[dimKey];
  const acc = new Float64Array(labels.length);
  for (const r of rows) acc[r[idx]] += val(r, metric);
  let arr = [];
  for (let k = 0; k < labels.length; k++)
    if (acc[k]) arr.push({ label: labels[k] || "(blank)", value: acc[k], idx: k });
  arr.sort((a, b) => b.value - a.value);
  if (arr.length > topN) {
    const head = arr.slice(0, topN - 1);
    const rest = arr.slice(topN - 1).reduce((s, x) => s + x.value, 0);
    head.push({ label: `Other (${arr.length - topN + 1})`, value: rest, idx: -1 });
    arr = head;
  }
  return arr;
}

/**
 * Week-of-year matrix by year, using the chosen date basis.
 * returns { years:[...], byYear:{year:[54 floats]} }  (index 1..53 used)
 */
export function weekOfYear(rows, metric, basis) {
  const yIdx = basis === "ship" ? I.sYear : I.oYear;
  const wIdx = basis === "ship" ? I.sWeek : I.oWeek;
  const byYear = {};
  for (const r of rows) {
    const y = r[yIdx], w = r[wIdx];
    if (!y || !w) continue;
    (byYear[y] || (byYear[y] = new Float64Array(54)))[w] += val(r, metric);
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  return { years, byYear };
}

/**
 * Continuous week timeline for the linear view. Optional yearsFilter (Set) to
 * window the range so 2023->future doesn't become an unreadable line.
 * returns [{ key:"2025-W07", year, week, value }]
 */
export function linearWeeks(rows, metric, basis, yearsFilter = null) {
  const yIdx = basis === "ship" ? I.sYear : I.oYear;
  const wIdx = basis === "ship" ? I.sWeek : I.oWeek;
  const map = new Map();
  for (const r of rows) {
    const y = r[yIdx], w = r[wIdx];
    if (!y || !w) continue;
    if (yearsFilter && !yearsFilter.has(y)) continue;
    const key = y * 100 + w;
    map.set(key, (map.get(key) || 0) + val(r, metric));
  }
  return [...map.keys()].sort((a, b) => a - b).map((k) => {
    const year = Math.floor(k / 100), week = k % 100;
    return { key: `${year}-W${String(week).padStart(2, "0")}`, year, week, value: map.get(k) };
  });
}

/**
 * Rank the filtered rows into product STYLES (grouped by style name / Description).
 * Each style row carries summed units/dollars, distinct color & sku counts, the
 * dominant value of each attribute (for display + color-coding), and the full set
 * of attribute indices present (for the "filter dashboard to this style" pivot).
 */
const RANK_DIMS = ["collection", "category", "division", "subcategory"];
export function rankStyles(data, rows) {
  const map = new Map();                       // nameIdx -> aggregate
  for (const r of rows) {
    const nk = r[I.name];
    let a = map.get(nk);
    if (!a) {
      a = { nameIdx: nk, qty: 0, amt: 0, colors: new Set(), skus: new Set(), dim: {} };
      for (const dk of RANK_DIMS) a.dim[dk] = new Map();   // valueIdx -> amt weight
      map.set(nk, a);
    }
    a.qty += r[I.qty]; a.amt += r[I.amt];
    a.colors.add(r[I.color]); a.skus.add(r[I.style]);
    for (const dk of RANK_DIMS) {
      const v = r[I[dk]], m = a.dim[dk];
      m.set(v, (m.get(v) || 0) + r[I.amt]);
    }
  }
  const dominant = (m) => { let bk = -1, bv = -Infinity; for (const [k, v] of m) if (v > bv) { bv = v; bk = k; } return bk; };
  const out = [];
  for (const a of map.values()) {
    const dom = {}, present = {};
    for (const dk of RANK_DIMS) {
      dom[dk] = dominant(a.dim[dk]);
      present[dk] = [...a.dim[dk].keys()];
    }
    out.push({
      name: data.dims.name[a.nameIdx] || "(unnamed)",
      nameIdx: a.nameIdx,
      qty: a.qty, amt: a.amt,
      colors: a.colors.size, skus: a.skus.size,
      collection: data.dims.collection[dom.collection] || "",
      category: data.dims.category[dom.category] || "",
      division: data.dims.division[dom.division] || "",
      subcategory: data.dims.subcategory[dom.subcategory] || "",
      dom, present,                        // dom.<dk> = idx (for color key); present for pivot
    });
  }
  return out;
}

/** Group filtered rows by SKU (style code) — the finest level. */
export function rankSkus(data, rows) {
  const map = new Map();
  for (const r of rows) {
    const sk = r[I.style];
    let a = map.get(sk);
    if (!a) {
      a = { styleIdx: sk, nameIdx: r[I.name], colorIdx: r[I.color], seasonIdx: r[I.season],
            catIdx: r[I.category], collIdx: r[I.collection], subIdx: r[I.subcategory],
            divIdx: r[I.division], qty: 0, amt: 0 };
      map.set(sk, a);
    }
    a.qty += r[I.qty]; a.amt += r[I.amt];
  }
  const out = [];
  for (const a of map.values()) out.push({
    sku: data.dims.style[a.styleIdx] || "",
    name: data.dims.name[a.nameIdx] || "",
    color: data.dims.color[a.colorIdx] || "(none)",
    season: data.dims.season[a.seasonIdx] || "",
    category: data.dims.category[a.catIdx] || "",
    collection: data.dims.collection[a.collIdx] || "",
    subcategory: data.dims.subcategory[a.subIdx] || "",
    division: data.dims.division[a.divIdx] || "",
    qty: a.qty, amt: a.amt,
    nameIdx: a.nameIdx,
    dom: { collection: a.collIdx, category: a.catIdx, division: a.divIdx, subcategory: a.subIdx, name: a.nameIdx },
    present: { collection: [a.collIdx], category: [a.catIdx], subcategory: [a.subIdx], division: [a.divIdx] },
  });
  return out;
}

/** Colors within one style (for the expandable drill-down), from filtered rows. */
export function styleColors(data, rows, nameIdx) {
  const map = new Map();
  for (const r of rows) {
    if (r[I.name] !== nameIdx) continue;
    const ck = r[I.color];
    let a = map.get(ck);
    if (!a) { a = { colorIdx: ck, qty: 0, amt: 0, skus: new Set(), seasons: new Set() }; map.set(ck, a); }
    a.qty += r[I.qty]; a.amt += r[I.amt]; a.skus.add(r[I.style]); a.seasons.add(r[I.season]);
  }
  const out = [];
  for (const a of map.values())
    out.push({ color: data.dims.color[a.colorIdx] || "(none)", qty: a.qty, amt: a.amt,
               skus: a.skus.size, seasons: a.seasons.size });
  return out;
}

/** Season-by-season totals for one style (projection signal), from filtered rows. */
export function styleSeasons(data, rows, nameIdx) {
  const map = new Map();
  for (const r of rows) {
    if (r[I.name] !== nameIdx) continue;
    const sk = r[I.season];
    let a = map.get(sk);
    if (!a) { a = { seasonIdx: sk, qty: 0, amt: 0 }; map.set(sk, a); }
    a.qty += r[I.qty]; a.amt += r[I.amt];
  }
  const out = [];
  for (const a of map.values())
    out.push({ season: data.dims.season[a.seasonIdx] || "", qty: a.qty, amt: a.amt });
  return out;
}

/**
 * Simple YoY seasonal projection for a target year: for each week, take the
 * prior year's same-week value and scale by the blended growth rate observed in
 * weeks that BOTH years already have. Only projects weeks the target year has
 * not booked yet (so completed weeks show actuals, future weeks show forecast).
 * returns { actual:[54], projected:[54], growth, priorYear, targetYear } | null
 */
export function projectYoY(woy, targetYear) {
  const { byYear } = woy;
  const cur = byYear[targetYear], prev = byYear[targetYear - 1];
  if (!cur || !prev) return null;
  let sc = 0, sp = 0;
  for (let w = 1; w <= 53; w++) {
    if (cur[w] && prev[w]) { sc += cur[w]; sp += prev[w]; }
  }
  const growth = sp ? sc / sp : 1;
  const actual = new Array(54).fill(null);
  const projected = new Array(54).fill(null);
  let lastActualWeek = 0;
  for (let w = 1; w <= 53; w++) if (cur[w]) lastActualWeek = w;
  for (let w = 1; w <= 53; w++) {
    if (cur[w]) actual[w] = cur[w];
    else if (w > lastActualWeek && prev[w]) projected[w] = prev[w] * growth;
  }
  // bridge the line: projection starts from the last actual point
  if (lastActualWeek) projected[lastActualWeek] = actual[lastActualWeek];
  const prior = new Array(54).fill(null);
  for (let w = 1; w <= 53; w++) if (prev[w]) prior[w] = prev[w];
  // projected season total = booked actuals + forecast remainder
  let projTotal = 0;
  for (let w = 1; w <= 53; w++) {
    if (actual[w] != null) projTotal += actual[w];
    else if (projected[w] != null && w !== lastActualWeek) projTotal += projected[w];
  }
  return { actual, projected, prior, growth, priorYear: targetYear - 1,
           targetYear, lastActualWeek, projTotal };
}
