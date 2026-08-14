/*** ============================================================
 * Config.gs — central settings for the Tide Chart ingest.
 *
 * Secrets live in Script Properties (Project Settings ▸ Script Properties),
 * NOT in code. Set these once:
 *   SPREADSHEET_ID  – the Google Sheet that stores the cached JSON + log
 *   READ_KEY        – shared key required on doGet (?key=...). Match it in the
 *                     frontend's public/js/config.js DATA_URL.
 * ============================================================ */

const CONFIG = {
  // The weekly export email. Matched by SUBJECT as a substring (case-insensitive).
  // SENDER is optional: leave '' to match on subject alone (most robust if you're
  // unsure of the exact From address). Set it to e.g. 'apparelmagic.com' to
  // narrow the search once you've confirmed the sender via debugInbox().
  SUBJECT: 'WHSL Tide Chart',
  SENDER: 'apparelmagic.com', // '' = any sender; narrowed to the ApparelMagic domain
  LOOKBACK_DAYS: 10,          // window to find the newest matching email (covers a missed Monday)

  // Sheet tab names.
  TABS: {
    META: 'Meta',             // cached dashboard JSON (chunked) — read by doGet
    LOG:  'Log',              // run log (newest rows at the bottom)
  },

  // Column headers expected in the export (used to locate columns by name, so
  // column ORDER in the file can change without breaking ingest).
  COLS: {
    orderDate: 'Date',            // when the order was placed
    shipDate:  'Date Start',      // ship / start-ship date
    qty:       'Qty less Cxl',
    amt:       'Amount less Cxl',
    style:     'Style',           // blank on subtotal rows -> dropped
    description: 'Description',    // product / style name (e.g. Garwood Shirt)
    // dimensions (frontend order): category, collection, season, division, subcategory, source, color
    category:    'Category',
    collection:  'Collection',
    season:      'Season',
    division:    'Product Division',
    subcategory: 'Subcategory',
    source:      'Source',
    color:       'Color',
  },
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
function sheet_(name) {
  const ss = SpreadsheetApp.openById(prop_('SPREADSHEET_ID'));
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
