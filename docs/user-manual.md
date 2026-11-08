# User manual

For everyone who records time, plus a section for team leads. Administrators: [admin guide](admin-guide.md).

## Signing in

- The **invitation email** link is valid 7 days; you choose your password there. Expired: use *Forgot password?* or ask your administrator.
- Sign in with password, a **passkey** (after adding one in your profile) or **single sign-on** if your company uses it.
- **Keep me signed in** keeps the session for 30 days by default. Not on shared computers.
- **Forgot password?** sends a link valid 2 hours.
- On a phone, install the app from the browser menu ("Add to home screen").

## Dashboard

<p><img src="screenshots/employee-dark-home.png" alt="Dashboard" width="760"></p>

Clock, today and this week against your target, **time balance** (+ overtime, − deficit), **vacation left**, upcoming absences, labour-law findings, and a reminder when recent work has no project.

Totals of a week or month (worked, target, difference) count complete days only. Today is marked *in progress*; its time so far is shown as *+ h:mm today*.

The theme follows your device. Pick System, Light or Dark with the sun/moon button in the top bar.

### Clocking

- **Clock in**, **Clock out** (key S). A break is simply a clock-out; clock in again when it ends. The clock is on every page.
- Keys: **S** clock in or out (when no field is focused). **⌘K** / **Ctrl K** search.
- Offline: punches are stored and synced with their original time.
- **Other time**: clock in up to 48 h back, or clock out at a chosen time. A past time closes the entry there. A future time (up to 24 h after the clock-in) clocks you out automatically then: the card shows *Clocks out automatically at 17:30* with *Cancel*; *Clock out now* ends the entry earlier. Such entries are marked manual.
- Legal minimums: when your company enforces them, clocking in is refused until the minimum break (15 min after 5½ h, 30 min after 7 h, 60 min after 9 h of work) or the daily rest of 11 h is complete; the message says from when you can clock in. If you did work, add the entry under *My time*; it gets the usual finding.
- Forgot to clock out: the dashboard warns you; clock out, then fix the end time under *My time*. A reminder email follows after a set number of hours.
- **Project** (if your company uses projects): pick it before you clock in, on the dashboard (*Clock in on*) or in the top bar. Nothing is preselected: each clock-in uses up the choice. While working, picking another project switches: the running entry ends and the next one starts at the same second, so no break appears.

### Report sick

**Report sick** records today, stops a running clock and informs your lead. Attach a doctor's note later under *Absences*.

## My time

<p><img src="screenshots/employee-dark-time.png" alt="My time, week" width="760"></p>
<p><img src="screenshots/employee-dark-time_view_month.png" alt="My time, month" width="760"></p>

Week timeline or month grid with worked, target and difference per day.

- **Add entry** or click an empty part of a day: start, end, project, note.
- Click an entry to edit or delete. Edits on past days need a reason, deleting always needs one; everything is in the change history. Deleted entries can be restored.
- **Edited / manual**: entered or changed by hand. **Changed by someone else**: corrected by your lead or HR; open *History* and *Dispute* if you disagree.
- A **signed-off month** is read-only. Ask your lead or HR; HR can reopen it.
- With **simplified recording** you enter a daily total instead of start and end. Several totals per day, one per project, are added one after the other.
- Labour-law findings (short break, rest, Sunday work …) are hints, never blocks; only a clock-in can be refused when the company enforces the minimum break and daily rest. See [compliance.md](compliance.md).

Times are shown in the timezone your employer set for you (usually Europe/Zurich), also when you travel; clocking in and out records the exact moment wherever you are.

## Projects

If your company uses projects, every entry says which **project** its time was spent on. The week view shows each block in its project's colour and code; one day often reads as one block split by project.

- Switch projects with the clock (see *Clocking*) or split an entry under *My time*.
- Days before today with work but no project are marked with a dot; the dashboard links to the first one and marks the entries that need a project (*Assign* opens the first).
- **Required** mode: every work entry needs a project before the month can be signed off. Today is never flagged.
- Without exact times (2 h meeting, sometime today): only with simplified recording, as a daily total per project. Full recording keeps start and end by law (ArGV 1 Art. 73).

