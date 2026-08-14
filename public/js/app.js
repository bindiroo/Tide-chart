// ============================================================
// app.js — wire the UI: filters, toggles, date ranges, render loop.
// ============================================================
import { CONFIG } from "./config.js";
import { loadData } from "./data.js";
import { fmtMoney, fmtNum, fmtMoneyShort, ymdToInput, inputToYmd, ymdToDisplay } from "./format.js";
import { filterRows, kpis, breakdownBy, weekOfYear, linearWeeks, projectYoY,
         rankStyles, rankSkus, styleColors, styleSeasons } from "./compute.js";
import { renderBreakdown, renderWeekOfYear, renderLinear, renderProjection } from "./charts.js";

// palette for the ranking color-code (brand tones + high-contrast, ~20 distinct)
const RANK_PALETTE = CONFIG.SERIES.concat(CONFIG.LINE_SERIES);

let DATA = null;
const state = {
  metric: "amt",
  dateBasis: "order",           // order | ship
  breakdownDim: "collection",
  filters: {},                  // key -> Set(idx)
  orderRange: { from: 0, to: 0 },
  shipRange: { from: 0, to: 0 },
  linearYears: null,            // Set(year) or null = all
  projYear: null,               // target year for projection
  rank: { level: "style", sortKey: "amt", dir: -1, colorDim: "collection",
          search: "", expanded: new Set() },
};
let curRows = [];   // last filtered row set (for drill-down expansion)
CONFIG.FILTER_DIMS.forEach((d) => (state.filters[d.key] = new Set()));

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// ---------- boot ----------
init();
async function init() {
  try {
    DATA = await loadData();
  } catch (err) {
    $("#status").textContent = "Could not load data: " + err.message;
    return;
  }
  buildMeta();
  buildFilters();
  buildControls();
  buildDateRanges();
  buildProjectionYears();
  buildRankControls();
  render();
}

function buildMeta() {
  const m = DATA.meta;
  $("#updated").textContent =
    `${m.rowsKept.toLocaleString()} lines · updated ${m.generatedAt.replace("T", " ")}`;
}

// ---------- filter groups ----------
function buildFilters() {
  const wrap = $("#filters");
  wrap.innerHTML = "";
  for (const dim of CONFIG.FILTER_DIMS) {
    const labels = DATA.dims[dim.key];
    const det = el("details", "fgroup");
    det.dataset.key = dim.key;
    if (dim.key === "collection" || dim.key === "division") det.open = true;
    const sum = el("summary");
    sum.append(el("span", "fgroup__name", dim.label));
    const badge = el("span", "fgroup__count", "All");
    sum.append(badge);
    det.append(sum);

    const body = el("div", "fgroup__body");
    // controls row (all / none / optional search)
    const ctrls = el("div", "fgroup__ctrls");
    const allBtn = el("button", "linkbtn", "All");
    const noneBtn = el("button", "linkbtn", "None");
    ctrls.append(allBtn, noneBtn);
    let search = null;
    if (labels.length > 12) {
      search = el("input", "fgroup__search");
      search.type = "search"; search.placeholder = "filter…";
      ctrls.append(search);
    }
    body.append(ctrls);

    const list = el("div", "fgroup__list");
    // sort labels alphabetically but keep index mapping
    const order = labels.map((lab, i) => ({ lab: lab || "(blank)", i }))
      .sort((a, b) => a.lab.localeCompare(b.lab));
    for (const { lab, i } of order) {
      const row = el("label", "chk");
      const cb = el("input"); cb.type = "checkbox"; cb.value = i;
      cb.addEventListener("change", () => {
        const set = state.filters[dim.key];
        if (cb.checked) set.add(i); else set.delete(i);
        updateBadge(dim.key, badge, labels.length);
        render();
      });
      row.append(cb, el("span", null, lab));
      row.dataset.lab = lab.toLowerCase();
      list.append(row);
    }
    body.append(list);
    det.append(body);
    wrap.append(det);

    allBtn.addEventListener("click", (e) => { e.preventDefault(); setGroup(dim.key, list, true); updateBadge(dim.key, badge, labels.length); render(); });
    noneBtn.addEventListener("click", (e) => { e.preventDefault(); setGroup(dim.key, list, false); updateBadge(dim.key, badge, labels.length); render(); });
    if (search) search.addEventListener("input", () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll(".chk").forEach((r) => { r.style.display = r.dataset.lab.includes(q) ? "" : "none"; });
    });
  }
}
function setGroup(key, list, on) {
  const set = state.filters[key];
  list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
    cb.checked = on; if (on) set.add(+cb.value); else set.delete(+cb.value);
  });
}
function updateBadge(key, badge, total) {
  const n = state.filters[key].size;
  badge.textContent = n === 0 ? "All" : `${n}/${total}`;
  badge.classList.toggle("fgroup__count--on", n > 0);
}

