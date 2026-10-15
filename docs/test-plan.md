# Test plan: Compliance & Expiration Tracker

Two layers: **automated tests** that run on a laptop in under a second, and a **manual checklist** run once in a real Google Sheet.

## 1. Automated tests (22 tests, all passing)

Run: `npm test` (or `node --test tests/logic.test.js tests/check.test.js`)

| # | Area | What's checked |
|---|---|---|
| 1 | Dates | Valid and invalid dates (Feb 30, month 13, wrong format, blank); day math across month and year boundaries |
| 2 | Settings | "Reminder days" parses messy input (`3, 30 14`, duplicates, blanks, letters fall back to 30/14/3) |
| 3 | Status | Correct label at every boundary: −21, −1, 0, 1, 3, 4, 14, 15, 30, 31, 365 days, unreadable |
| 4 | Dashboard | Status list ordered most-urgent first |
| 5 | Late items | Item added with 5 days left gets **only** the 14-day reminder, not all three at once |
| 6 | No duplicates | Re-running the check never re-sends a stage already sent |
| 7 | Overdue repeats | Repeat every 7 days; never when set to 0; never with a missing last-sent date |
| 8 | Bad data | Unreadable date never sends anything |
| 9 | Renewals | Changed expiry date is detected |
| 10 | **Timeline** | 75 simulated days: reminders at 30, 14 and 3 days, escalation on expiry day, repeats at +7 and +14. Nothing else. |
| 11 | **Timeline** | Renewal mid-cycle resets reminders; no stale escalation afterward |
| 12 | **Timeline** | Custom 60/7 schedule with repeats off |
| 13 | LOG_ONLY | Logs "Would send", sends 0 emails, does **not** advance reminder history |
| 14 | TEST | Email goes only to the tester; subject shows the real intended recipient |
| 15 | TEST | Custom test recipient respected |
| 16 | LIVE | Reminders go to the owner only; escalations go to owner + manager |
| 17 | Missing owner | Falls back to the manager and logs it |
| 18 | No emails | Nothing sent, history not advanced (retries next day), logged as NOT SENT |
| 19 | Bad date | DATA ERROR status, logged once (not every day), never emails |
| 20 | Re-run | Already-sent stage produces no email and no log noise |
| 21 | Renewal | Overdue item renewed → status OK, history cleared, no email |
| 22 | Security | Names with HTML characters are escaped in emails |

## 2. Manual checklist (real Google Sheet)

Run once after setup. Write the date and Pass/Fail in the last column.

| # | Step | Expected result | Result |
|---|---|---|---|
| M1 | Run **First-time setup** | 4 tabs created; 24 demo rows; dashboard filled; "Tracker ready" pop-up; no emails received || Pass 2026-10-14 |
| M2 | Open **Audit Log** | STATUS_CHANGE rows for every item, "Would send…" rows for due items, one DATA_ERROR for Chris Domingo, mode LOG_ONLY || Pass 2026-10-14 |
| M3 | Check **Tracker** colors | Overdue rows red, due-soon orange/yellow, OK green, EMP-017 purple (DATA ERROR) || Pass 2026-10-14 |
| M4 | Check **Dashboard** | Compliant % shown; overdue list shows Leilani Kahale, Island Pest Control and Marcus Tanaka; pie chart colors match || Pass 2026-10-14 (after fix #2 below) |
| M5 | Set Mode = **TEST**, **Run check now** | Emails arrive in **your** inbox only, each subject starting `[TEST → real address]`; toast shows the count || Pass 2026-10-14 |
| M6 | **Run check now** again | **No new emails**; Audit Log has no new REMIND rows | |
| M7 | Open one escalation email | Correct name, document, date; red "ACTION NEEDED"; addressed (in subject) to owner + manager || Pass 2026-10-14 |
| M8 | Lani Oshiro row (no owner email) | Audit Log notes the fallback to the manager | |
| M9 | Fix Chris Domingo's date to a real date ~10 days out, **Run check now** | Status becomes DUE ≤14 DAYS; a REMIND_14 is sent; purple row goes away || Pass 2026-10-14 |
| M10 | Select Leilani Kahale → **Mark selected row renewed…** → a date 1 year out | Status OK, grey columns cleared, RENEWED row in the Audit Log with your email || Pass 2026-10-14 |
| M11 | Type an invalid date in Mark renewed (e.g. `2027-02-30`) | Friendly error; nothing changed | |
| M12 | Edit an Expiry Date cell directly to a later date, **Run check now** | RENEWAL_DETECTED logged; reminders reset | |
| M13 | Set **Daily digest to** = your email, **Run check now** | One digest email listing items sorted by urgency | |
| M14 | **Turn on daily check** | Confirmation pop-up with time and mode; trigger visible under Extensions → Apps Script → Triggers | |
| M15 | Next morning | Settings → Last run shows today ~7am, summary says `[timer]` | |
| M16 | **Turn off daily check** | Toast confirms; trigger gone | |
| M17 | Change **Reminder days** to `60, 7`, **Rebuild dashboard** | Status table shows DUE ≤7 / DUE ≤60 rows; Tracker statuses update on next check | |

## 3. Issues found in live testing (and fixed)

Testing in a real Google Sheet caught four problems the automated tests couldn't:

| # | Found | Cause | Fix |
|---|---|---|---|
| 1 | Status labels showed garbled characters (`DUE ,â§3 DAYS`) instead of `DUE ≤3 DAYS` | The `≤`, `→` and `·` symbols were corrupted when the code was copied into the Apps Script editor | Script files are now plain ASCII; special symbols are written as `\u` escape codes, so copying can't corrupt them |
| 2 | Donut chart ignored the status colors (OVERDUE was blue) | Google Sheets charts ignore the per-slice color option | Switched to an ordered color list; OVERDUE now red, OK green, etc. |
| 3 | "Reminders (30 days)" showed 25 although only TEST emails had been sent | The count included LOG_ONLY preview lines | Dashboard now counts only emails actually sent (Audit Log details beginning "Sent") |
| 4 | First setup run "completed" but built nothing | The editor's function dropdown defaulted to `onOpen`, not `setupTracker` | Setup instructions now say to pick `setupTracker` first, or use the menu's First-time setup |

Also noted for users: in Google Sheets, **Cmd+R is "fill right"**, not reload. Reload with the browser's ↻ button.
