// ============================================================
// data.js — load the dataset (localStorage cache + retry), mirroring the
// Jetty Central api.js pattern (Apps Script /exec can 302->404 intermittently).
// ============================================================
import { CONFIG } from "./config.js";

const CACHE_KEY = "tide_chart_cache_v1";

function dataUrl() {
  const q = new URLSearchParams(location.search).get("data");
  return q || CONFIG.DATA_URL;
}

export async function loadData({ forceFresh = false } = {}) {
  const url = dataUrl();
  if (!forceFresh) {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.url === url && Date.now() - c.t < CONFIG.CACHE_MINUTES * 60000)
        return c.data;
    } catch (_) {}
  }
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ url, t: Date.now(), data })); } catch (_) {}
        return data;
      }
      lastErr = new Error(`Data fetch failed (${res.status})`);
    } catch (err) { lastErr = err; }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
  }
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (c && c.url === url && c.data) return c.data;
  } catch (_) {}
  throw lastErr || new Error("Data fetch failed");
}
