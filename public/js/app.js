// ============================================================
// app.js — wire the UI: filters, toggles, date ranges, render loop.
// ============================================================
import { CONFIG } from "./config.js";
import { loadData } from "./data.js";
import { fmtMoney, fmtNum, fmtMoneyShort, ymdToInput, inputToYmd, ymdToDisplay } from "./format.js";
import { filterRows, kpis, breakdownBy, weekOfYear, linearWeeks, projectYoY, rankStyles } from "./compute.js";
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
  rank: { sortKey: "amt", dir: -1, colorDim: "collection", search: "" },
};
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

  const search = $("#rankSearch");
  let t = null;
  search.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.rank.search = search.value.trim().toLowerCase(); render(); }, 120);
  });

  // click a column header to sort; click again to flip direction
  document.querySelectorAll("#rankTable thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      const r = state.rank;
      if (r.sortKey === key) r.dir = -r.dir;
      else { r.sortKey = key; r.dir = (key === "name" || key === "collection" ||
             key === "category" || key === "subcategory") ? 1 : -1; }
      render();
    });
  });
}

function renderTable(rows) {
  if (DATA.meta.fields.indexOf("name") === -1) return;   // table hidden on old feeds
  const r = state.rank;
  let items = rankStyles(DATA, rows);

  // search filter (style name or any dominant attribute)
  if (r.search) {
    items = items.filter((x) =>
      x.name.toLowerCase().includes(r.search) ||
      x.collection.toLowerCase().includes(r.search) ||
      x.category.toLowerCase().includes(r.search) ||
      x.subcategory.toLowerCase().includes(r.search));
  }
  const totalMatches = items.length;

  // sort
  const key = r.sortKey, dir = r.dir;
  const cmp = (key === "name" || key === "collection" || key === "category" || key === "subcategory")
    ? (a, b) => String(a[key]).localeCompare(String(b[key])) * dir
    : (a, b) => (a[key] - b[key]) * dir;
  items.sort(cmp);

  // header arrows
  document.querySelectorAll("#rankTable thead th[data-sort]").forEach((th) => {
    const a = th.querySelector(".arrow");
    a.textContent = th.dataset.sort === key ? (dir < 0 ? "▼" : "▲") : "";
  });

  // color-code: rank distinct values of the chosen dim by total dollars, map to palette
  const cd = r.colorDim;
  const weight = new Map();
  for (const x of items) {
    const kk = cd === "name" ? x.nameIdx : x.dom[cd];
    weight.set(kk, (weight.get(kk) || 0) + x.amt);
  }
  const orderKeys = [...weight.keys()].sort((a, b) => weight.get(b) - weight.get(a));
  const colorPos = new Map(orderKeys.map((k, i) => [k, i]));
  const colorFor = (x) => {
    const kk = cd === "name" ? x.nameIdx : x.dom[cd];
    return RANK_PALETTE[colorPos.get(kk) % RANK_PALETTE.length];
  };

  // legend (skip for style-name — too many)
  const legend = $("#rankLegend");
  legend.innerHTML = "";
  if (cd !== "name") {
    const labelFor = (k) => DATA.dims[cd][k] || "(blank)";
    orderKeys.slice(0, 16).forEach((k) => {
      const el2 = el("span", "lg");
      const sw = el("span", "sw"); sw.style.background = RANK_PALETTE[colorPos.get(k) % RANK_PALETTE.length];
      el2.append(sw, document.createTextNode(labelFor(k)));
      legend.append(el2);
    });
    if (orderKeys.length > 16) legend.append(el("span", "lg", `+${orderKeys.length - 16} more`));
  } else {
    legend.append(el("span", "lg", "each style shown in its own color"));
  }

  // body (cap render for performance; sort already put the important ones on top)
  const CAP = 250;
  const shown = items.slice(0, CAP);
  const metric = state.metric;
  const body = $("#rankBody");
  body.innerHTML = "";
  const frag = document.createDocumentFragment();
  shown.forEach((x, i) => {
    const tr = document.createElement("tr");
    const nameCell = `<td class="rank__l"><div class="rank__name"><span class="sw" style="background:${colorFor(x)}"></span><span title="${esc(x.name)}">${esc(x.name)}</span></div></td>`;
    tr.innerHTML =
      `<td class="rank__num">${i + 1}</td>` +
      nameCell +
      `<td class="rank__l">${esc(x.collection)}</td>` +
      `<td class="rank__l">${esc(x.category)}</td>` +
      `<td class="rank__l">${esc(x.subcategory)}</td>` +
      `<td class="rank__val">${fmtNum(x.colors)}</td>` +
      `<td class="rank__val">${fmtNum(x.qty)}</td>` +
      `<td class="rank__val">${fmtMoney(x.amt)}</td>` +
      `<td class="rank__act"><button class="rank__pivotbtn" title="Filter the whole dashboard to this style's Collection / Category / Subcategory / Division">→</button></td>`;
    tr.querySelector(".rank__pivotbtn").addEventListener("click", () => pivotToStyle(x));
    frag.append(tr);
  });
  body.append(frag);

  $("#rankFoot").textContent =
    `${fmtNum(totalMatches)} styles${r.search ? ` matching “${r.search}”` : ""}` +
    (totalMatches > CAP ? ` · showing top ${CAP} by ${key === "qty" ? "the current sort" : "the current sort"}` : "") +
    ` · sorted by ${sortLabel(key)} ${dir < 0 ? "↓" : "↑"}`;
}

function sortLabel(k) {
  return { name: "style", collection: "collection", category: "category",
    subcategory: "subcategory", colors: "colors", qty: "units", amt: "dollars" }[k] || k;
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
