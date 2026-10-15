/**
 * Logic.gs: the rules for statuses and reminders.
 *
 * Nothing in this file touches Google services, so it can be unit-tested
 * on a laptop with Node (see tests/logic.test.js). Dates are passed around
 * as 'YYYY-MM-DD' strings so time zones can't shift a deadline by a day.
 */

var DEFAULT_STAGES = [30, 14, 3];

var STATUS_OK = 'OK';
var STATUS_TODAY = 'EXPIRES TODAY';
var STATUS_OVERDUE = 'OVERDUE';
var STATUS_ERROR = 'DATA ERROR';
var STAGE_ESCALATED = 'ESCALATED';

/** True only for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
}

function ymdToUtc_(ymd) {
  var p = ymd.split('-').map(Number);
  return Date.UTC(p[0], p[1] - 1, p[2]);
}

/** Whole days from one date to another (positive if `toYmd` is later). */
function daysBetween(fromYmd, toYmd) {
  return Math.round((ymdToUtc_(toYmd) - ymdToUtc_(fromYmd)) / 86400000);
}

/** Date `n` days after `ymd`, as YYYY-MM-DD. */
function addDays(ymd, n) {
  var d = new Date(ymdToUtc_(ymd) + n * 86400000);
  var mm = String(d.getUTCMonth() + 1);
  var dd = String(d.getUTCDate());
  return d.getUTCFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
}

/**
 * Turns the "Reminder days" setting (e.g. "30, 14, 3") into a clean list,
 * largest first. Falls back to 30/14/3 if the setting is blank or garbled.
 */
function parseStages(text) {
  var nums = String(text == null ? '' : text)
    .split(/[,\s]+/)
    .map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return n > 0; });
  var unique = nums.filter(function (n, i) { return nums.indexOf(n) === i; });
  if (!unique.length) return DEFAULT_STAGES.slice();
  return unique.sort(function (a, b) { return b - a; });
}

/** Status label for a "Due" stage, e.g. 'DUE <=14 DAYS' (shown with the less-than-or-equal sign). */
function dueLabel(stage) {
  return 'DUE \u2264' + stage + ' DAYS';
}

/** Every status the tracker can show, most urgent first (used for the dashboard). */
function statusLabels(stages) {
  var asc = stages.slice().sort(function (a, b) { return a - b; });
  return [STATUS_OVERDUE, STATUS_TODAY]
    .concat(asc.map(dueLabel))
    .concat([STATUS_OK, STATUS_ERROR]);
}

/** Status for an item with `daysLeft` days until expiry (null = unreadable date). */
function statusFor(daysLeft, stages) {
  if (daysLeft === null || daysLeft === undefined || isNaN(daysLeft)) return STATUS_ERROR;
  if (daysLeft < 0) return STATUS_OVERDUE;
  if (daysLeft === 0) return STATUS_TODAY;
  var asc = stages.slice().sort(function (a, b) { return a - b; });
  for (var i = 0; i < asc.length; i++) {
    if (daysLeft <= asc[i]) return dueLabel(asc[i]);
  }
  return STATUS_OK;
}

/**
 * Decides whether today's check should send anything for one item.
 *
 *   daysLeft     days until expiry (0 = today, negative = already expired)
 *   lastStage    what was last sent: '30', '14', '3', 'ESCALATED', or ''
 *   lastSentYmd  date of the last notice, or ''
 *
 * Returns null (do nothing) or { type, stage }:
 *   REMIND          owner gets a heads-up; stage = the tightest threshold crossed
 *   ESCALATE        expiry day reached: owner AND manager are notified once
 *   OVERDUE_REPEAT  still expired: re-notify every `repeatDays` days
 *
 * Only the tightest threshold is ever sent, so an item added with 5 days
 * left gets the 14-day notice, not the 30 and the 14 together.
 */
function nextAction(daysLeft, lastStage, lastSentYmd, todayYmd, stages, repeatDays) {
  if (daysLeft === null || daysLeft === undefined || isNaN(daysLeft)) return null;
  var last = lastStage == null ? '' : String(lastStage).trim();

  if (daysLeft <= 0) {
    if (last !== STAGE_ESCALATED) return { type: 'ESCALATE', stage: STAGE_ESCALATED };
    if (repeatDays > 0 && isValidYmd(lastSentYmd) && daysBetween(lastSentYmd, todayYmd) >= repeatDays) {
      return { type: 'OVERDUE_REPEAT', stage: STAGE_ESCALATED };
    }
    return null;
  }

  var asc = stages.slice().sort(function (a, b) { return a - b; });
  var crossed = null;
  for (var i = 0; i < asc.length; i++) {
    if (daysLeft <= asc[i]) { crossed = asc[i]; break; }
  }
  if (crossed === null) return null;

  var lastNum = Number(last);
  if (last !== '' && !isNaN(lastNum) && lastNum <= crossed) return null; // already sent this one (or a later one)
  return { type: 'REMIND', stage: String(crossed) };
}

/** True when the expiry date was changed since reminders started, which means it was renewed or corrected. */
function expiryChanged(trackedYmd, expiryYmd) {
  return isValidYmd(trackedYmd) && trackedYmd !== expiryYmd;
}

if (typeof module !== 'undefined') {
  module.exports = {
    isValidYmd: isValidYmd, daysBetween: daysBetween, addDays: addDays, parseStages: parseStages,
    dueLabel: dueLabel, statusLabels: statusLabels, statusFor: statusFor, nextAction: nextAction,
    expiryChanged: expiryChanged, STATUS_OK: STATUS_OK, STATUS_TODAY: STATUS_TODAY,
    STATUS_OVERDUE: STATUS_OVERDUE, STATUS_ERROR: STATUS_ERROR, STAGE_ESCALATED: STAGE_ESCALATED
  };
}
