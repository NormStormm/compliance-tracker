/**
 * Main.gs: the daily check, reminder emails, audit log and manual renewals.
 *
 * Safety by design:
 *   - Mode LOG_ONLY (the default) never sends email; it records what *would* be sent.
 *   - Mode TEST sends every email to you (or the test recipient), never to real owners.
 *   - Each reminder stage is sent at most once, so re-running the check never spams.
 *   - One bad row can't stop the run: errors are caught, logged, and the check moves on.
 *   - A lock stops two checks (e.g. the timer and a manual click) from running at once.
 */

/** Called by the daily timer. */
function runDailyCheck() {
  return runCheck_({ source: 'timer' });
}

/** Called from the menu: same check, plus a pop-up summary. */
function runCheckFromMenu() {
  var result = runCheck_({ source: 'menu' });
  SpreadsheetApp.getActive().toast(result.summary, 'Compliance check finished', 10);
}

function runCheck_(opts) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another check is already running. Try again in a minute.');
  try {
    var ss = SpreadsheetApp.getActive();
    var tz = ss.getSpreadsheetTimeZone();
    var settings = getSettings_();
    var mode = String(settings['Mode'] || 'LOG_ONLY').trim().toUpperCase();
    var stages = parseStages(settings['Reminder days']);
    var repeatDays = Number(settings['Overdue repeat (days)']) || 0;
    var todayYmd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');

    var sheet = ss.getSheetByName(SHEETS.TRACKER);
    var lastRow = sheet.getLastRow();
    var log = [];
    var digest = [];
    var counts = { checked: 0, notices: 0, errors: 0 };

    if (lastRow >= 2) {
      var rows = sheet.getRange(2, 1, lastRow - 1, TRACKER_HEADERS.length).getValues();
      var out = rows.map(function (row) {
        var keep = [row[COL.STATUS - 1], row[COL.STAGE - 1], row[COL.LAST_SENT - 1], row[COL.TRACKED - 1]];
        var id = row[COL.ID - 1], name = row[COL.NAME - 1];
        if (!id && !name) return keep; // blank row
        counts.checked++;
        try {
          return checkRow_(row, { tz: tz, todayYmd: todayYmd, stages: stages, repeatDays: repeatDays,
            mode: mode, settings: settings, log: log, digest: digest, counts: counts });
        } catch (err) {
          counts.errors++;
          log.push(logRow_(id, name, 'ERROR', 'Row skipped: ' + err.message, '', mode));
          return keep;
        }
      });
      sheet.getRange(2, COL.STATUS, out.length, 4).setValues(out);
    }

    sendDigest_(digest, settings, mode, todayYmd, log);
    appendLog_(log);

    var summary = counts.checked + ' items checked \u00b7 ' + counts.notices + ' notice(s) ' +
      (mode === 'LOG_ONLY' ? 'logged (not sent)' : 'sent in ' + mode + ' mode') +
      ' \u00b7 ' + counts.errors + ' data error(s)';
    setSetting_('Last run', new Date());
    setSetting_('Last run summary', summary + ' [' + opts.source + ']');
    return { summary: summary, counts: counts };
  } finally {
    lock.releaseLock();
  }
}

