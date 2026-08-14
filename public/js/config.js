// ============================================================
// config.js — point the app at its data + brand tokens.
// ============================================================
export const CONFIG = {
  // -------- DATA SOURCE --------
  // LIVE: the Apps Script web app feed (?key= matches READ_KEY in Script Properties).
  DATA_URL: "https://script.google.com/macros/s/AKfycbzzbhDpJi7pYS5RiV7n1G5oHI32q8qEEH5_P7o_h5pf_denj-NoJ90oHccUuPHOkPhq/exec?key=tide-chart-2003",
  // Local preview fallback (swap in for offline work): "data/tide-data.json"
  // Runtime override for testing: add ?data=<url> to the address bar.

  // Cache the fetched dataset in localStorage for this many minutes.
  CACHE_MINUTES: 30,

  // Field layout is authoritative in meta.fields; these mirror it for readability.
  IDX: { category:0, collection:1, season:2, division:3, subcategory:4, source:5,
         color:6, oDate:7, oYear:8, oWeek:9, sDate:10, sYear:11, sWeek:12,
         qty:13, amt:14, name:15, style:16 },

  // Dimensions offered as the ranking table's color-code (what the swatches mean).
  COLORCODE_DIMS: [
    { key: "collection",  label: "Collection" },
    { key: "category",    label: "Category" },
    { key: "division",    label: "Product Division" },
    { key: "subcategory", label: "Subcategory" },
    { key: "name",        label: "Style name" },
  ],

  // Which dimensions get a filter group, in display order. (color is high-card,
  // shown last / collapsed.)
  FILTER_DIMS: [
    { key: "collection",  label: "Collection" },
    { key: "division",    label: "Product Division" },
    { key: "category",    label: "Category" },
    { key: "subcategory", label: "Subcategory" },
    { key: "season",      label: "Season" },
    { key: "source",      label: "Source" },
    { key: "color",       label: "Color" },
  ],

  // Official Jetty palette (mirrors css/styles.css) — used by Chart.js.
  COLORS: {
    deepSea: "#43575E", atlantic: "#586D72", midTone: "#8FA8AE",
    sage: "#5A7B6A", sand: "#8B6F47", graphite: "#252933",
    cloud: "#F6F7F7", greySky: "#EDECED",
    pos: "#2f7d4f", neg: "#c0392b",
  },
  // Ordered muted series palette for single-dimension bar charts.
  SERIES: ["#43575E", "#586D72", "#5A7B6A", "#8B6F47", "#8FA8AE", "#34464c",
           "#6f8a90", "#728a76", "#a98f63", "#252933"],
  // High-contrast palette for MULTI-LINE charts (year overlays), where muted
  // brand tones are too similar to tell lines apart. Off-brand on purpose.
  LINE_SERIES: ["#2563EB", "#EA580C", "#16A34A", "#DC2626", "#9333EA",
                "#0891B2", "#DB2777", "#CA8A04", "#4F46E5", "#0D9488"],
  SOURCE_COLORS: { "PRE-BOOK": "#43575E", "AO": "#5A7B6A",
                   "Post Deadline": "#8B6F47", "Special Drop": "#8FA8AE" },
};
