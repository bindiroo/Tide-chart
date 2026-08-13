/*** ============================================================
 * Code.gs — web app entry point.
 *   doGet -> returns the cached dashboard JSON (the Tide Chart site reads this)
 *
 * Deploy: Deploy ▸ New deployment ▸ Web app
 *   Execute as: Me
 *   Who has access: Anyone   (gated by READ_KEY, not by Google login, so the
 *                             static site can fetch it)
 * Then set public/js/config.js DATA_URL to:
 *   https://script.google.com/macros/s/XXXX/exec?key=YOUR_READ_KEY
 * ============================================================ */

function doGet(e) {
  var readKey = prop_('READ_KEY');
  if (readKey && (!e || !e.parameter || e.parameter.key !== readKey)) {
    return jsonOut_({ ok: false, error: 'Unauthorized' });
  }
  var json = readDashboardJson_();
  if (!json) return jsonOut_({ ok: false, error: 'No data yet — run runIngestNow()' });
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run manually to confirm the pipeline end-to-end (parses newest email now). */
function runIngestNow() { ingestWeekly(); }