/** Works out one row's status, sends any notice that's due, and returns the new [Status, Stage, Last Sent, Tracked]. */
function checkRow_(row, ctx) {
  var id = row[COL.ID - 1], name = row[COL.NAME - 1];
  var oldStatus = String(row[COL.STATUS - 1] || '');
  var stage = row[COL.STAGE - 1] === '' ? '' : String(row[COL.STAGE - 1]);
  var lastSent = toYmd_(row[COL.LAST_SENT - 1], ctx.tz);
  var tracked = toYmd_(row[COL.TRACKED - 1], ctx.tz);
  var expiry = toYmd_(row[COL.EXPIRY - 1], ctx.tz);

  if (!expiry) {
    ctx.counts.errors++;
    if (oldStatus !== STATUS_ERROR) {
      ctx.log.push(logRow_(id, name, 'DATA_ERROR',
        'Expiry date is missing or not a real date ("' + row[COL.EXPIRY - 1] + '"). No reminders until it is fixed.', '', ctx.mode));
    }
    ctx.digest.push({ name: name, doc: row[COL.DOC - 1], expiry: String(row[COL.EXPIRY - 1]), days: null, status: STATUS_ERROR });
    return [STATUS_ERROR, stage, lastSent, tracked];
  }

  if (expiryChanged(tracked, expiry)) {
    ctx.log.push(logRow_(id, name, 'RENEWAL_DETECTED',
      'Expiry changed ' + tracked + ' \u2192 ' + expiry + '. Reminder history reset for the new date.', '', ctx.mode));
    stage = '';
    lastSent = '';
  }

  var daysLeft = daysBetween(ctx.todayYmd, expiry);
  var status = statusFor(daysLeft, ctx.stages);
  if (status !== oldStatus) {
    ctx.log.push(logRow_(id, name, 'STATUS_CHANGE', (oldStatus || '(new)') + ' \u2192 ' + status, '', ctx.mode));
  }

  var action = nextAction(daysLeft, stage, lastSent, ctx.todayYmd, ctx.stages, ctx.repeatDays);
  if (action) {
    var result = notify_(action, row, daysLeft, expiry, ctx);
    var event = action.type === 'REMIND' ? 'REMIND_' + action.stage : action.type;
    ctx.log.push(logRow_(id, name, event, result.details, result.to, ctx.mode));
    if (result.ok) ctx.counts.notices++;
    // LOG_ONLY is a preview: it never advances reminder history, so switching to TEST/LIVE later still sends.
    if (result.ok && ctx.mode !== 'LOG_ONLY') {
      stage = action.stage;
      lastSent = ctx.todayYmd;
    }
  }

  if (status !== STATUS_OK) {
    ctx.digest.push({ name: name, doc: row[COL.DOC - 1], expiry: expiry, days: daysLeft, status: status });
  }
  return [status, stage, lastSent, expiry];
}

/**
 * Sends (or, in LOG_ONLY mode, just describes) one notice.
 * REMIND goes to the owner. ESCALATE and OVERDUE_REPEAT go to owner + manager.
 * If the owner has no email, the manager gets it instead and the log says so.
 */
function notify_(action, row, daysLeft, expiry, ctx) {
  var owner = String(row[COL.OWNER - 1] || '').trim();
  var manager = String(row[COL.MANAGER - 1] || '').trim();
  var name = row[COL.NAME - 1], doc = row[COL.DOC - 1];
  var business = ctx.settings['Business name'] || 'Compliance Tracker';
  var note = '';

  var recipients = action.type === 'REMIND' ? [owner] : [owner, manager];
  if (!owner && manager && recipients.indexOf(manager) === -1) recipients.push(manager);
  if (!owner) note = ' (no owner email on file, sent to manager instead)';
  recipients = recipients.filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  if (!recipients.length) {
    return { ok: false, to: '', details: 'NOT SENT: no owner or manager email on file.' };
  }

  var when = daysLeft > 0 ? 'expires in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's')
    : daysLeft === 0 ? 'expires TODAY' : 'expired ' + (-daysLeft) + ' day' + (daysLeft === -1 ? '' : 's') + ' ago';
  var prefix = { REMIND: 'Reminder', ESCALATE: 'ACTION NEEDED', OVERDUE_REPEAT: 'STILL OVERDUE' }[action.type];
  var subject = prefix + ': ' + doc + ' for ' + name + ' ' + when + ' (' + expiry + ')';
  var htmlBody = emailHtml_(action.type, name, doc, expiry, when, business, row[COL.DEPT - 1]);

  if (ctx.mode === 'LOG_ONLY') {
    return { ok: true, to: recipients.join(', '), details: 'Would send: "' + subject + '"' + note };
  }

  var to = recipients.join(',');
  if (ctx.mode === 'TEST') {
    var tester = String(ctx.settings['Test recipient'] || '').trim() || Session.getEffectiveUser().getEmail();
    subject = '[TEST \u2192 ' + recipients.join(', ') + '] ' + subject;
    to = tester;
  } else if (ctx.mode !== 'LIVE') {
    return { ok: false, to: '', details: 'NOT SENT: unknown Mode "' + ctx.mode + '". Use LOG_ONLY, TEST or LIVE.' };
  }

  if (MailApp.getRemainingDailyQuota() < 1) {
    return { ok: false, to: to, details: 'NOT SENT: daily email quota used up. Will retry tomorrow.' };
  }
  MailApp.sendEmail({ to: to, subject: subject, htmlBody: htmlBody, name: business + ' Compliance' });
  return { ok: true, to: to, details: 'Sent: "' + subject + '"' + note };
}

