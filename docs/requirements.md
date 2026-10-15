# Requirements: Compliance & Expiration Tracker

## The problem
A hotel or restaurant has to keep dozens of documents current: employee food-handler cards, liquor-server and ServSafe certifications, CPR cards, I-9 reverification dates, vendor certificates of insurance (COIs), and the property's own liquor license and health permit.

Today they usually live in one manager's spreadsheet, or in their head. Nobody gets told until something has already expired. Then:
- An employee works a role they're not certified for, which is a citation risk at a health or liquor inspection.
- A vendor works on site with lapsed insurance, so the property carries the risk if someone gets hurt.
- An I-9 reverification is missed, which is a federal compliance problem.
- During an audit, nobody can show *when* people were reminded.

## Who uses it
| Person | What they need |
|---|---|
| **HR or compliance coordinator** (main user) | One list of everything that expires, what's overdue, and proof that reminders went out. |
| **Department managers** (kitchen, bar, front desk, purchasing) | To hear about their team's lapses *before* the shift is affected, not after. |
| **Employees and vendor contacts** | A clear, early heads-up with the date and what to do. |
| **GM or auditor** | A one-glance compliance % and a record they can trust. |

## How it's done today (assumed for a ~100-employee property)
- About 150 tracked items (100+ staff certifications, ~25 vendor COIs, a handful of permits).
- A coordinator scans the spreadsheet weekly (~45 min) and writes reminder emails by hand (~10/week × 5 min).
- **About 95 minutes a week, roughly 80 hours a year**, and lapses still slip through when that person is busy or on vacation.

## What it must do
1. Keep every item in one sheet: person or vendor, document, expiry date, owner email, manager email.
2. Check every item automatically once a day, with no one having to remember.
3. Remind the owner at **30, 14 and 3 days** before expiry (adjustable).
4. On the expiry day, **escalate to the manager**; while still overdue, repeat every **7 days** (adjustable).
5. Never send the same reminder twice, even if the check runs several times a day.
6. When a date is renewed, start the reminder cycle over for the new date, automatically or with a "Mark renewed" button.
7. Flag bad data (missing or impossible dates, missing emails) instead of failing silently or crashing.
8. Keep an **audit log** of every reminder, escalation, status change, renewal and error.
9. Show a **dashboard**: % compliant, overdue count, due this week and month, breakdown by document type, and action lists.
10. Be safe to try: a **preview mode** that sends nothing, and a **test mode** that sends everything only to the person testing it.

## Out of scope (for v1)
- Storing the actual document scans (only dates and status).
- Integration with an HR system (Workday, ADP). Items are entered or pasted into the sheet.
- Text-message reminders.

## Definition of done
- All automated tests pass (22 tests: date math, every status boundary, reminder sequencing, email routing, error cases).
- The manual test plan passes in a real Google Sheet ([test-plan.md](test-plan.md)).
- A non-technical person can set it up from the README in under 10 minutes.
