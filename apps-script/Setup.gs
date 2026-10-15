/**
 * Setup.gs: builds the spreadsheet: tabs, formatting, the demo data and
 * the dashboard. Run "First-time setup" once from the Compliance Tracker menu
 * (or run setupTracker() in the editor).
 */

var SHEETS = { DASH: 'Dashboard', TRACKER: 'Tracker', LOG: 'Audit Log', SETTINGS: 'Settings' };

var TRACKER_HEADERS = ['ID', 'Person / Vendor', 'Type', 'Document', 'Department', 'Expiry Date',
  'Owner Email', 'Manager Email', 'Days Left', 'Status', 'Reminder Stage', 'Last Reminder Sent',
  'Tracked Expiry', 'Notes'];
var COL = { ID: 1, NAME: 2, KIND: 3, DOC: 4, DEPT: 5, EXPIRY: 6, OWNER: 7, MANAGER: 8,
  DAYS: 9, STATUS: 10, STAGE: 11, LAST_SENT: 12, TRACKED: 13, NOTES: 14 };

var LOG_HEADERS = ['Timestamp', 'Item ID', 'Person / Vendor', 'Event', 'Details', 'Sent To', 'Mode'];

var DOC_TYPES = ['Food Handler Card', 'Liquor Server Certification', 'ServSafe Manager Certification',
  'CPR / First Aid', 'I-9 Reverification', 'Certificate of Insurance', 'Business License / Permit',
  'Liquor License', 'Health Department Permit'];
var ITEM_TYPES = ['Employee', 'Vendor', 'Property'];

var SETTINGS_ROWS = [
  ['Mode', 'LOG_ONLY', 'LOG_ONLY = record what would be sent, send nothing. TEST = send every email to the test recipient. LIVE = email real owners and managers.'],
  ['Reminder days', '30, 14, 3', 'Days before expiry to remind the owner. Run "Rebuild dashboard" after changing.'],
  ['Overdue repeat (days)', 7, 'After the expiry-day escalation, re-notify owner + manager every N days while overdue. 0 = never.'],
  ['Daily digest to', '', 'Optional: one email address that gets a daily summary of everything needing attention.'],
  ['Test recipient', '', 'Where TEST-mode emails go. Leave blank to use your own address.'],
  ['Business name', 'Kaimana Bay Hotel (demo)', 'Shown in email subject lines and signatures.'],
  ['Daily run hour', 7, 'Hour of the day (0\u201323) for the automatic check, once you turn it on.'],
  ['Last run', '', 'Filled in automatically.'],
  ['Last run summary', '', 'Filled in automatically.']
];

/** Menu shown every time the spreadsheet opens. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Compliance Tracker')
    .addItem('Run check now', 'runCheckFromMenu')
    .addItem('Mark selected row renewed\u2026', 'markSelectedRenewed')
    .addSeparator()
    .addItem('Turn on daily check', 'installDailyTrigger')
    .addItem('Turn off daily check', 'removeTriggers')
    .addSeparator()
    .addItem('Rebuild dashboard', 'buildDashboard')
    .addItem('Reset demo data', 'resetDemoData')
    .addItem('First-time setup (rebuilds everything)', 'setupTracker')
    .addToUi();
}

function setupTracker() {
  var ss = SpreadsheetApp.getActive();
  var ui = SpreadsheetApp.getUi();
  if (ss.getSheetByName(SHEETS.TRACKER)) {
    var ok = ui.alert('Rebuild the tracker?',
      'This wipes the Tracker, Dashboard, Audit Log and Settings tabs and loads demo data.',
      ui.ButtonSet.OK_CANCEL);
    if (ok !== ui.Button.OK) return;
  }
  var dash = freshSheet_(SHEETS.DASH, 0);
  var tracker = freshSheet_(SHEETS.TRACKER, 1);
  var log = freshSheet_(SHEETS.LOG, 2);
  var settings = freshSheet_(SHEETS.SETTINGS, 3);

  buildSettings_(settings);
  buildTracker_(tracker);
  buildLog_(log);
  loadDemoRows_(tracker);
  buildDashboard();

  var blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0) ss.deleteSheet(blank);

  runCheck_({ source: 'setup' });
  ss.setActiveSheet(dash);
  ui.alert('Tracker ready',
    'Demo data loaded and a first check ran in LOG_ONLY (preview) mode, so nothing was emailed.\n\n' +
    '1. Reload this browser tab to see the "Compliance Tracker" menu.\n' +
    '2. Open the Audit Log tab to see what would have been sent.\n' +
    '3. To test real emails, set Mode to TEST on the Settings tab (every email goes to you), ' +
    'then choose Compliance Tracker \u2192 Run check now.',
    ui.ButtonSet.OK);
}

/** Returns an empty sheet with this name, creating it if needed. */
function freshSheet_(name, index) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name, index);
  sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
  sheet.clear();
  sheet.clearConditionalFormatRules();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.setFrozenRows(0);
  sheet.setFrozenColumns(0);
  ss.setActiveSheet(sheet);
  ss.moveActiveSheet(index + 1);
  return sheet;
}