function emailHtml_(type, name, doc, expiry, when, business, dept) {
  var color = type === 'REMIND' ? '#b45f06' : '#cc0000';
  var ask = type === 'REMIND'
    ? 'Please renew it before it expires, then send the new copy to your manager so the tracker can be updated.'
    : 'This item is past due. Please renew it right away. If it is an employee card or certification, ' +
      'the employee may not be able to work that role until it is renewed.';
  return '<div style="font-family:Arial,sans-serif;max-width:560px">' +
    '<h2 style="color:' + color + ';margin:0 0 12px">' + esc_(doc) + ' ' + esc_(when) + '</h2>' +
    '<table style="border-collapse:collapse;font-size:14px">' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Name</td><td><b>' + esc_(name) + '</b></td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Document</td><td>' + esc_(doc) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Department</td><td>' + esc_(dept) + '</td></tr>' +
    '<tr><td style="padding:4px 12px 4px 0;color:#666">Expiry date</td><td><b>' + esc_(expiry) + '</b></td></tr>' +
    '</table><p style="font-size:14px">' + ask + '</p>' +
    '<p style="font-size:12px;color:#999">Sent automatically by the ' + esc_(business) + ' compliance tracker.</p></div>';
}

/** One summary email of everything that needs attention (skipped if no digest address is set). */
function sendDigest_(items, settings, mode, todayYmd, log) {
  var to = String(settings['Daily digest to'] || '').trim();
  if (!to || !items.length) return;
  items.sort(function (a, b) {
    return (a.days === null ? 9999 : a.days) - (b.days === null ? 9999 : b.days);
  });
  var overdue = items.filter(function (i) { return i.status === STATUS_OVERDUE; }).length;
  var subject = 'Compliance digest ' + todayYmd + ': ' + overdue + ' overdue, ' + items.length + ' need attention';
  var rows = items.map(function (i) {
    var c = i.status === STATUS_OVERDUE || i.status === STATUS_TODAY ? '#cc0000' : i.status === STATUS_ERROR ? '#674ea7' : '#b45f06';
    return '<tr><td style="padding:4px 10px">' + esc_(i.name) + '</td><td style="padding:4px 10px">' + esc_(i.doc) +
      '</td><td style="padding:4px 10px">' + esc_(i.expiry) + '</td><td style="padding:4px 10px;color:' + c + '"><b>' +
      esc_(i.status) + '</b></td></tr>';
  }).join('');
  var html = '<div style="font-family:Arial,sans-serif"><h2>' + esc_(subject) + '</h2>' +
    '<table style="border-collapse:collapse;font-size:13px"><tr style="background:#eee"><th align="left" style="padding:4px 10px">Name</th>' +
    '<th align="left" style="padding:4px 10px">Document</th><th align="left" style="padding:4px 10px">Expiry</th>' +
    '<th align="left" style="padding:4px 10px">Status</th></tr>' + rows + '</table></div>';

  if (mode === 'LOG_ONLY') {
    log.push(logRow_('', '', 'DIGEST', 'Would send digest: "' + subject + '"', to, mode));
    return;
  }
  var dest = to;
  if (mode === 'TEST') {
    dest = String(settings['Test recipient'] || '').trim() || Session.getEffectiveUser().getEmail();
    subject = '[TEST \u2192 ' + to + '] ' + subject;
  }
  try {
    MailApp.sendEmail({ to: dest, subject: subject, htmlBody: html, name: (settings['Business name'] || '') + ' Compliance' });
    log.push(logRow_('', '', 'DIGEST', 'Sent: "' + subject + '"', dest, mode));
  } catch (err) {
    log.push(logRow_('', '', 'ERROR', 'Digest not sent: ' + err.message, dest, mode));
  }
}