// ---------- top controls (metric, basis, breakdown, linear years) ----------
function buildControls() {
  bindToggle("#metricToggle", "metric", () => {
    // keep the ranking sorted by whichever metric is active (unless sorted by a label)
    if (state.rank.sortKey === "amt" || state.rank.sortKey === "qty")
      state.rank.sortKey = state.metric === "qty" ? "qty" : "amt";
    render();
  });
  bindToggle("#basisToggle", "dateBasis", () => { buildProjectionYears(); render(); });

  const sel = $("#breakdownDim");
  CONFIG.FILTER_DIMS.filter((d) => d.key !== "color")
    .forEach((d) => sel.append(new Option(d.label, d.key)));
  sel.value = state.breakdownDim;
  sel.addEventListener("change", () => { state.breakdownDim = sel.value; render(); });

  $("#resetBtn").addEventListener("click", resetAll);
}
function bindToggle(sel, key, after) {
  const grp = $(sel);
  grp.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    grp.querySelectorAll("button").forEach((x) => x.classList.remove("seg__btn--on"));
    b.classList.add("seg__btn--on");
    state[key] = b.dataset.val;
    after();
  }));
}

// ---------- date ranges ----------
function buildDateRanges() {
  const m = DATA.meta;
  wire("#oFrom", "#oTo", "orderRange", m.orderDateMin, m.orderDateMax);
  wire("#sFrom", "#sTo", "shipRange", m.shipDateMin, m.shipDateMax);
  $("#oHint").textContent = `data: ${ymdToDisplay(m.orderDateMin)} – ${ymdToDisplay(m.orderDateMax)}`;
  $("#sHint").textContent = `data: ${ymdToDisplay(m.shipDateMin)} – ${ymdToDisplay(m.shipDateMax)}`;
  function wire(fromSel, toSel, key, min, max) {
    const from = $(fromSel), to = $(toSel);
    from.min = to.min = ymdToInput(min); from.max = to.max = ymdToInput(max);
    const upd = () => { state[key] = { from: inputToYmd(from.value), to: inputToYmd(to.value) }; render(); };
    from.addEventListener("change", upd); to.addEventListener("change", upd);
  }
}

// ---------- projection target-year selector ----------
function buildProjectionYears() {
  const woy = weekOfYear(DATA.rows, state.metric, state.dateBasis);
  const candidates = woy.years.filter((y) => woy.byYear[y - 1]); // needs a prior year
  const sel = $("#projYear");
  sel.innerHTML = "";
  candidates.forEach((y) => sel.append(new Option(String(y), y)));
  if (!candidates.length) { state.projYear = null; return; }
  // default: latest year that still has a prior year to compare against
  state.projYear = candidates[candidates.length - 1];
  sel.value = state.projYear;
  sel.onchange = () => { state.projYear = +sel.value; render(); };
}

// ---------- style ranking table ----------
// Column schemas per grouping level. sort:<key> makes the header clickable.
const RANK_COLS = {
  style: [
    { key: "#", label: "#", cls: "rank__num" },
    { key: "name", label: "Style", sort: "name", cls: "rank__l", alpha: true, main: true },
    { key: "collection", label: "Collection", sort: "collection", cls: "rank__l", alpha: true },
    { key: "category", label: "Category", sort: "category", cls: "rank__l", alpha: true },
    { key: "subcategory", label: "Subcat", sort: "subcategory", cls: "rank__l", alpha: true },
    { key: "colors", label: "Colors", sort: "colors" },
    { key: "qty", label: "Units", sort: "qty" },
    { key: "amt", label: "Dollars", sort: "amt" },
    { key: "act", label: "", cls: "rank__act" },
  ],
  sku: [
    { key: "#", label: "#", cls: "rank__num" },
    { key: "sku", label: "SKU", sort: "sku", cls: "rank__l", alpha: true, main: true },
    { key: "name", label: "Style", sort: "name", cls: "rank__l", alpha: true },
    { key: "color", label: "Color", sort: "color", cls: "rank__l", alpha: true },
    { key: "season", label: "Season", sort: "season", cls: "rank__l", alpha: true },
    { key: "category", label: "Category", sort: "category", cls: "rank__l", alpha: true },
    { key: "qty", label: "Units", sort: "qty" },
    { key: "amt", label: "Dollars", sort: "amt" },
    { key: "act", label: "", cls: "rank__act" },
  ],
};
const ALPHA_KEYS = new Set(["name", "collection", "category", "subcategory", "sku", "color", "season"]);