function buildSettings_(sheet) {
  var rows = [['Setting', 'Value', 'What it does']].concat(SETTINGS_ROWS);
  sheet.getRange(1, 1, rows.length, 3).setValues(rows);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff');
  sheet.getRange(2, 1, SETTINGS_ROWS.length, 1).setFontWeight('bold');
  sheet.getRange(2, 2, SETTINGS_ROWS.length, 1).setBackground('#fff8e1');
  sheet.getRange(2, 2).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['LOG_ONLY', 'TEST', 'LIVE'], true).setAllowInvalid(false).build());
  var lastRunRow = SETTINGS_ROWS.map(function (r) { return r[0]; }).indexOf('Last run') + 2;
  sheet.getRange(lastRunRow, 2).setNumberFormat('yyyy-mm-dd h:mm am/pm');
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 620);
  sheet.setFrozenRows(1);
}

function buildTracker_(sheet) {
  sheet.getRange(1, 1, 1, TRACKER_HEADERS.length).setValues([TRACKER_HEADERS])
    .setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff').setWrap(true);
  // Days Left is a live formula so it is always current, even between checks.
  sheet.getRange(1, COL.DAYS).setFormula(
    '={"Days Left";ARRAYFORMULA(IF(F2:F="","",IF(ISNUMBER(F2:F),F2:F-TODAY(),"bad date")))}');
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);

  var n = sheet.getMaxRows() - 1;
  sheet.getRange(2, COL.EXPIRY, n, 1).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, COL.LAST_SENT, n, 2).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(2, COL.DAYS, n, 1).setNumberFormat('0').setHorizontalAlignment('center');

  var dv = SpreadsheetApp.newDataValidation;
  sheet.getRange(2, COL.KIND, n, 1).setDataValidation(dv().requireValueInList(ITEM_TYPES, true).setAllowInvalid(true).build());
  sheet.getRange(2, COL.DOC, n, 1).setDataValidation(dv().requireValueInList(DOC_TYPES, true).setAllowInvalid(true).build());
  sheet.getRange(2, COL.EXPIRY, n, 1).setDataValidation(dv().requireDate().setAllowInvalid(true)
    .setHelpText('Enter a date like 2027-03-31').build());
  sheet.getRange(2, COL.OWNER, n, 2).setDataValidation(dv().requireTextIsEmail().setAllowInvalid(true).build());

  // Status, stage, last sent and tracked expiry are written by the script. Shade them so people leave them alone.
  sheet.getRange(1, COL.STATUS, 1, 4).setBackground('#3d5a73');
  sheet.getRange(2, COL.STATUS, n, 4).setBackground('#f3f3f3');
  sheet.getRange(1, COL.STATUS).setNote('Set by the daily check. Do not edit; change the Expiry Date instead.');
  sheet.hideColumns(COL.TRACKED);

  var widths = [80, 190, 80, 210, 130, 100, 210, 190, 70, 130, 90, 110, 100, 260];
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  applyStatusColors_(sheet);
}

