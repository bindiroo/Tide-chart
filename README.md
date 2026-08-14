# Tide Chart — Jetty Product Trends

A weekly-updating dashboard for **product data, seasonality, and sales trends**, built
along the same lines as the Jetty Central Sales Dashboard. Toggle every filter from the
WHSL export, set independent **order-placed** and **ship** date ranges, and read booked
**dollars or units** across categories, collections, and time — plus year-over-year
seasonality and a forward projection.

> **Status:** frontend is fully built and runs today on the real export
> (**41,029 order lines**, 2022 → mid-2027). Next: wire the Monday-6am email
> ingestion (Apps Script + Google Sheets) and deploy (Netlify + GitHub), mirroring
> Jetty Central.

---

## Run it locally

```bash
python3 -m http.server 8137 --directory public
# open http://localhost:8137
```

It loads `public/data/tide-data.json`. To regenerate that from a new export:

```bash
python3 tools/build_data.py "<WHSL Weekly product Export New.csv>" public/data/tide-data.json
```

---

## What the dashboard shows

- **KPIs** — booked $ (less cancels), units (less cancels), order lines, avg $/unit.
- **Breakdown** — booked metric by any dimension (Collection, Division, Category,
  Subcategory, Season, Source), sorted, top-N with an "Other" roll-up.
- **Seasonality (week of year)** — weeks 1–53, one line per year overlaid, so the
  seasonal ebb & flow and year-over-year shape are directly comparable.
- **Timeline** — the same weekly data in true calendar sequence (gaps and peaks).
- **Projection** — for a target year, actuals to date + a YoY-paced forecast for the
  remaining weeks, with the projected season total and pace vs. the prior year.

Everything responds to the filters and to two toggles: **Metric** (Dollars ⇄ Units)
and **Trend basis** (Order date ⇄ Ship date — which date drives the time charts).

---

## Data model

The export is line-level. `tools/build_data.py`:

- drops subtotal rows (blank `Style`),
- normalizes case/typo dupes (`MENS`/`Mens`, `Accessories`/`Acccessories`),
- parses `$1,234.50 → 1234.50` and `MM/DD/YY → YYYYMMDD` int,
- computes ISO **week-of-year (1–53)** + year for both dates,
- dictionary-encodes every dimension to keep the payload small (~2.5 MB).

| Source column        | Meaning                          | Used as            |
|----------------------|----------------------------------|--------------------|
| `Date`               | when the order was **placed**    | order-date filter + "Order date" trend basis |
| `Date Start`         | **ship** / start-ship date       | ship-date filter + "Ship date" trend basis   |
| `Qty less Cxl`       | units, net of cancels            | Units metric       |
| `Amount less Cxl`    | dollars, net of cancels          | Dollars metric     |
| Category / Collection / Season / Product Division / Subcategory / Source / Color | filters | toggle groups |

Output JSON: `{ meta, dims:{dim:[labels]}, rows:[[...compact ints per meta.fields]] }`.
The frontend filters and aggregates the rows client-side, so any filter combination
recomputes instantly.

---

## Architecture (target, mirrors Jetty Central)

```
Gmail (Apparel Magic, "WHSL Tide Chart", Mon 6am)
   │  1 CSV attachment
   ▼  [SCHEDULED Mon ~6:15am]  Google Apps Script: ingestWeekly()
        parse → normalize → dictionary-encode → cache JSON
   ├─► Google Sheets tab(s) (raw + meta)
   └─► cached tide-data.json  (served via doGet ?key=…)
            ▲
            │ on page load (30-min localStorage cache)
   Static site (this repo's public/) ── git push → auto-deploy
```

- **Access:** shared `?key=` link (unlisted), same as Jetty Central.
- **Assumption:** the weekly email carries the **full historical export** (replaces the
  dataset each week), which matches the file we built from. Confirm before go-live.