function buildRankControls() {
  // Older data feeds (before name/style were added) can't power this table.
  if (!DATA.meta.fields || DATA.meta.fields.indexOf("name") === -1) {
    const card = $("#rankCard"); if (card) card.style.display = "none";
    return;
  }
  const sel = $("#rankColorDim");
  CONFIG.COLORCODE_DIMS.forEach((d) => sel.append(new Option(d.label, d.key)));
  sel.value = state.rank.colorDim;
  sel.addEventListener("change", () => { state.rank.colorDim = sel.value; render(); });

  bindToggle("#rankLevel", "_rankLevel", () => {
    state.rank.level = state["_rankLevel"];
    state.rank.expanded.clear();
    if (!RANK_COLS[state.rank.level].some((c) => c.sort === state.rank.sortKey))
      state.rank.sortKey = "amt";
    buildRankHead();
    render();
  });

  const search = $("#rankSearch");
  let t = null;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.rank.search = search.value.trim().toLowerCase(); render(); }, 120);
  });

  buildRankHead();
}

/** (Re)build the table header for the current grouping level + wire sort clicks. */
function buildRankHead() {
  const head = $("#rankHead");
  head.innerHTML = "";
  RANK_COLS[state.rank.level].forEach((c) => {
    const th = document.createElement("th");
    th.className = c.cls || "";
    th.innerHTML = esc(c.label) + (c.sort ? '<span class="arrow"></span>' : "");
    if (c.sort) {
      th.dataset.sort = c.sort;
      th.addEventListener("click", () => {
        const r = state.rank;
        if (r.sortKey === c.sort) r.dir = -r.dir;
        else { r.sortKey = c.sort; r.dir = ALPHA_KEYS.has(c.sort) ? 1 : -1; }
        render();
      });
    }
    head.append(th);
  });
}