/** Color-codes the Status column and tints whole rows that are overdue or unreadable. */
function applyStatusColors_(sheet) {
  var stages = parseStages(getSettings_()['Reminder days']);
  var asc = stages.slice().sort(function (a, b) { return a - b; });
  var statusRange = sheet.getRange('J2:J');
  var rowRange = sheet.getRange('A2:N');
  var rule = SpreadsheetApp.newConditionalFormatRule;
  var dueColors = ['#f6b26b', '#ffe599', '#fff2cc', '#fff2cc', '#fff2cc'];
  var rules = [
    rule().whenTextEqualTo(STATUS_OVERDUE).setBackground('#cc0000').setFontColor('#ffffff').setBold(true).setRanges([statusRange]).build(),
    rule().whenTextEqualTo(STATUS_TODAY).setBackground('#e06666').setFontColor('#ffffff').setBold(true).setRanges([statusRange]).build(),
    rule().whenTextEqualTo(STATUS_ERROR).setBackground('#8e7cc3').setFontColor('#ffffff').setRanges([statusRange]).build(),
    rule().whenTextEqualTo(STATUS_OK).setBackground('#b6d7a8').setRanges([statusRange]).build()
  ];
  asc.forEach(function (s, i) {
    rules.push(rule().whenTextEqualTo(dueLabel(s)).setBackground(dueColors[Math.min(i, dueColors.length - 1)])
      .setRanges([statusRange]).build());
  });
  rules.push(rule().whenFormulaSatisfied('=$J2="' + STATUS_OVERDUE + '"').setBackground('#f4cccc').setRanges([rowRange]).build());
  rules.push(rule().whenFormulaSatisfied('=$J2="' + STATUS_ERROR + '"').setBackground('#d9d2e9').setRanges([rowRange]).build());
  sheet.setConditionalFormatRules(rules);
}

function buildLog_(sheet) {
  sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setFontWeight('bold').setBackground('#1f3b57').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  sheet.getRange('A2:A').setNumberFormat('yyyy-mm-dd h:mm am/pm');
  [150, 80, 190, 150, 460, 230, 80].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.getRange(1, 1).setNote('Every reminder, escalation, status change and error is recorded here. Never edit or delete rows: this is the audit trail.');
}

/**
 * Fake employees, vendors and permits. Expiry dates are relative to today,
 * so the demo always shows a realistic mix: some overdue, some due soon,
 * some fine, plus two rows broken on purpose to show error handling.
 */