/** Menu action: record a renewal for the selected Tracker row. */
function markSelectedRenewed() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  var sheet = ss.getActiveSheet();
  if (sheet.getName() !== SHEETS.TRACKER) { ui.alert('Click any cell in the row you want to renew on the Tracker tab, then try again.'); return; }
  var r = sheet.getActiveRange().getRow();
  if (r < 2 || r > sheet.getLastRow()) { ui.alert('Select a row with an item in it.'); return; }
  var row = sheet.getRange(r, 1, 1, TRACKER_HEADERS.length).getValues()[0];
  var resp = ui.prompt('Mark renewed',
    row[COL.DOC - 1] + ' for ' + row[COL.NAME - 1] + '\n\nNew expiry date (YYYY-MM-DD):', ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var ymd = resp.getResponseText().trim();
  var tz = ss.getSpreadsheetTimeZone();
  var todayYmd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  if (!isValidYmd(ymd)) { ui.alert('"' + ymd + '" isn\'t a valid date. Use YYYY-MM-DD, for example 2027-03-31.'); return; }
  if (daysBetween(todayYmd, ymd) <= 0) { ui.alert('The new expiry date has to be in the future.'); return; }

  var oldExpiry = toYmd_(row[COL.EXPIRY - 1], tz) || String(row[COL.EXPIRY - 1]);
  var stages = parseStages(getSettings_()['Reminder days']);
  var status = statusFor(daysBetween(todayYmd, ymd), stages);
  sheet.getRange(r, COL.EXPIRY).setValue(ymd);
  sheet.getRange(r, COL.STATUS, 1, 4).setValues([[status, '', '', ymd]]);
  var who = Session.getActiveUser().getEmail() || 'unknown user';
  appendLog_([logRow_(row[COL.ID - 1], row[COL.NAME - 1], 'RENEWED',
    'Renewed by ' + who + ': ' + oldExpiry + ' \u2192 ' + ymd + '. Status now ' + status + '.', '', 'MANUAL')]);
  ss.toast(row[COL.NAME - 1] + ' is now ' + status, 'Renewal recorded', 6);
}

/** Menu action: run the check automatically every morning. */
function installDailyTrigger() {
  removeTriggers_();
  var settings = getSettings_();
  var hour = Math.min(23, Math.max(0, parseInt(settings['Daily run hour'], 10) || 7));
  ScriptApp.newTrigger('runDailyCheck').timeBased().everyDays(1).atHour(hour)
    .inTimezone(SpreadsheetApp.getActive().getSpreadsheetTimeZone()).create();
  var mode = String(settings['Mode'] || 'LOG_ONLY');
  var modeNote = {
    LIVE: 'LIVE: real owners and managers WILL be emailed.',
    TEST: 'TEST: every email goes to you, never to the people on the list.',
    LOG_ONLY: 'LOG_ONLY: nothing is emailed, and the same "would send" lines will be logged every day. Switch to TEST or LIVE for a real daily run.'
  }[mode] || mode;
  SpreadsheetApp.getUi().alert('Daily check is on',
    'It will run every day around ' + hour + ':00 (' + SpreadsheetApp.getActive().getSpreadsheetTimeZone() + ').\n\n' +
    'Current mode: ' + modeNote,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function removeTriggers() {
  var n = removeTriggers_();
  SpreadsheetApp.getActive().toast(n ? 'Daily check turned off.' : 'The daily check was not on.', 'Compliance Tracker', 5);
}

/** Deletes the daily-check timer(s); returns how many were removed. */
function removeTriggers_() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runDailyCheck') { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

// ---- helpers ----

/** Reads a sheet cell (Date or text) as YYYY-MM-DD, or '' if it isn't a real date. */
function toYmd_(value, tz) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  if (typeof value === 'string' && isValidYmd(value.trim())) return value.trim();
  return '';
}

function logRow_(id, name, event, details, to, mode) {
  return [new Date(), id || '', name || '', event, details, to || '', mode || ''];
}

function appendLog_(rows) {
  if (!rows.length) return;
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.LOG);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADERS.length).setValues(rows);
}

function getSettings_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) {
    SETTINGS_ROWS.forEach(function (r) { map[r[0]] = r[1]; });
    return map;
  }
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[0]) map[String(r[0]).trim()] = r[1];
  });
  return map;
}

function setSetting_(key, value) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(SHEETS.SETTINGS);
  if (!sheet) return;
  var keys = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function (r) { return r[0]; });
  var i = keys.indexOf(key);
  if (i >= 0) sheet.getRange(i + 1, 2).setValue(value);
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
