# Runbook: Compliance & Expiration Tracker

How to operate the tracker day to day, and what to do when something goes wrong.

## Daily operation (nothing to do)
- The check runs automatically each morning (default 7:00 am, Hawaii time) once **Compliance Tracker → Turn on daily check** has been used.
- Each run: updates every Status, sends any reminders or escalations that are due, adds rows to the **Audit Log**, and updates **Settings → Last run** and **Last run summary**.
- If **Daily digest to** is filled in, that address gets one summary email listing everything that needs attention.

## Common tasks

| Task | How |
|---|---|
| Add a person, vendor or permit | Add a row on **Tracker**: fill columns A–H (ID, name, type, document, department, expiry date, owner email, manager email). Leave the grey columns alone. It gets picked up at the next check. |
| Record a renewal | Click the row → **Compliance Tracker → Mark selected row renewed…** → type the new date (YYYY-MM-DD). This logs who renewed it and resets reminders. *(Editing the Expiry Date cell directly also works; the next check detects the change and logs `RENEWAL_DETECTED`.)* |
| Check right now | **Compliance Tracker → Run check now.** Safe to run any number of times; reminders never repeat. |
| Change reminder timing | **Settings → Reminder days** (e.g. `60, 30, 7`), then **Compliance Tracker → Rebuild dashboard**. |
| Stop all emails immediately | **Settings → Mode = LOG_ONLY**, or **Compliance Tracker → Turn off daily check**. |
| Go live | Test first in **TEST** mode (all emails go to you). When they look right, set **Mode = LIVE**. |

## Modes
| Mode | Emails go to | Reminder history updated? | Use it for |
|---|---|---|---|
| `LOG_ONLY` | Nobody (the Audit Log says "Would send…") | No | Previewing. Safe default. |
| `TEST` | You, or **Test recipient**. The subject shows who it *would* have gone to. | Yes | Checking the emails and the full cycle. |
| `LIVE` | Real owners, plus managers for escalations | Yes | Real use. |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Row shows **DATA ERROR** (purple) | Expiry date is blank, typed as text, or impossible (e.g. Feb 30) | Re-enter it as a real date (YYYY-MM-DD). The next check clears the error. No emails are sent for that row until it's fixed. |
| Audit Log says **"no owner email on file"** | Owner Email is blank | The reminder went to the manager instead. Add the owner's email. |
| Audit Log says **NOT SENT: no owner or manager email** | Both emails blank | Add at least a manager email. It retries every day until fixed. |
| Audit Log says **NOT SENT: daily email quota** | Google's daily sending limit was reached (about 100/day on free Gmail accounts) | Nothing is lost; unsent reminders go out on the next run. For large lists, use a Google Workspace account (higher limit) or turn on the digest instead of individual emails. |
| **Status didn't change** after editing a date | The check hasn't run since | **Run check now.** (Days Left updates instantly; Status updates on each check.) |
| Expected a reminder but none was sent | That stage was already sent (see Reminder Stage column), or Mode is LOG_ONLY | Check the Audit Log for the item ID. |
| "Another check is already running" | Two runs overlapped (timer + manual click) | Wait a minute and try again. The lock exists to prevent double emails. |
| Error rows in the Audit Log with event **ERROR** | An unexpected problem with that row | Read the Details column. The rest of the list was still processed. |
| Menu missing | Script not authorized yet, or the page wasn't reloaded after setup | Reload the spreadsheet tab. If it's still missing, open **Extensions → Apps Script** and run `onOpen` once. |

## Rules for the Tracker tab
- **Never delete Audit Log rows.** They are the compliance record.
- Don't edit the grey columns (Status, Reminder Stage, Last Reminder Sent). The script owns them.
- Removing someone (they left): delete their row on Tracker. The Audit Log keeps their history.