function demoRows_(todayYmd) {
  var e = 'Employee', v = 'Vendor', p = 'Property';
  var d = function (n) { return addDays(todayYmd, n); };
  return [
    ['EMP-001', 'Leilani Kahale', e, 'Food Handler Card', 'Kitchen', d(-21), 'leilani.k@example.com', 'kitchen.mgr@example.com', ''],
    ['EMP-002', 'Marcus Tanaka', e, 'Liquor Server Certification', 'Bar', d(-3), 'marcus.t@example.com', 'bar.mgr@example.com', ''],
    ['EMP-003', 'Keoni Alapai', e, 'Food Handler Card', 'Banquets', d(0), 'keoni.a@example.com', 'banquets.mgr@example.com', ''],
    ['EMP-004', 'Grace Nakamura', e, 'I-9 Reverification', 'Housekeeping', d(2), 'grace.n@example.com', 'hr@example.com', 'Work authorization document expiring'],
    ['EMP-005', 'Daniel Reyes', e, 'CPR / First Aid', 'Pool & Recreation', d(3), 'daniel.r@example.com', 'rec.mgr@example.com', ''],
    ['EMP-006', 'Malia Kekumu', e, 'Food Handler Card', 'Kitchen', d(6), 'malia.k@example.com', 'kitchen.mgr@example.com', ''],
    ['EMP-007', 'Ryan Fujimoto', e, 'Liquor Server Certification', 'Bar', d(11), 'ryan.f@example.com', 'bar.mgr@example.com', ''],
    ['EMP-008', 'Ana Lopez', e, 'Food Handler Card', 'Banquets', d(14), 'ana.l@example.com', 'banquets.mgr@example.com', ''],
    ['EMP-009', 'Kai Mahoe', e, 'ServSafe Manager Certification', 'Kitchen', d(16), 'kai.m@example.com', 'kitchen.mgr@example.com', ''],
    ['EMP-010', 'Sarah Kim', e, 'Liquor Server Certification', 'Restaurant', d(25), 'sarah.k@example.com', 'restaurant.mgr@example.com', ''],
    ['EMP-011', 'Noah Silva', e, 'I-9 Reverification', 'Front Desk', d(30), 'noah.s@example.com', 'hr@example.com', ''],
    ['EMP-012', 'Hina Watanabe', e, 'Food Handler Card', 'Kitchen', d(31), 'hina.w@example.com', 'kitchen.mgr@example.com', ''],
    ['EMP-013', 'Jason Pua', e, 'CPR / First Aid', 'Pool & Recreation', d(58), 'jason.p@example.com', 'rec.mgr@example.com', ''],
    ['EMP-014', 'Mei Ching', e, 'Food Handler Card', 'Restaurant', d(120), 'mei.c@example.com', 'restaurant.mgr@example.com', ''],
    ['EMP-015', 'Tyler Akana', e, 'Liquor Server Certification', 'Bar', d(240), 'tyler.a@example.com', 'bar.mgr@example.com', ''],
    ['EMP-016', 'Lani Oshiro', e, 'Food Handler Card', 'Kitchen', d(9), '', 'kitchen.mgr@example.com', 'No email on file, on purpose: the reminder should fall back to the manager'],
    ['EMP-017', 'Chris Domingo', e, 'ServSafe Manager Certification', 'Restaurant', '2026-02-30', 'chris.d@example.com', 'restaurant.mgr@example.com', 'Impossible date on purpose: should show DATA ERROR, never send'],
    ['VEN-001', 'Island Pest Control LLC', v, 'Certificate of Insurance', 'Vendors', d(-8), 'certs@islandpest.example.com', 'purchasing@example.com', 'Vendor must not work on site with a lapsed COI'],
    ['VEN-002', 'Aloha Linen Supply', v, 'Certificate of Insurance', 'Vendors', d(12), 'office@alohalinen.example.com', 'purchasing@example.com', ''],
    ['VEN-003', 'Kona Coast Produce', v, 'Business License / Permit', 'Vendors', d(27), 'admin@konacoast.example.com', 'purchasing@example.com', ''],
    ['VEN-004', 'Pacific Elevator Services', v, 'Certificate of Insurance', 'Vendors', d(75), 'service@pacelevator.example.com', 'purchasing@example.com', ''],
    ['VEN-005', 'Mauka Plumbing Co.', v, 'Certificate of Insurance', 'Vendors', d(1), 'billing@maukaplumbing.example.com', 'purchasing@example.com', ''],
    ['PRM-001', 'Kaimana Bay Hotel', p, 'Liquor License', 'Management', d(44), 'compliance@example.com', 'gm@example.com', 'Renewal filed with the liquor commission?'],
    ['PRM-002', 'Kaimana Bay Hotel', p, 'Health Department Permit', 'Management', d(200), 'compliance@example.com', 'gm@example.com', '']
  ];
}

function loadDemoRows_(sheet) {
  var tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  var rows = demoRows_(Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'));
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, TRACKER_HEADERS.length).clearContent();
  sheet.getRange(1, COL.DAYS).setFormula(
    '={"Days Left";ARRAYFORMULA(IF(F2:F="","",IF(ISNUMBER(F2:F),F2:F-TODAY(),"bad date")))}');
  // Columns A-H, then Notes (N). Days Left (I) is the formula; J-M are written by the check.
  sheet.getRange(2, 1, rows.length, 8).setValues(rows.map(function (r) { return r.slice(0, 8); }));
  sheet.getRange(2, COL.NOTES, rows.length, 1).setValues(rows.map(function (r) { return [r[8]]; }));
}