function renderTable(rows) {
  if (DATA.meta.fields.indexOf("name") === -1) return;   // table hidden on old feeds
  const r = state.rank;
  const bySku = r.level === "sku";
  let items = bySku ? rankSkus(DATA, rows) : rankStyles(DATA, rows);

  // search (name / attributes; plus sku + color in SKU mode)
  if (r.search) {
    const q = r.search;
    items = items.filter((x) =>
      (x.name && x.name.toLowerCase().includes(q)) ||
      (x.collection && x.collection.toLowerCase().includes(q)) ||
      (x.category && x.category.toLowerCase().includes(q)) ||
      (x.subcategory && x.subcategory.toLowerCase().includes(q)) ||
      (x.sku && x.sku.toLowerCase().includes(q)) ||
      (x.color && x.color.toLowerCase().includes(q)) ||
      (x.season && x.season.toLowerCase().includes(q)));
  }
  const totalMatches = items.length;

  // sort
  const key = r.sortKey, dir = r.dir;
  const cmp = ALPHA_KEYS.has(key)
    ? (a, b) => String(a[key] || "").localeCompare(String(b[key] || "")) * dir
    : (a, b) => (a[key] - b[key]) * dir;
  items.sort(cmp);

  // header arrows
  document.querySelectorAll("#rankTable thead th[data-sort]").forEach((th) => {
    th.querySelector(".arrow").textContent = th.dataset.sort === key ? (dir < 0 ? "▼" : "▲") : "";
  });

  // color-code: rank distinct values of the chosen dim by total $, map to palette
  const cd = r.colorDim;
  const keyOf = (x) => (cd === "name" ? x.nameIdx : x.dom[cd]);
  const weight = new Map();
  for (const x of items) weight.set(keyOf(x), (weight.get(keyOf(x)) || 0) + x.amt);
  const orderKeys = [...weight.keys()].sort((a, b) => weight.get(b) - weight.get(a));
  const colorPos = new Map(orderKeys.map((k, i) => [k, i]));
  const colorFor = (x) => RANK_PALETTE[colorPos.get(keyOf(x)) % RANK_PALETTE.length];

  // legend
  const legend = $("#rankLegend");
  legend.innerHTML = "";
  if (cd !== "name") {
    orderKeys.slice(0, 16).forEach((k) => {
      const lg = el("span", "lg");
      const sw = el("span", "sw"); sw.style.background = RANK_PALETTE[colorPos.get(k) % RANK_PALETTE.length];
      lg.append(sw, document.createTextNode(DATA.dims[cd][k] || "(blank)"));
      legend.append(lg);
    });
    if (orderKeys.length > 16) legend.append(el("span", "lg", `+${orderKeys.length - 16} more`));
  } else {
    legend.append(el("span", "lg", "each style shown in its own color"));
  }

  // body
  const CAP = 300;
  const shown = items.slice(0, CAP);
  const body = $("#rankBody");
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  const nCols = RANK_COLS[r.level].length;
  shown.forEach((x, i) => {
    const tr = document.createElement("tr");
    if (bySku) {
      tr.innerHTML =
        `<td class="rank__num">${i + 1}</td>` +
        `<td class="rank__l"><div class="rank__name"><span class="sw" style="background:${colorFor(x)}"></span><span title="${esc(x.sku)}">${esc(x.sku)}</span></div></td>` +
        `<td class="rank__l">${esc(x.name)}</td>` +
        `<td class="rank__l">${esc(x.color)}</td>` +
        `<td class="rank__l">${esc(x.season)}</td>` +
        `<td class="rank__l">${esc(x.category)}</td>` +
        `<td class="rank__val">${fmtNum(x.qty)}</td>` +
        `<td class="rank__val">${fmtMoney(x.amt)}</td>` +
        `<td class="rank__act"><button class="rank__pivotbtn" title="Filter the dashboard to this style">→</button></td>`;
      tr.querySelector(".rank__pivotbtn").addEventListener("click", () => pivotToStyle(x));
    } else {
      const open = r.expanded.has(x.nameIdx);
      tr.innerHTML =
        `<td class="rank__num">${i + 1}</td>` +
        `<td class="rank__l"><div class="rank__name"><span class="caret">${open ? "▾" : "▸"}</span><span class="sw" style="background:${colorFor(x)}"></span><span class="rank__lnk" title="Click to see colors of ${esc(x.name)}">${esc(x.name)}</span></div></td>` +
        `<td class="rank__l">${esc(x.collection)}</td>` +
        `<td class="rank__l">${esc(x.category)}</td>` +
        `<td class="rank__l">${esc(x.subcategory)}</td>` +
        `<td class="rank__val">${fmtNum(x.colors)}</td>` +
        `<td class="rank__val">${fmtNum(x.qty)}</td>` +
        `<td class="rank__val">${fmtMoney(x.amt)}</td>` +
        `<td class="rank__act"><button class="rank__pivotbtn" title="Filter the whole dashboard to this style's Collection / Category / Subcategory / Division">→</button></td>`;
      tr.querySelector(".rank__lnk").addEventListener("click", () => toggleExpand(x.nameIdx));
      tr.querySelector(".caret").addEventListener("click", () => toggleExpand(x.nameIdx));
      tr.querySelector(".rank__pivotbtn").addEventListener("click", () => pivotToStyle(x));
      frag.append(tr);
      if (open) frag.append(...expandRows(x, nCols));
      return;
    }
    frag.append(tr);
  });
  body.append(frag);

  const noun = bySku ? "SKUs" : "styles";
  $("#rankFoot").textContent =
    `${fmtNum(totalMatches)} ${noun}${r.search ? ` matching “${r.search}”` : ""}` +
    (totalMatches > CAP ? ` · showing top ${CAP}` : "") +
    ` · sorted by ${sortLabel(key)} ${dir < 0 ? "↓" : "↑"}` +
    (bySku ? "" : " · click a style name to see its colors");
}

/** Build the indented color sub-rows shown when a style is expanded. */
function expandRows(x, nCols) {
  const metricKey = state.metric === "qty" ? "qty" : "amt";
  const colors = styleColors(DATA, curRows, x.nameIdx).sort((a, b) => b[metricKey] - a[metricKey]);
  const total = x[metricKey] || 1;
  return colors.map((c) => {
    const tr = document.createElement("tr");
    tr.className = "rank__sub";
    const share = ((c[metricKey] / total) * 100).toFixed(0);
    tr.innerHTML =
      `<td></td>` +
      `<td class="rank__l" colspan="4"><span class="rank__subname">${esc(c.color)}</span>` +
      `<span class="rank__submeta">${c.skus} SKU${c.skus > 1 ? "s" : ""}${c.seasons > 1 ? ` · ${c.seasons} seasons` : ""}</span></td>` +
      `<td class="rank__val">${share}%</td>` +
      `<td class="rank__val">${fmtNum(c.qty)}</td>` +
      `<td class="rank__val">${fmtMoney(c.amt)}</td>` +
      `<td></td>`;
    return tr;
  });
}

