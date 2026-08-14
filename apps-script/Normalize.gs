/*** ============================================================
 * Normalize.gs — buildPayload_(): the faithful GAS port of
 * tools/build_data.py. Produces the SAME JSON shape the frontend reads, so
 * public/ runs unchanged whether data comes from the local file or from doGet.
 *
 * Output: { meta, dims:{dim:[labels]}, rows:[[...ints per meta.fields]] }
 * Row layout: [category,collection,season,division,subcategory,source,color,
 *              oDate,oYear,oWeek, sDate,sYear,sWeek, qty, amt]
 * ============================================================ */

// dimension key -> header name, in the frontend's fixed order.
var DIM_ORDER_ = [
  ['category', 'category'], ['collection', 'collection'], ['season', 'season'],
  ['division', 'division'], ['subcategory', 'subcategory'], ['source', 'source'],
  ['color', 'color'],
];

var COLLECTION_FIX_ = {
  'MENS': 'MENS', 'WOMENS': 'WOMENS', 'ACCESSORIES': 'ACCESSORIES', 'YOUTH': 'YOUTH',
  'TODDLER': 'TODDLER', 'INFANT': 'INFANT', 'SMALL GOODS': 'SMALL GOODS', 'COLLAB': 'COLLAB',
};
var DIVISION_FIX_ = { 'acccessories': 'Accessories' };

function normCollection_(v) { v = (v || '').trim(); if (!v) return ''; var u = v.toUpperCase(); return COLLECTION_FIX_[u] || u; }
function normDivision_(v)  { v = (v || '').trim(); if (!v) return ''; return DIVISION_FIX_[v.toLowerCase()] || v; }
function normSeason_(v)    { v = (v || '').trim(); return v ? v.toUpperCase().split(/\s+/).join(' ') : ''; }
function normGeneric_(v)   { return (v || '').trim(); }

function parseMoney_(s) {
  if (!s) return 0;
  s = String(s).replace(/\$/g, '').replace(/,/g, '').trim();
  if (s === '' || s === '-') return 0;
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}
function parseIntSafe_(s) {
  s = String(s || '').replace(/,/g, '').trim();
  var n = parseInt(s, 10);
  return isNaN(n) ? 0 : n;
}

/** "M/D/YY" or "MM/DD/YYYY" -> { ymd:YYYYMMDD, y:isoYear, w:isoWeek } or null. */
function parseDate_(s) {
  if (!s) return null;
  var m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  var mm = +m[1], dd = +m[2], yy = +m[3];
  if (yy < 100) yy += 2000;
  var d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null; // invalid
  var iso = isoWeek_(yy, mm, dd);
  return { ymd: yy * 10000 + mm * 100 + dd, y: iso.year, w: iso.week };
}

/** ISO-8601 week + ISO week-year (matches Python date.isocalendar()). */
function isoWeek_(y, m, d) {
  var date = new Date(Date.UTC(y, m - 1, d));
  var dayNum = (date.getUTCDay() + 6) % 7;                 // Mon=0 .. Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3);         // nearest Thursday
  var isoYear = date.getUTCFullYear();
  var firstTh = new Date(Date.UTC(isoYear, 0, 4));
  var firstDayNum = (firstTh.getUTCDay() + 6) % 7;
  firstTh.setUTCDate(firstTh.getUTCDate() - firstDayNum + 3);
  var week = 1 + Math.round((date.getTime() - firstTh.getTime()) / (7 * 24 * 3600 * 1000));
  return { year: isoYear, week: week };
}

/** Strip BOM + surrounding quotes/whitespace from a header cell. */
function cleanHeader_(h) { return String(h || '').replace(/^﻿/, '').replace(/^"|"$/g, '').trim(); }

