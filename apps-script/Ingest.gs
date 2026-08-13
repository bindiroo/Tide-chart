/*** ============================================================
 * Ingest.gs — the scheduled weekly job.
 *   1. Find the newest "WHSL Weekly Product Export" email + its CSV attachment
 *   2. Parse + normalize (mirrors tools/build_data.py exactly)
 *   3. Build the compact dashboard JSON and cache it (chunked) in the Meta tab
 *
 * The weekly file is the FULL historical export, so each run FULLY REPLACES the
 * dataset (no append/merge). Install the Monday trigger with installTrigger().
 * ============================================================ */

function ingestWeekly() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { Logger.log('Another ingest is running'); return; }
  try {
    var att = firstCsvBySubject_(CONFIG.SUBJECT, CONFIG.LOOKBACK_DAYS);
    if (!att) {
      log_('Ingest skipped: no email matching "' + CONFIG.SUBJECT + '" in last ' +
        CONFIG.LOOKBACK_DAYS + 'd. Run debugInbox() to see what is in the inbox.');
      return;
    }
    var rows = Utilities.parseCsv(att.getDataAsString());
    var payload = buildPayload_(rows, att.getName());   // see Normalize.gs
    cacheDashboard_(payload);
    log_('Ingest OK from "' + att.getName() + '": kept ' + payload.meta.rowsKept +
      '/' + payload.meta.rowsTotal + ' rows (dropped ' + payload.meta.subtotalRowsDropped +
      ' subtotals, ' + payload.meta.badDateRowsDropped + ' bad-date). dims=' +
      JSON.stringify(dimSizes_(payload.dims)));
  } catch (err) {
    log_('Ingest ERROR: ' + (err && err.stack ? err.stack : err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function dimSizes_(dims) {
  var o = {}; for (var k in dims) o[k] = dims[k].length; return o;
}

/** Newest email matching `subject` (substring) -> its CSV attachment (or null). */
function firstCsvBySubject_(subject, lookbackDays) {
  var days = lookbackDays || CONFIG.LOOKBACK_DAYS;
  var q = (CONFIG.SENDER ? 'from:' + CONFIG.SENDER + ' ' : '') +
    'subject:("' + subject + '") newer_than:' + days + 'd has:attachment';
  var threads = GmailApp.search(q, 0, 5);   // newest activity first
  for (var t = 0; t < threads.length; t++) {
    var msgs = threads[t].getMessages();
    for (var m = msgs.length - 1; m >= 0; m--) {          // newest message first
      if (msgs[m].getSubject().toLowerCase().indexOf(subject.toLowerCase()) === -1) continue;
      var atts = msgs[m].getAttachments();
      for (var a = 0; a < atts.length; a++) {
        if (/\.csv$/i.test(atts[a].getName())) return atts[a];
      }
      if (atts.length) return atts[0];
    }
  }
  return null;
}

/**
 * Cache the dashboard JSON. Properties has a 9KB/value limit, so store the JSON
 * in the Meta tab (row 2, chunked ~45k chars/cell — cell limit is 50k) and keep
 * a small pointer in Properties. doGet reads it back and returns it verbatim.
 */
function cacheDashboard_(payload) {
  var json = JSON.stringify(payload);
  var sh = sheet_(CONFIG.TABS.META);
  sh.clearContents();
  var CHUNK = 45000, chunks = [];
  for (var i = 0; i < json.length; i += CHUNK) chunks.push(json.slice(i, i + CHUNK));
  sh.getRange(1, 1).setValue('dashboard_json_chunks');
  sh.getRange(2, 1, 1, chunks.length).setValues([chunks]);
  PropertiesService.getScriptProperties().setProperties({
    LAST_RUN: payload.meta.generatedAt,
    CHUNK_COUNT: String(chunks.length),
  });
}

function readDashboardJson_() {
  var n = parseInt(prop_('CHUNK_COUNT') || '0', 10);
  if (!n) return null;
  var vals = sheet_(CONFIG.TABS.META).getRange(2, 1, 1, n).getValues()[0];
  return vals.join('');
}

function log_(msg) {
  Logger.log(msg);
  try { sheet_(CONFIG.TABS.LOG).appendRow([new Date(), msg]); } catch (e) {}
}

/** Run once manually to install the Monday ~6:15am trigger. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'ingestWeekly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('ingestWeekly').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).nearMinute(15).create();
  log_('Installed weekly trigger for ingestWeekly @ Monday ~6:15am');
}

/**
 * DETECTIVE TOOL — run if ingest says "no email matching". Writes to the Log tab:
 * which Google account is running + every recent email whose subject/attachments
 * might be the export, so you can confirm the exact SUBJECT / SENDER for Config.
 */
function debugInbox() {
  var sh = sheet_(CONFIG.TABS.LOG);
  var who = Session.getActiveUser().getEmail() || '(hidden — check which account opened Apps Script)';
  sh.appendRow([new Date(), 'debugInbox START — searching inbox of: ' + who]);
  var hit = firstCsvBySubject_(CONFIG.SUBJECT, CONFIG.LOOKBACK_DAYS);
  sh.appendRow([new Date(), 'Configured SUBJECT="' + CONFIG.SUBJECT + '" SENDER="' +
    (CONFIG.SENDER || '(any)') + '" -> CSV found: ' + (hit ? hit.getName() : 'NO')]);
  var broad = GmailApp.search('newer_than:14d has:attachment', 0, 25);
  sh.appendRow([new Date(), 'Recent emails with attachments (14d): ' + broad.length]);
  for (var t = 0; t < broad.length; t++) {
    var msgs = broad[t].getMessages();
    for (var m = 0; m < msgs.length; m++) {
      var names = msgs[m].getAttachments().map(function (a) { return a.getName(); });
      if (!names.length) continue;
      sh.appendRow([new Date(), 'MAIL | ' + msgs[m].getDate() + ' | from: ' + msgs[m].getFrom() +
        ' | subject: ' + msgs[m].getSubject() + ' | attachments: ' + names.join('  ||  ')]);
    }
  }
  sh.appendRow([new Date(), 'debugInbox END — read the rows above']);
  Logger.log('debugInbox done — open the Log tab.');
}
