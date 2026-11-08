# Administrator guide

For people with the *Administrator* role. Daily use: [user manual](user-manual.md). Installing: [installation.md](installation.md).

## Roles: who sees what

Administrators manage people, teams, settings and backups but see **no working times** of others. Time data is visible to team leads (their members) and to people with the **HR** capability (everyone). The **Projects** capability manages all projects. The first administrator from the setup wizard starts with HR and Projects; remove them once others take over. Details: [security.md](security.md#roles).

## Setting up, step by step

The dashboard shows a **Getting started** checklist (company name, public holidays, teams and leads, people, work schedules, email). Hide it when done.

1. **Working time**: Settings → Working time.
   - *Full-time hours per week*: basis for schedules and pro-rata holidays.
   - *Public holidays*: **Scheduled days** reduces the target only on a person's working day; **Pro rata** credits every Mon to Fri holiday by pensum.
   - *Vacation days per year*: default for new people; each person's own value is on their profile. Enter the full-time value for a 5-day week: fewer scheduled working days scale it (3 days a week: 3/5), and every entitlement is rounded up to the next half day.
   - Reason required for past edits, lead permissions (schedules, balances), clock-out reminder after N hours, sick self-report limits.
   - *Projects on time entries*: Off, Optional or Required. Each entry carries a project; Required blocks the sign-off while work has none. A company-wide project such as "Internal" covers everything else.
   Rules that change figures (public holidays mode, full-time hours, Swiss law settings) apply from a date: saving one asks from which day (default today, never before the last signed-off month). Earlier days keep the old rules.
2. **Swiss law**: Settings → Swiss law. *Company is subject to the ArG* (off for e.g. public administrations, agriculture, private households; Art. 2), default weekly maximum 45 or 50 h (Art. 9), night and Sunday work permits (lower those findings to notes), *Sunday/holiday surcharge* (default 50 %, Art. 19) paid as *Payroll* (listed in the timesheet and balances exports) or as *Time credit* (GAV; credited for work in the Sunday and holiday windows), retention in years (minimum 5). Breaks are always checked when the ArG applies. See [compliance.md](compliance.md).
3. **Email**: configured in `.env`; Settings → Email shows the status and sends a test.
4. **Public holidays**: Administration → Holiday calendars.
   1. *New calendar*: name it and pick the canton in the list or on the map (or none for an empty calendar). The name follows the canton until you type your own. Statutory days are always included; tick the canton's optional days the company gives (e.g. Easter Monday, Boxing Day) and its commune days (ticked by default; they do not apply in the communes listed, e.g. Murten for Corpus Christi). 1 August is marked federal, the preset's other days cantonal.
   2. *Edit calendar* changes the ticked days later. A newly ticked day is added and an unticked one removed from today on, never inside signed-off months; days you edited by hand stay.
   3. Preset calendars are topped up automatically, with the ticked days: every 1 October (and when the worker starts) the worker adds next year's holidays and notifies administrators. It only adds missing years and never touches signed-off months. Calendars without a preset get a reminder on 1 November if next year is empty. `rt install-holidays --top-up` runs it by hand.
   4. *Import* adds a preset's holidays for one year; importing again adds only missing dates.
   5. *Add* → company days with one click (24 and 31 December afternoon, Berchtoldstag where the canton does not list it, Sechseläuten afternoon in Zurich) or a custom day. Half days cover the afternoon.
   6. Every holiday change is in the audit log (*Public holiday*).
   7. Order of use: person → team → company default. Everyone sees the calendar that applies to them under *Public holidays*. Assigning another calendar (to the person, their team or the company) or moving someone to another team applies from today (for a person: from the day asked on save); earlier days keep the calendar they were counted with. A calendar that counted for days already passed cannot be deleted.
5. **Teams**: Administration → Teams. Name, colour, holiday calendar, leads and deputies (open-ended or for a period). A lead or deputy with a start date sees and changes the members' data from that day on only (entries, absences, documents, reports, history); without a start date they see all of it. A team can have several leads; a lead need not be a member. Without a lead, HR decides requests (administrators if nobody has HR).
6. **People**: Administration → Employees → *Add employee*. Name, email, role, team, language, timezone, employment start, pensum, vacation days, legal weekly maximum (45 or 50 h), time recording (full, simplified, waived; see [compliance.md](compliance.md)), *senior executive* (Art. 3 lit. d ArG: no checks), *regular night work* (Art. 17b: 10 % of night work credited as time), optional birth date (minimum vacation). *Send invitation now* emails a link valid 7 days. Then set the work schedule (Schedule tab). Times are counted and shown in the person's timezone (default: the company's); employees cannot change it. A later change of team, holiday calendar, timezone, vacation days, weekly maximum, time recording, *senior executive* or *regular night work* applies from the day asked on save (default today, after the last signed-off month); earlier days keep the old terms, listed under *Earlier*. Business trips need no change. Moving the employment start or end only checks the days that change. To employ a former employee again, *Rehire* starts a new employment period; the earlier one stays as it was.
7. **HR and Projects**: grant the capabilities on the person's Profile tab to whoever signs off months, runs company reports or answers data requests.
8. **Projects** (if projects are on): Team → Projects. Company-wide projects are created by people with the Projects capability, team projects by leads.
9. **Branding**: Settings → Company. See [customizing.md](customizing.md).
10. **Privacy notice**: Settings → Privacy. Shown at `/privacy`, linked from the sign-in page. Fill in [privacy.md](privacy.md) for your records.
11. **Backups**: copy them off the server. See [backup-restore.md](backup-restore.md).