function buildPayload_(csvRows, sourceName) {
  if (!csvRows || csvRows.length < 2) throw new Error('CSV has no data rows');
  var header = csvRows[0].map(cleanHeader_);
  var col = {};                                            // header name -> index
  for (var i = 0; i < header.length; i++) col[header[i]] = i;
  function need(name) {
    if (!(name in col)) throw new Error('Missing expected column: "' + name + '"');
    return col[name];
  }
  var C = CONFIG.COLS;
  var iStyle = need(C.style), iOd = need(C.orderDate), iSd = need(C.shipDate),
      iQty = need(C.qty), iAmt = need(C.amt), iDesc = need(C.description);
  var dimIdxCols = DIM_ORDER_.map(function (p) { return need(C[p[0]]); });
  var normalizers = { collection: normCollection_, division: normDivision_,
                      season: normSeason_ };

  // dimension dicts + two extra encoded strings (name/style) for the ranking table
  var EXTRA = ['name', 'style'];
  var dims = {}, dimIndex = {};
  DIM_ORDER_.forEach(function (p) { dims[p[0]] = []; dimIndex[p[0]] = {}; });
  EXTRA.forEach(function (k) { dims[k] = []; dimIndex[k] = {}; });
  function idxFor(dimKey, label) {
    var idx = dimIndex[dimKey];
    if (!(label in idx)) { idx[label] = dims[dimKey].length; dims[dimKey].push(label); }
    return idx[label];
  }

  var rows = [];
  var nTotal = 0, nKept = 0, nSub = 0, nBad = 0;
  for (var r = 1; r < csvRows.length; r++) {
    var row = csvRows[r];
    if (row.length === 1 && row[0] === '') continue;        // stray blank line
    nTotal++;
    var style = (row[iStyle] || '').trim();
    if (!style) { nSub++; continue; }                       // subtotal / total row
    var od = parseDate_(row[iOd]);
    var sd = parseDate_(row[iSd]);
    if (od === null && sd === null) { nBad++; continue; }
    var enc = [];
    for (var c = 0; c < DIM_ORDER_.length; c++) {
      var key = DIM_ORDER_[c][0];
      var raw = row[dimIdxCols[c]] || '';
      var norm = (normalizers[key] || normGeneric_)(raw);
      enc.push(idxFor(key, norm));
    }
    var nameI = idxFor('name', (row[iDesc] || '').trim());
    var styleI = idxFor('style', style);
    rows.push(enc.concat([
      od ? od.ymd : 0, od ? od.y : 0, od ? od.w : 0,
      sd ? sd.ymd : 0, sd ? sd.y : 0, sd ? sd.w : 0,
      parseIntSafe_(row[iQty]), parseMoney_(row[iAmt]), nameI, styleI,
    ]));
    nKept++;
  }

  // meta ranges + year lists
  var oDates = [], sDates = [], oYears = {}, sYears = {};
  for (var k = 0; k < rows.length; k++) {
    var rr = rows[k];
    if (rr[7]) { oDates.push(rr[7]); oYears[rr[8]] = 1; }
    if (rr[10]) { sDates.push(rr[10]); sYears[rr[11]] = 1; }
  }
  var minMax = function (a) { return a.length ? [Math.min.apply(null, a), Math.max.apply(null, a)] : [null, null]; };
  var oMM = minMax(oDates), sMM = minMax(sDates);
  var sortNums = function (o) { return Object.keys(o).map(Number).sort(function (a, b) { return a - b; }); };

  return {
    meta: {
      generatedAt: new Date().toISOString().replace(/\.\d+Z$/, ''),
      sourceFile: sourceName || '',
      rowsKept: nKept, rowsTotal: nTotal,
      subtotalRowsDropped: nSub, badDateRowsDropped: nBad,
      orderDateMin: oMM[0], orderDateMax: oMM[1],
      shipDateMin: sMM[0], shipDateMax: sMM[1],
      orderYears: sortNums(oYears), shipYears: sortNums(sYears),
      fields: ['category', 'collection', 'season', 'division', 'subcategory',
               'source', 'color', 'oDate', 'oYear', 'oWeek', 'sDate', 'sYear',
               'sWeek', 'qty', 'amt', 'name', 'style'],
    },
    dims: dims,
    rows: rows,
  };
}