function toggleExpand(nameIdx) {
  const e = state.rank.expanded;
  if (e.has(nameIdx)) e.delete(nameIdx); else e.add(nameIdx);
  render();
}

function sortLabel(k) {
  return { name: "style", collection: "collection", category: "category", subcategory: "subcategory",
    colors: "colors", qty: "units", amt: "dollars", sku: "SKU", color: "color", season: "season" }[k] || k;
}

/** Apply a style's attribute values to the global filters (the "related filters" pivot). */
function pivotToStyle(x) {
  const dk2 = { collection: "collection", category: "category", subcategory: "subcategory", division: "division" };
  for (const dk in dk2) {
    const set = state.filters[dk];
    set.clear();
    x.present[dk].forEach((idx) => set.add(idx));
  }
  // reflect in the filter checkboxes + badges
  syncFilterUI();
  const pv = $("#rankPivot");
  pv.style.display = "";
  pv.innerHTML = `<span>Dashboard filtered to <b>${esc(x.name)}</b>: ${esc(x.collection)} · ${esc(x.subcategory)} · ${esc(x.category)}.</span>`;
  const clr = el("button", "linkbtn strong", "Clear pivot");
  clr.addEventListener("click", () => { resetAll(); pv.style.display = "none"; });
  pv.append(clr);
  render();
  document.getElementById("rankCard").scrollIntoView({ block: "start" });
}

/** Push the current state.filters Sets into the checkbox UI + badges. */
function syncFilterUI() {
  document.querySelectorAll("#filters .fgroup").forEach((det) => {
    const key = det.dataset.key;
    if (!key) return;
    const set = state.filters[key];
    det.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.checked = set.has(+cb.value); });
    const badge = det.querySelector(".fgroup__count");
    const total = DATA.dims[key].length;
    badge.textContent = set.size === 0 ? "All" : `${set.size}/${total}`;
    badge.classList.toggle("fgroup__count--on", set.size > 0);
  });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- render ----------
function render() {
  const rows = filterRows(DATA, state);
  curRows = rows;                       // for ranking drill-down expansion
  const k = kpis(rows);
  $("#kpiAmt").textContent = fmtMoney(k.amt);
  $("#kpiQty").textContent = fmtNum(k.qty);
  $("#kpiLines").textContent = fmtNum(k.lines);
  $("#kpiAov").textContent = fmtMoney(k.aov);
  $("#status").textContent = rows.length
    ? `${fmtNum(rows.length)} lines match` : "No rows match these filters.";

  const dimLabel = CONFIG.FILTER_DIMS.find((d) => d.key === state.breakdownDim).label;
  $("#breakdownTitle").textContent = `By ${dimLabel}`;
  renderBreakdown("chart-breakdown", breakdownBy(DATA, rows, state.breakdownDim, state.metric), state.metric);

  renderTable(rows);

  const woy = weekOfYear(rows, state.metric, state.dateBasis);
  renderWeekOfYear("chart-woy", woy, state.metric);
  renderLinear("chart-linear", linearWeeks(rows, state.metric, state.dateBasis, state.linearYears), state.metric);

  const proj = state.projYear ? projectYoY(woy, state.projYear) : null;
  const projBox = $("#projBox");
  if (proj) {
    projBox.style.display = "";
    renderProjection("chart-proj", proj, state.metric);
    const pct = ((proj.growth - 1) * 100);
    $("#projNote").innerHTML =
      `Projected <b>${proj.targetYear}</b> total: <b>${state.metric === "qty" ? fmtNum(proj.projTotal) : fmtMoney(proj.projTotal)}</b> ` +
      `&middot; pace vs ${proj.priorYear}: <b class="${pct >= 0 ? "pos" : "neg"}">${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</b> ` +
      `&middot; forecast begins after W${proj.lastActualWeek}`;
  } else {
    projBox.style.display = "none";
  }
}

function resetAll() {
  CONFIG.FILTER_DIMS.forEach((d) => state.filters[d.key].clear());
  state.orderRange = { from: 0, to: 0 };
  state.shipRange = { from: 0, to: 0 };
  document.querySelectorAll("#filters input[type=checkbox]").forEach((cb) => (cb.checked = false));
  document.querySelectorAll("#filters .fgroup__count").forEach((b) => { b.textContent = "All"; b.classList.remove("fgroup__count--on"); });
  ["#oFrom", "#oTo", "#sFrom", "#sTo"].forEach((s) => ($(s).value = ""));
  const pv = $("#rankPivot"); if (pv) pv.style.display = "none";
  const rs = $("#rankSearch"); if (rs) rs.value = "";
  state.rank.search = "";
  render();
}
