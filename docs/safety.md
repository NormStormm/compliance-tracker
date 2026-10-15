# Safety & data handling

- **Demo data is fake.** All names, companies and emails are made up. Email addresses use `example.com`, a domain reserved for examples that never delivers mail. No real employer, employee, guest or vendor data was used to build or demo this.
- **Minimal data.** The tracker stores names, document types, dates and work emails, not the documents themselves, ID numbers or immigration details. For I-9 items it tracks only the *reverification date*.
- **Safe by default.** New installs start in `LOG_ONLY` mode (nothing is emailed). `TEST` mode sends every email only to the person testing. Real people are emailed only after someone deliberately switches to `LIVE`.
- **Least access.** The script can only open the spreadsheet it's attached to, not the rest of your Drive.
- **No outside services.** No AI or third-party API sees the data; everything stays in Google Sheets and Gmail.
- **Audit trail.** Every notice, escalation, renewal and error is logged with a timestamp, and renewals record who made them.
- **No secrets in code.** There are no API keys or passwords anywhere in this project.