## Absences

<p><img src="screenshots/employee-dark-absences.png" alt="Absences" width="760"></p>

Vacation account for the year (entitlement, carried over, taken, planned) and your absences.

- **Request absence**: type, first and last day in the calendar (holidays, days off and existing absences are marked), full day, morning or afternoon, note. The preview shows working days used and vacation left.
- Requests that need approval go to your lead (or HR). You are notified of the decision.
- **Sick leave** is recorded immediately; your lead is informed. Documents (PDF, JPG, PNG, WebP, HEIC) are visible to you, your lead and HR only.
- **Cancel** a request in the absence's sheet. A new request needs approval again.
- Your lead or HR can record absences for you; you are notified.

## Public holidays

The public holidays that apply to you, year by year, and where they come from: a calendar assigned to you personally, your team's calendar or the company default. The page is read-only: on your working days the holidays reduce your target hours automatically, half-day holidays cover the afternoon. Tell your administrator if a holiday is missing.

## Time account

<p><img src="screenshots/employee-dark-account.png" alt="Time account" width="760"></p>

Opening balance, target, worked, credited (holidays, absences), adjustments and balance per month, up to yesterday. Überzeit (above the legal weekly maximum) is shown separately.

## Team calendar

Who in your team is absent when. Sick leave shows as "Absent"; notes are hidden.

## Reports

Your **timesheet** as PDF (to sign), XLSX or CSV.

## Profile

<p><img src="screenshots/employee-dark-profile.png" alt="Profile" width="760"></p>

| Section | What |
|---|---|
| Personal | Language, 24 or 12-hour time, email on corrections |
| Password | Change it; signs out other devices and revokes API keys |
| Two-factor | TOTP app (Aegis, 1Password, Microsoft Authenticator …) plus 10 backup codes. May be required by your company. |
| Passkeys | Sign in with Face ID, Touch ID, Windows Hello or a security key; no code needed |
| Single sign-on | Linked accounts; unlink |
| Signed-in devices | Sign out any device |
| Sign-in history | Your successful and failed attempts; change your password if one is unknown |
| API keys | For apps and scripts, see [api.md](api.md) |
| Download my data | Everything stored about you, as JSON |

## Notifications

The bell shows decisions, corrections, sign-offs and reminders. Most also arrive by email.

---

## For team leads

Leads, deputies during their period, and HR (for everyone) see the **Team** section.

### Team overview

<p><img src="screenshots/lead-dark-team.png" alt="Team overview" width="760"></p>

Who is in now, worked against target, findings, sign-off status, the team calendar and month balances. Your administrator names **deputies** for a period or open-ended; they get your rights while current. A deputy with a start date sees the team's data from that day on only. Click a person to open their page.

### Approvals

<p><img src="screenshots/lead-dark-team_approvals.png" alt="Approvals" width="760"></p>

Open requests with remaining vacation and who else is absent. **Approve** or **Decline** with an optional note; the person is notified. Below: upcoming absences, which you can cancel with a reason.

### A person's page

Tabs: **Time** (add, edit, delete; reason required, person notified, can dispute), **Absences** (record, mark sick, documents), **Account** (adjust balance or entitlement if allowed), **Schedule** (new versions if allowed), **Labour law** (findings), **History**.

### Projects

**Team → Projects**: create and edit your teams' projects (name, code up to 30 characters, colour, description); deactivate finished ones. They stay on past entries and in reports.

### Month sign-off

<p><img src="screenshots/lead-dark-team_signoff.png" alt="Month sign-off" width="760"></p>

1. Open the previous month. Check target, worked and difference per person; correct first if needed.
2. Blockers: month not over, clock running, open requests, work without a required project.
3. Select people and **Sign off**. The month becomes read-only for everyone.

Your own month is signed off by another lead or HR. Later corrections: HR reopens, you sign off again.

### Reports

<p><img src="screenshots/lead-dark-reports.png" alt="Reports" width="760"></p>

Timesheets, balances, absences, projects, time entries and labour law for your teams; PDF, XLSX, CSV.
