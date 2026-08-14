#!/usr/bin/env python3
"""
build_data.py — turn the "WHSL Weekly Product Export NEW" CSV into the compact
JSON the Tide Chart frontend reads.

  python3 tools/build_data.py "<export.csv>" [public/data/tide-data.json]

What it does
------------
- Drops subtotal rows (blank Style).
- Normalizes messy dimension values (case/typo dupes: MENS/Mens, Accessories/Acccessories).
- Parses "$1,234.50" -> 1234.50 and MM/DD/YY -> a sortable int (YYYYMMDD).
- Computes ISO week-of-year (1..53) + year for BOTH dates:
      Date       = order-placed date
      Date Start = ship date
- Dictionary-encodes every categorical so the payload stays small.

Output shape (see DATA_MODEL in README):
  { meta, dims:{...:[labels]}, rows:[[ ...compact ints... ]] }
"""
import csv, json, re, sys, datetime
from collections import OrderedDict

# ---- column names in the export --------------------------------------------
C_ORDER_DATE = "Date"        # when the order was placed
C_SHIP_DATE  = "Date Start"  # ship / start-ship date
C_QTY        = "Qty less Cxl"
C_AMT        = "Amount less Cxl"
C_STYLE      = "Style"        # SKU-ish style code (e.g. S24GARW-M11001BLU)
C_DESC       = "Description"  # product / style name (e.g. Garwood Shirt)
DIM_COLS = OrderedDict([
    ("category",    "Category"),
    ("collection",  "Collection"),
    ("season",      "Season"),
    ("division",    "Product Division"),
    ("subcategory", "Subcategory"),
    ("source",      "Source"),
    ("color",       "Color"),
])

DATE_RE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{2,4})\s*$")

def parse_date(s):
    """MM/DD/YY(YY) -> (yyyymmdd:int, isoYear:int, isoWeek:int) or None."""
    if not s: return None
    m = DATE_RE.match(s)
    if not m: return None
    mm, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100:  # 2-digit year -> 2000s
        yy += 2000
    try:
        d = datetime.date(yy, mm, dd)
    except ValueError:
        return None
    iso = d.isocalendar()  # (ISO year, ISO week, weekday)
    return (yy * 10000 + mm * 100 + dd, iso[0], iso[1])

def parse_money(s):
    if not s: return 0.0
    s = s.replace("$", "").replace(",", "").strip()
    if s in ("", "-"): return 0.0
    try: return round(float(s), 2)
    except ValueError: return 0.0

def parse_int(s):
    s = (s or "").replace(",", "").strip()
    try: return int(float(s))
    except ValueError: return 0

# ---- normalization: collapse case/typo dupes into canonical labels ----------
COLLECTION_FIX = {  # canonical UPPER form
    "MENS": "MENS", "WOMENS": "WOMENS", "ACCESSORIES": "ACCESSORIES",
    "YOUTH": "YOUTH", "TODDLER": "TODDLER", "INFANT": "INFANT",
    "SMALL GOODS": "SMALL GOODS", "COLLAB": "COLLAB",
}
DIVISION_FIX = {"acccessories": "Accessories"}  # known typo

def norm_collection(v):
    v = v.strip()
    return COLLECTION_FIX.get(v.upper(), v.upper()) if v else ""

def norm_division(v):
    v = v.strip()
    return DIVISION_FIX.get(v.lower(), v) if v else ""

def norm_season(v):
    # order seasons like "SUMMER 2024"; uppercase + collapse spaces to merge case dupes
    return " ".join(v.upper().split()) if v and v.strip() else ""

def norm_generic(v):
    return v.strip()

NORMALIZERS = {"collection": norm_collection, "division": norm_division,
               "season": norm_season}

def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "WHSL Weekly product Export New.csv"
    out = sys.argv[2] if len(sys.argv) > 2 else "public/data/tide-data.json"

    # dimension dicts + two extra encoded strings (name/style) for the ranking table
    EXTRA = ["name", "style"]
    dims = {k: [] for k in list(DIM_COLS) + EXTRA}   # label lists (dictionary)
    dim_index = {k: {} for k in dims}                # label -> idx
    def idx_for(dim, label):
        if label not in dim_index[dim]:
            dim_index[dim][label] = len(dims[dim])
            dims[dim].append(label)
        return dim_index[dim][label]

    rows = []
    n_total = n_kept = n_subtotal = n_baddate = 0
    with open(src, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            n_total += 1
            style = (r.get("Style") or "").strip()
            if not style:            # subtotal / total row
                n_subtotal += 1
                continue
            od = parse_date(r.get(C_ORDER_DATE, ""))
            sd = parse_date(r.get(C_SHIP_DATE, ""))
            if od is None and sd is None:
                n_baddate += 1
                continue
            dim_idx = []
            for key, col in DIM_COLS.items():
                raw = r.get(col, "") or ""
                label = NORMALIZERS.get(key, norm_generic)(raw)
                dim_idx.append(idx_for(key, label))
            qty = parse_int(r.get(C_QTY, ""))
            amt = parse_money(r.get(C_AMT, ""))
            name_i = idx_for("name", (r.get(C_DESC, "") or "").strip())
            style_i = idx_for("style", style)
            # row: [cat,col,sea,div,sub,src,color, oYYYYMMDD,oYear,oWeek,
            #       sYYYYMMDD,sYear,sWeek, qty, amt, name, style]
            rows.append(dim_idx + [
                od[0] if od else 0, od[1] if od else 0, od[2] if od else 0,
                sd[0] if sd else 0, sd[1] if sd else 0, sd[2] if sd else 0,
                qty, amt, name_i, style_i,
            ])
            n_kept += 1

    def col(i):  # collect a compact-row column
        return [row[i] for row in rows]
    o_dates = [v for v in col(7) if v]
    s_dates = [v for v in col(10) if v]
    o_years = sorted({row[8] for row in rows if row[8]})
    s_years = sorted({row[11] for row in rows if row[11]})

    payload = {
        "meta": {
            "generatedAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "sourceFile": src.split("/")[-1],
            "rowsKept": n_kept, "rowsTotal": n_total,
            "subtotalRowsDropped": n_subtotal, "badDateRowsDropped": n_baddate,
            "orderDateMin": min(o_dates) if o_dates else None,
            "orderDateMax": max(o_dates) if o_dates else None,
            "shipDateMin": min(s_dates) if s_dates else None,
            "shipDateMax": max(s_dates) if s_dates else None,
            "orderYears": o_years, "shipYears": s_years,
            # field layout so the frontend never hard-codes magic indices
            "fields": ["category","collection","season","division","subcategory",
                       "source","color","oDate","oYear","oWeek","sDate","sYear",
                       "sWeek","qty","amt","name","style"],
        },
        "dims": dims,
        "rows": rows,
    }
    import os
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_mb = os.path.getsize(out) / 1e6
    print(f"kept {n_kept:,}/{n_total:,} rows  (dropped {n_subtotal:,} subtotals, "
          f"{n_baddate:,} bad-date)")
    print("dims:", {k: len(v) for k, v in dims.items()})
    print(f"order dates {payload['meta']['orderDateMin']}->{payload['meta']['orderDateMax']}  "
          f"ship dates {payload['meta']['shipDateMin']}->{payload['meta']['shipDateMax']}")
    print(f"wrote {out}  ({size_mb:.2f} MB)")

if __name__ == "__main__":
    main()
