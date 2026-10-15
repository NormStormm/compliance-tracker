# Tool manifest: Compliance & Expiration Tracker

| Field | Value |
|---|---|
| **Tool** | Compliance & Expiration Tracker |
| **Version** | 1.0 (2026-10) |
| **Owner** | Norman Kau |
| **Purpose** | Remind owners before certifications, permits and vendor insurance expire; escalate lapses to managers; keep an audit trail. |
| **Runs on** | Google Sheets + Google Apps Script (V8 runtime), attached to one spreadsheet |
| **Schedule** | Daily time-based trigger (`runDailyCheck`), default 7:00 am in the spreadsheet's time zone; also on demand from the menu |
| **Users** | HR / compliance coordinator (edits), managers and owners (receive email), GM (views dashboard) |

## Inputs
| Input | Where | Notes |
|---|---|---|
| Tracked items | **Tracker** tab, columns A–H | ID, name, type, document, department, expiry date, owner email, manager email |
| Settings | **Settings** tab | Mode, reminder days, overdue repeat interval, digest address, test recipient, business name, run hour |

## Outputs
| Output | Where |
|---|---|
| Status per item | Tracker → Status (plus Days Left formula) |
| Reminder and escalation emails | Gmail, sent from the account that installed the script |
| Daily digest (optional) | Email to **Daily digest to** |
| Audit trail | **Audit Log** tab (append-only) |
| Dashboard | **Dashboard** tab: KPIs, status pie chart, by-document table, overdue and due-soon lists |
| Last run info | Settings → Last run / Last run summary |

## Code
| File | Responsibility |
|---|---|
| `Logic.gs` | Pure rules: date math, statuses, which reminder is due. No Google services, so it's unit-tested. |
| `Setup.gs` | Builds the tabs, formatting, validation, demo data, dashboard; the `onOpen` menu |
| `Main.gs` | Daily check, email sending, digest, audit log, manual renewal, triggers |
| `appsscript.json` | Time zone, runtime, permissions |
| `tests/*.test.js` | 22 automated tests (Node built-in test runner) |

## Permissions it asks for
| Permission | Why |
|---|---|
| See, edit this spreadsheet only (`spreadsheets.currentonly`) | Read items, write statuses and the log. No access to your other files. |
| Send email as you (`script.send_mail`) | Reminders and the digest |
| Manage triggers (`script.scriptapp`) | The daily timer |
| Show menus and pop-ups (`script.container.ui`) | Menu, prompts, alerts |
| See your email address (`userinfo.email`) | TEST-mode recipient; "renewed by" in the log |

## Dependencies
- A Google account (free Gmail works; about 100 emails/day limit, higher on Google Workspace)
- No outside services, no API keys, no paid tools

## Failure behavior
| Failure | What happens |
|---|---|
| One bad row (bad date, missing email, error) | That row is flagged or skipped and logged; all other rows still processed |
| Email quota reached | Not sent, logged as `NOT SENT`, retried on the next run |
| Overlapping runs | Second run is refused by a lock; no double emails |
| Script error mid-run | Statuses for that run aren't written; error appears in the Apps Script executions log; next run starts clean |
| Trigger deleted or owner leaves | Checks stop. Re-install from the menu under an active account (see runbook). |

## Known limits
- Statuses refresh on each check, not instantly when a date is edited (Days Left does update instantly).
- Built for hundreds of items, not tens of thousands (single-sheet design).
- Emails come from the installing user's account. In a real deployment, use a shared compliance mailbox account.