function resetDemoData() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset demo data?', 'Reloads the sample rows and clears the Audit Log.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  var ss = SpreadsheetApp.getActive();
  loadDemoRows_(ss.getSheetByName(SHEETS.TRACKER));
  var log = ss.getSheetByName(SHEETS.LOG);
  if (log.getLastRow() > 1) log.getRange(2, 1, log.getLastRow() - 1, LOG_HEADERS.length).clearContent();
  var r = runCheck_({ source: 'reset' });
  ss.toast(r.summary, 'Demo data reset', 8);
}

/** Dashboard: headline numbers, status chart, breakdown by document, and two action lists. */
function buildDashboard() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SHEETS.DASH) || ss.insertSheet(SHEETS.DASH, 0);
  sheet.getCharts().forEach(function (c) { sheet.removeChart(c); });
  sheet.clear();
  var stages = parseStages(getSettings_()['Reminder days']);
  var labels = statusLabels(stages);
  var T = 'Tracker!';

  sheet.getRange('A1').setValue('Compliance & Expiration Dashboard').setFontSize(18).setFontWeight('bold');
  sheet.getRange('A2').setFormula('="Last check: "&IFERROR(TEXT(VLOOKUP("Last run",Settings!A:B,2,FALSE),"yyyy-mm-dd h:mm am/pm"),"never")&"   \u00b7   Mode: "&IFERROR(VLOOKUP("Mode",Settings!A:B,2,FALSE),"?")');
  sheet.getRange('A2').setFontColor('#666666');

  // Headline numbers
  var kpis = [
    ['Items tracked', '=COUNTA(' + T + 'A2:A)', '0'],
    ['Compliant', '=IF(A5=0,0,(A5-COUNTIF(' + T + 'J2:J,"' + STATUS_OVERDUE + '")-COUNTIF(' + T + 'J2:J,"' + STATUS_ERROR + '"))/A5)', '0%'],
    ['Overdue', '=COUNTIF(' + T + 'J2:J,"' + STATUS_OVERDUE + '")', '0'],
    ['Due in 7 days', '=COUNTIFS(' + T + 'I2:I,">=0",' + T + 'I2:I,"<=7")', '0'],
    ['Due in 30 days', '=COUNTIFS(' + T + 'I2:I,">=0",' + T + 'I2:I,"<=30")', '0'],
    ['Data errors', '=COUNTIF(' + T + 'J2:J,"' + STATUS_ERROR + '")', '0'],
    // Only count emails actually sent (Details starts "Sent"), not LOG_ONLY previews or NOT SENT failures.
    ['Reminders sent (30 days)', '=COUNTIFS(\'Audit Log\'!A2:A,">="&(TODAY()-30),\'Audit Log\'!D2:D,"REMIND*",\'Audit Log\'!E2:E,"Sent*")', '0'],
    ['Escalations sent (30 days)', '=COUNTIFS(\'Audit Log\'!A2:A,">="&(TODAY()-30),\'Audit Log\'!D2:D,"ESCALATE",\'Audit Log\'!E2:E,"Sent*")+COUNTIFS(\'Audit Log\'!A2:A,">="&(TODAY()-30),\'Audit Log\'!D2:D,"OVERDUE_REPEAT",\'Audit Log\'!E2:E,"Sent*")', '0']
  ];
  kpis.forEach(function (k, i) {
    sheet.getRange(4, i + 1).setValue(k[0]);
    sheet.getRange(5, i + 1).setFormula(k[1]).setNumberFormat(k[2]);
  });
  sheet.getRange(4, 1, 1, kpis.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f3b57').setWrap(true).setHorizontalAlignment('center');
  sheet.getRange(5, 1, 1, kpis.length).setFontSize(20).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#eef3f8');
  sheet.getRange(5, 3).setFontColor('#cc0000');
  sheet.getRange(5, 6).setFontColor('#674ea7');

  // Status breakdown (feeds the pie chart)
  var top = 8;
  sheet.getRange(top, 1, 1, 2).setValues([['Status', 'Count']]).setFontWeight('bold').setBackground('#d9e2ec');
  labels.forEach(function (lab, i) {
    sheet.getRange(top + 1 + i, 1).setValue(lab);
    sheet.getRange(top + 1 + i, 2).setFormula('=COUNTIF(' + T + 'J2:J,A' + (top + 1 + i) + ')');
  });
  var colors = { 'OVERDUE': '#cc0000', 'EXPIRES TODAY': '#e06666', 'OK': '#6aa84f', 'DATA ERROR': '#8e7cc3' };
  var dueShades = ['#f6b26b', '#ffd966', '#ffe599', '#fff2cc', '#fff2cc'];
  var dueIndex = 0;
  // One color per row of the status table, in order (Sheets charts ignore the per-slice "slices" option).
  var sliceColors = labels.map(function (lab) {
    return colors[lab] || dueShades[Math.min(dueIndex++, dueShades.length - 1)];
  });
  sheet.insertChart(sheet.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(sheet.getRange(top, 1, labels.length + 1, 2))
    .setNumHeaders(1)
    .setOption('title', 'Items by status')
    .setOption('pieHole', 0.4)
    .setOption('colors', sliceColors)
    .setOption('legend', { position: 'right' })
    .setPosition(top, 3, 10, 0)
    .setOption('width', 420).setOption('height', 260)
    .build());

  // By document type
  var dTop = top + labels.length + 9;
  sheet.getRange(dTop, 1, 1, 5).setValues([['Document', 'Total', 'Overdue', 'Due \u226430 days', 'OK']])
    .setFontWeight('bold').setBackground('#d9e2ec');
  DOC_TYPES.forEach(function (doc, i) {
    var r = dTop + 1 + i, a = '$A' + r;
    sheet.getRange(r, 1).setValue(doc);
    sheet.getRange(r, 2, 1, 4).setFormulas([[
      '=COUNTIF(' + T + 'D2:D,' + a + ')',
      '=COUNTIFS(' + T + 'D2:D,' + a + ',' + T + 'J2:J,"' + STATUS_OVERDUE + '")',
      '=COUNTIFS(' + T + 'D2:D,' + a + ',' + T + 'I2:I,">=0",' + T + 'I2:I,"<=30")',
      '=COUNTIFS(' + T + 'D2:D,' + a + ',' + T + 'J2:J,"' + STATUS_OK + '")'
    ]]);
  });

  // Action lists
  var listHeader = ['Person / Vendor', 'Document', 'Expiry', 'Days'];
  var src = '{' + T + 'B2:B,' + T + 'D2:D,' + T + 'F2:F,' + T + 'I2:I}';
  sheet.getRange(top - 1, 10).setValue('Overdue now').setFontWeight('bold').setFontColor('#cc0000');
  sheet.getRange(top, 10, 1, 4).setValues([listHeader]).setFontWeight('bold').setBackground('#f4cccc');
  sheet.getRange(top + 1, 10).setFormula('=IFERROR(SORT(FILTER(' + src + ',' + T + 'J2:J="' + STATUS_OVERDUE + '"),4,TRUE),"None overdue")');
  sheet.getRange(top - 1, 15).setValue('Due in the next 30 days').setFontWeight('bold').setFontColor('#b45f06');
  sheet.getRange(top, 15, 1, 4).setValues([listHeader]).setFontWeight('bold').setBackground('#fce5cd');
  sheet.getRange(top + 1, 15).setFormula('=IFERROR(SORT(FILTER(' + src + ',ISNUMBER(' + T + 'I2:I),' + T + 'I2:I>=0,' + T + 'I2:I<=30),4,TRUE),"Nothing due in 30 days")');
  sheet.getRange('L:L').setNumberFormat('yyyy-mm-dd');
  sheet.getRange('Q:Q').setNumberFormat('yyyy-mm-dd');

  [150, 95, 95, 95, 95, 95, 105, 115, 20, 190, 200, 90, 50, 20, 190, 200, 90, 50]
    .forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setFrozenRows(5);
}