## Month-end routine

1. Early in the month, leads open **Team → Month sign-off** for the previous month.
2. Each person shows target, worked, difference and blockers: month not over, clock running, open requests, work without a required project.
3. *Sign off* locks the month for everyone: entries with their projects, absences, adjustments. The person is notified; the timesheet PDF shows the seal.
4. HR signs off people without a lead and can sign off all teams at once; a lead is signed off by a co-lead or deputy of the team, or HR. Nobody signs off, reopens or credits their own month, HR included, unless they are the only HR person and have no lead.
5. To correct a signed month, HR *Reopens* it with a reason (logged, notified), corrects, and signs off again.

*Integrity check* on the same page (HR, administrators) verifies seals, chain, data and database guards. The worker also runs it weekly.

## Administration pages

### Employees

<p><img src="screenshots/admin-dark-admin_users.png" alt="Employees" width="760"></p>

Search, filter by team and role. A person's page has tabs:

| Tab | Contents |
|---|---|
| Profile | Contact, role, capabilities, team, contract, recording mode, language, timezone, holiday calendar |
| Schedule | Work schedule versions from a date; past months keep their targets |
| Vacation | Entitlement per year (override a single year) |
| Access | Invitation, set password, two-factor reset, remove passkeys, deactivate, data export (HR), anonymise |
| History | Change log of the person's records |

- **Deactivate**: signs out everywhere, stops the clock, removes lead roles, API keys and passkeys. Data stays; reactivation is possible.
- **Export** (HR only): everything stored about the person as JSON.
- **Anonymise**: only for deactivated people with an employment end, after `employment end + retention years`. Removes name, email, personal fields, documents, credentials, logs; time records stay without identity.
- **Offboarding**: set the employment end, sign off the last month, settle the balance (Time account → Adjust balance), download the final timesheet, deactivate; anonymise after the retention period.

### Teams

<p><img src="screenshots/admin-dark-admin_teams.png" alt="Teams" width="760"></p>

Leads and deputies with periods, members, holiday calendar. Deleting a team keeps its members' data; they have no team afterwards.

### Holiday calendars

<p><img src="screenshots/admin-dark-admin_holidays.png" alt="Holiday calendars" width="760"></p>

See step 4. Deleting a calendar in use makes teams and people fall back to the next one.

### Settings

<p><img src="screenshots/admin-dark-admin_settings.png" alt="Settings" width="760"></p>

| Tab | Contents |
|---|---|
| Company | Name, defaults for new people, logos, accent colour |
| Working time | Hours and holidays, vacation, corrections and leads, sick reports, projects |
| Swiss law | Checks, permits, retention |
| Security | Two-factor required for administrators or everyone, API keys on or off, sign-in log retention (session lengths: `.env`) |
| Privacy | Privacy notice text |
| Absence types | Which types need approval, allow documents, reduce the target or use the balance, deduct vacation; custom types |
| Email | SMTP status, test email |

### Backups and logs

<p><img src="screenshots/admin-dark-admin_backups.png" alt="Backups" width="760"></p>

- **Backups**: create, download, delete. Restore runs on the server: [backup-restore.md](backup-restore.md).
- **Audit log**: every change with who, when, before, after and why; filter by person, record and action. Older
  entries load as you scroll.
- **Sign-in log**: every attempt with result, IP and device; older attempts load as you scroll.
- **API keys**: every key with owner, scopes, last use and expiry; revoke one with a reason (the owner is notified).

### Reports

Administrators without HR see no time reports. HR sees everyone; leads see their teams. Kinds: timesheet, balances, absences, projects, time entries, labour law; PDF, XLSX, CSV.

## Server commands

See the CLI table in [installation.md](installation.md#cli).

## FAQ

| Question | Answer |
|---|---|
| A balance is far off | Check employment start, schedule versions (gaps), holiday calendar, manual adjustments. |
| Someone forgot to clock out | The dashboard warns them; they clock out and correct the end time with a reason. |
| Change a signed month | HR reopens it (logged, notified). |
| Lost phone and backup codes | Access tab → Reset two-factor. |
| No email server | Access tab → Set password; hand it over in person. |
| API access for a desktop app | The person creates an API key under Profile. See [api.md](api.md). |
