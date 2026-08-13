// ============================================================
// app.js — wire the UI: filters, toggles, date ranges, render loop.
// ============================================================
import { CONFIG } from "./config.js";
import { loadData } from "./data.js";
import { fmtMoney, fmtNum, fmtMoneyShort, ymdToInput, inputToYmd, ymdToDisplay } from "./format.js";
import { filterRows, kpis, breakdownBy, weekOfYear, linearWeeks, projectYoY } from "./compute.js";
import { renderBreakdown, renderWeekOfYear, renderLinear, renderProjection } from "./charts.js";

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
  bindToggle("#metricToggle", "metric", () => render());
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
  render();
}
