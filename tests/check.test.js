// Tests the per-row check (checkRow_ + notify_ in Main.gs) with fake Google services,
// so email routing and the LOG_ONLY / TEST / LIVE modes can be verified without a spreadsheet.
// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadScripts() {
  const sent = [];
  const ctx = {
    console,
    Utilities: { formatDate: (d, tz, fmt) => d.toISOString().slice(0, 10) }, // tests use UTC dates
    MailApp: { sendEmail: (o) => sent.push(o), getRemainingDailyQuota: () => 100 },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'me@example.com' }) },
  };
  vm.createContext(ctx);
  for (const f of ['Logic.gs', 'Setup.gs', 'Main.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  }
  return { g: ctx, sent };
}

// Builds a Tracker row (14 columns) in sheet order.
function row({ id = 'EMP-1', name = 'Test Person', doc = 'Food Handler Card', expiry, owner = 'owner@example.com',
  manager = 'mgr@example.com', status = '', stage = '', lastSent = '', tracked = '' }) {
  return [id, name, 'Employee', doc, 'Kitchen', expiry, owner, manager, '', status, stage, lastSent, tracked, ''];
}

function run(g, r, mode, extra = {}) {
  const ctx = { tz: 'UTC', todayYmd: '2026-10-14', stages: [30, 14, 3], repeatDays: 7, mode,
    settings: { 'Business name': 'Demo Hotel', 'Test recipient': '', ...extra }, log: [], digest: [],
    counts: { checked: 0, notices: 0, errors: 0 } };
  const out = g.checkRow_(r, ctx);
  return { out, ctx };
}

test('LOG_ONLY: logs what would be sent, sends nothing, keeps reminder history unchanged', () => {
  const { g, sent } = loadScripts();
  const { out, ctx } = run(g, row({ expiry: '2026-10-24' }), 'LOG_ONLY');
  assert.equal(sent.length, 0);
  assert.deepEqual(Array.from(out), ['DUE ≤14 DAYS', '', '', '2026-10-24']);
  const ev = ctx.log.map((l) => l[3]);
  assert.deepEqual(ev, ['STATUS_CHANGE', 'REMIND_14']);
  assert.match(ctx.log[1][4], /^Would send/);
});

test('TEST: email goes only to the tester, subject names the real recipient', () => {
  const { g, sent } = loadScripts();
  const { out } = run(g, row({ expiry: '2026-10-24' }), 'TEST');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].subject, /^\[TEST → owner@example\.com\] Reminder: Food Handler Card/);
  assert.equal(out[1], '14');
  assert.equal(out[2], '2026-10-14');
});

test('TEST: custom test recipient is respected', () => {
  const { g, sent } = loadScripts();
  run(g, row({ expiry: '2026-10-24' }), 'TEST', { 'Test recipient': 'reviewer@example.com' });
  assert.equal(sent[0].to, 'reviewer@example.com');
});

test('LIVE: reminder goes to owner only; escalation goes to owner + manager', () => {
  const { g, sent } = loadScripts();
  run(g, row({ expiry: '2026-10-24' }), 'LIVE');
  assert.equal(sent[0].to, 'owner@example.com');
  run(g, row({ expiry: '2026-10-14' }), 'LIVE');
  assert.equal(sent[1].to, 'owner@example.com,mgr@example.com');
  assert.match(sent[1].subject, /^ACTION NEEDED: .* expires TODAY/);
});

test('no owner email: reminder falls back to the manager and says so', () => {
  const { g, sent } = loadScripts();
  const { ctx } = run(g, row({ expiry: '2026-10-20', owner: '' }), 'LIVE');
  assert.equal(sent[0].to, 'mgr@example.com');
  assert.match(ctx.log.at(-1)[4], /no owner email on file/);
});

test('no emails at all: nothing sent, history not advanced, so it retries tomorrow', () => {
  const { g, sent } = loadScripts();
  const { out, ctx } = run(g, row({ expiry: '2026-10-20', owner: '', manager: '' }), 'LIVE');
  assert.equal(sent.length, 0);
  assert.equal(out[1], '');
  assert.match(ctx.log.at(-1)[4], /^NOT SENT/);
});

test('bad date: DATA ERROR, logged once, never emails', () => {
  const { g, sent } = loadScripts();
  const first = run(g, row({ expiry: '2026-02-30' }), 'LIVE');
  assert.equal(first.out[0], 'DATA ERROR');
  assert.equal(first.ctx.log[0][3], 'DATA_ERROR');
  const again = run(g, row({ expiry: '2026-02-30', status: 'DATA ERROR' }), 'LIVE');
  assert.equal(again.ctx.log.length, 0); // not re-logged every day
  assert.equal(sent.length, 0);
});

test('already-sent stage is not sent again on a re-run', () => {
  const { g, sent } = loadScripts();
  const { ctx } = run(g, row({ expiry: '2026-10-24', status: 'DUE ≤14 DAYS', stage: '14', lastSent: '2026-10-13', tracked: '2026-10-24' }), 'LIVE');
  assert.equal(sent.length, 0);
  assert.equal(ctx.log.length, 0);
});

test('renewed date is detected and reminder history resets', () => {
  const { g, sent } = loadScripts();
  const { out, ctx } = run(g, row({ expiry: '2027-10-24', status: 'OVERDUE', stage: 'ESCALATED', lastSent: '2026-10-10', tracked: '2026-10-01' }), 'LIVE');
  assert.equal(ctx.log[0][3], 'RENEWAL_DETECTED');
  assert.deepEqual(Array.from(out), ['OK', '', '', '2027-10-24']);
  assert.equal(sent.length, 0);
});

test('names with HTML characters are escaped in the email', () => {
  const { g, sent } = loadScripts();
  run(g, row({ expiry: '2026-10-24', name: '<script>Bob & Co</script>' }), 'LIVE');
  assert.ok(!sent[0].htmlBody.includes('<script>'));
  assert.ok(sent[0].htmlBody.includes('&lt;script&gt;Bob &amp; Co'));
});
