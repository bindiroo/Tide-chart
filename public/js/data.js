// ============================================================
// data.js — load the dataset (localStorage cache + retry), mirroring the
// Jetty Central api.js pattern (Apps Script /exec can 302->404 intermittently).
// ============================================================
import { CONFIG } from "./config.js";

const CACHE_KEY = "tide_chart_cache_v1";
const BUNDLED_URL = "data/tide-data.json";   // snapshot shipped with the site

function dataUrl() {
  const q = new URLSearchParams(location.search).get("data");
  return q || CONFIG.DATA_URL;
}

/** Payload is current-schema and non-empty (has the ranking fields + rows). */
function usable(p) {
  return p && p.meta && Array.isArray(p.meta.fields) &&
    p.meta.fields.indexOf("name") !== -1 && Array.isArray(p.rows) && p.rows.length > 0;
}

/** Fetch + parse JSON; returns null on any failure (with a few retries). */
async function tryFetch(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.json();
    } catch (_) {}
    if (attempt < retries) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  return null;
}

/**
 * Load the dataset. Prefer the live Apps Script feed, but only once it serves the
 * current schema (i.e. after the Monday "WHSL Tide Chart" ingest). Until then —
 * or if the feed is unreachable — fall back to the bundled snapshot so the site
 * always shows correct, complete data. The live feed takes over automatically.
 */
export async function loadData({ forceFresh = false } = {}) {
  const url = dataUrl();

  if (!forceFresh) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.url === url && Date.now() - c.t < CONFIG.CACHE_MINUTES * 60000 && usable(c.data))
        return c.data;
    } catch (_) {}
  }

  // 1) primary feed (whatever DATA_URL / ?data points at)
  const primary = await tryFetch(url);
  if (usable(primary)) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ url, t: Date.now(), data: primary })); } catch (_) {}
    return primary;
  }

  // 2) bundled snapshot (unless the primary already WAS the bundle)
  if (url !== BUNDLED_URL) {
    const bundled = await tryFetch(BUNDLED_URL);
    if (usable(bundled)) return bundled;
  }

  // 3) last resort: any cached copy, then the primary even if imperfect
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.data) return c.data;
  } catch (_) {}
  if (primary) return primary;
  throw new Error("Data fetch failed");
}
