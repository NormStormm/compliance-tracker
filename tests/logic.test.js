// Unit tests for apps-script/Logic.gs. Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const L = require(path.join(__dirname, '..', 'apps-script', 'Logic.gs'));

const STAGES = [30, 14, 3];
const TODAY = '2026-10-14';

test('dates: valid, invalid and arithmetic', () => {
  assert.equal(L.isValidYmd('2026-10-14'), true);
  assert.equal(L.isValidYmd('2028-02-29'), true);   // leap day
  assert.equal(L.isValidYmd('2026-02-30'), false);  // no Feb 30
  assert.equal(L.isValidYmd('2026-13-01'), false);
  assert.equal(L.isValidYmd('10/14/2026'), false);
  assert.equal(L.isValidYmd(''), false);
  assert.equal(L.isValidYmd(null), false);
  assert.equal(L.daysBetween('2026-10-14', '2026-10-15'), 1);
  assert.equal(L.daysBetween('2026-10-14', '2026-10-14'), 0);
  assert.equal(L.daysBetween('2026-10-14', '2026-09-23'), -21);
  assert.equal(L.daysBetween('2026-12-31', '2027-01-01'), 1);   // year boundary
  assert.equal(L.addDays('2026-10-14', 30), '2026-11-13');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
});

test('reminder-days setting parses messy input', () => {
  assert.deepEqual(L.parseStages('30,14,3'), [30, 14, 3]);
  assert.deepEqual(L.parseStages('3, 30 14'), [30, 14, 3]);
  assert.deepEqual(L.parseStages('60,30,30,7'), [60, 30, 7]);
  assert.deepEqual(L.parseStages(''), [30, 14, 3]);
  assert.deepEqual(L.parseStages('abc'), [30, 14, 3]);
  assert.deepEqual(L.parseStages(null), [30, 14, 3]);
  assert.deepEqual(L.parseStages(30), [30]);
});

test('status at every boundary', () => {
  const cases = [
    [-21, 'OVERDUE'], [-1, 'OVERDUE'], [0, 'EXPIRES TODAY'],
    [1, 'DUE ≤3 DAYS'], [3, 'DUE ≤3 DAYS'], [4, 'DUE ≤14 DAYS'], [14, 'DUE ≤14 DAYS'],
    [15, 'DUE ≤30 DAYS'], [30, 'DUE ≤30 DAYS'], [31, 'OK'], [365, 'OK'],
    [null, 'DATA ERROR'], [NaN, 'DATA ERROR'],
  ];
  for (const [days, want] of cases) assert.equal(L.statusFor(days, STAGES), want, `daysLeft=${days}`);
});

test('dashboard status list is ordered most urgent first', () => {
  assert.deepEqual(L.statusLabels(STAGES),
    ['OVERDUE', 'EXPIRES TODAY', 'DUE ≤3 DAYS', 'DUE ≤14 DAYS', 'DUE ≤30 DAYS', 'OK', 'DATA ERROR']);
});

test('item added late gets only the tightest reminder', () => {
  assert.deepEqual(L.nextAction(5, '', '', TODAY, STAGES, 7), { type: 'REMIND', stage: '14' });
  assert.deepEqual(L.nextAction(2, '', '', TODAY, STAGES, 7), { type: 'REMIND', stage: '3' });
  assert.deepEqual(L.nextAction(-10, '', '', TODAY, STAGES, 7), { type: 'ESCALATE', stage: 'ESCALATED' });
});

test('no duplicate reminders for a stage already sent', () => {
  assert.equal(L.nextAction(29, '30', '2026-10-13', TODAY, STAGES, 7), null);
  assert.equal(L.nextAction(10, '14', '2026-10-10', TODAY, STAGES, 7), null);
  assert.equal(L.nextAction(10, 14, '2026-10-10', TODAY, STAGES, 7), null); // numeric cell value
  assert.equal(L.nextAction(40, '', '', TODAY, STAGES, 7), null);            // nothing due yet
});

test('overdue repeats every N days, never when N = 0', () => {
  assert.equal(L.nextAction(-3, 'ESCALATED', '2026-10-11', TODAY, STAGES, 7), null);
  assert.deepEqual(L.nextAction(-7, 'ESCALATED', '2026-10-07', TODAY, STAGES, 7), { type: 'OVERDUE_REPEAT', stage: 'ESCALATED' });
  assert.equal(L.nextAction(-30, 'ESCALATED', '2026-09-01', TODAY, STAGES, 0), null);
  assert.equal(L.nextAction(-30, 'ESCALATED', '', TODAY, STAGES, 7), null); // no date on file → don't spam
});

test('unreadable date never triggers a send', () => {
  assert.equal(L.nextAction(null, '', '', TODAY, STAGES, 7), null);
});

test('renewal detection', () => {
  assert.equal(L.expiryChanged('2026-10-20', '2027-10-20'), true);
  assert.equal(L.expiryChanged('2026-10-20', '2026-10-20'), false);
  assert.equal(L.expiryChanged('', '2026-10-20'), false); // first time seen
});

// Run the daily check for 60 straight days on one item and check the full notice sequence.
function simulate({ expiry, start, days, stages = STAGES, repeat = 7, renewOn = null, renewTo = null }) {
  let stage = '', lastSent = '', tracked = '', exp = expiry;
  const events = [];
  for (let i = 0; i < days; i++) {
    const today = L.addDays(start, i);
    if (renewOn === today) exp = renewTo;
    if (L.expiryChanged(tracked, exp)) { stage = ''; lastSent = ''; events.push([today, 'RENEWAL_DETECTED']); }
    tracked = exp;
    const dl = L.daysBetween(today, exp);
    const a = L.nextAction(dl, stage, lastSent, today, stages, repeat);
    if (a) { events.push([today, a.type === 'REMIND' ? `REMIND_${a.stage}` : a.type, dl]); stage = a.stage; lastSent = today; }
  }
  return events;
}

test('timeline: 30/14/3 reminders, escalation on expiry day, weekly repeats', () => {
  const ev = simulate({ expiry: '2026-11-30', start: '2026-10-01', days: 75 });
  assert.deepEqual(ev, [
    ['2026-10-31', 'REMIND_30', 30],
    ['2026-11-16', 'REMIND_14', 14],
    ['2026-11-27', 'REMIND_3', 3],
    ['2026-11-30', 'ESCALATE', 0],
    ['2026-12-07', 'OVERDUE_REPEAT', -7],
    ['2026-12-14', 'OVERDUE_REPEAT', -14],
  ]);
});

test('timeline: renewal mid-cycle resets reminders for the new date', () => {
  const ev = simulate({ expiry: '2026-11-10', start: '2026-10-01', days: 45, renewOn: '2026-11-05', renewTo: '2027-11-10' });
  assert.deepEqual(ev.map(e => e[1]), ['REMIND_30', 'REMIND_14', 'RENEWAL_DETECTED']);
});

test('timeline: custom stages 60/7', () => {
  const ev = simulate({ expiry: '2026-12-31', start: '2026-10-01', days: 92, stages: L.parseStages('60, 7'), repeat: 0 });
  assert.deepEqual(ev.map(e => e[1]), ['REMIND_60', 'REMIND_7', 'ESCALATE']);
});
