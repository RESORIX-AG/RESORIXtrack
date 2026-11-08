# Swiss law: what RESORIXtrack checks and keeps

RESORIXtrack is built for employers in Switzerland. It helps meet the record-keeping duties and limits of the
Labour Act (ArG) and its Ordinance 1 (ArGV 1), the Code of Obligations (OR) and the Data Protection Act (revDSG,
in force since 1 September 2023). It is a tool, not legal advice: the employer stays responsible, permits (night,
Sunday work) are not managed by the software, and collective agreements (GAV/CCT) may set stricter rules that
the settings let you configure.

The rule engine is `src/server/services/compliance.ts`. It is pure (data in → findings out), runs on the same
day/week figures the accounts use, and never blocks recording: people must be able to record what actually
happened. Findings are shown where they are relevant (day row, week summary, team overview, compliance report)
with the legal reference, and can be exported for the labour inspectorate.

## Recording duties (ArG Art. 46, ArGV 1 Art. 73)

The employer must keep, for at least **five years** after they lapse (Art. 73 para. 2):
personal data · daily and weekly working time actually worked incl. compensatory and overtime work, with its
start and end · breaks of 30 minutes or more with start and end · weekly rest and compensatory rest days ·
night and Sunday work · deviations under permits.

- Time entries store start and end instants (µs, UTC); days are counted in the person's timezone (set by the
  employer, dated like the other terms below); breaks are the gaps between entries.
- Nothing is ever hard-deleted inside the retention period: deletes are soft (`is_deleted`), every change is a
  revision (who, when, what, why), signed-off months are sealed.
- `users.recording_mode`:
  - `full` (default) – start/end/breaks as above.
  - `simplified` (Art. 73b – by agreement with the employee representatives or, in companies under 50 people,
    individually): only the **daily total** must be recorded; night/Sunday work still with start and end.
    The UI then offers a daily total entry instead of start/end.
  - `waived` (Art. 73a – CBA, gross income > CHF 120 000 incl. bonuses, wide autonomy, written consent): no
    duty to record; the person may still record voluntarily; compliance checks are not run for them.
- `users.arg_exempt` (senior executive, Art. 3 lit. d ArG): the ArG does not apply to the person, so no compliance
  checks run for them (default off).
- **Retention**: anonymisation/deletion of a former employee (revDSG) is refused until
  `employment_end + retention_years` (setting `retention_years`, minimum 5, default 5; 10 years recommended if
  the records also serve as payroll vouchers, OR 958f). Data exports remain available until then.

## Checks (findings)

Severity: **violation** (a legal limit was exceeded), **warning** (close to a limit / needs justification),
**info**. Each finding: `{ rule, severity, date|week|year, value, limit, ref }`, `ref` like "ArG Art. 15".

| Rule key | Check | Reference |
|---|---|---|
| `break_min` | A working day with > 5½ h work needs ≥ 15 min break, > 7 h ≥ 30 min, > 9 h ≥ 60 min. 15 and 30 min count in one piece; 60 min may be split into pieces of at least 15 min. Enforced at clock-in when `break_enforcement` is on | ArG Art. 15, ArGV 1 Art. 18 |
| `break_stretch` | More than 5½ h of work before or after a break needs a break of its own (pieces of at least 15 min count as breaks) | ArGV 1 Art. 18 |
| `daily_rest` | ≥ 11 consecutive hours of rest between two working days (once a week down to 8 h if the 2-week average is 11 h → warning, below 8 h → violation). Enforced at clock-in when `break_enforcement` is on | ArG Art. 15a |
| `day_span` | Day and evening work (incl. breaks) within a span of 14 h | ArG Art. 10 para. 3 |
| `night_work` | Work between 23:00 and 06:00 (needs a permit; warning so HR can verify) | ArG Art. 16/17 |
| `sunday_work` | Work between Saturday 23:00 and Sunday 23:00, on 1 August and on full-day public holidays of the person's calendar (holidays = Sundays) | ArG Art. 18, 20a |
| `compensatory_rest` | Sunday/holiday work over 5 h without a rest day (24 h, a scheduled working day without work or leave) in the 7 days before or after → violation once that window has passed; up to 5 h → info: equal time off within 4 weeks | ArG Art. 20 |
| `weekly_max` | Weekly work above the legal maximum `users.legal_weekly_max_hours` (45 or 50 h) → that excess is *Überzeit* | ArG Art. 9 |
| `overtime_daily` | More than 2 h Überzeit on one day | ArG Art. 12 para. 2 |
| `overtime_yearly` | Überzeit per calendar year above 170 h (45-h staff) / 140 h (50-h staff); warning at 80 % | ArG Art. 12 para. 2 |
| `consecutive_days` | More than 6 consecutive working days (weekly rest day missing) | ArG Art. 18–21 |
| `vacation_minimum` | Yearly entitlement below 4 weeks (5 weeks until age 20 when `birth_date` is known), pro-rated by scheduled working days | OR 329a |
| `vacation_block` | Informational: no block of ≥ 2 consecutive weeks of vacation planned/taken in the year by 1 October | OR 329c |

Settings:
- `compliance_enabled` (default true): the company is subject to the ArG. Exempt are e.g. public administrations,
  agriculture and private households (Art. 2 ArG); off runs no checks.
- Breaks (`break_min`, Art. 15) are a legal minimum and always checked when the ArG applies. The former
  `break_rules_enabled` setting is retired and ignored.
- `break_enforcement` (default true): a clock-in is refused until the minimum break for the time worked so far
  today and the daily rest after the previous working day are complete (`409 break_required` / `rest_required`
  with `earliest`, the instant from which clocking in is allowed). Only clock-ins are blocked: a manual entry
  stays possible and gets the usual finding.
- `weekly_max_minutes`: company default for new people, 45 h (2700) or 50 h (3000) only; per person
  `legal_weekly_max_hours` (Art. 9). 45 h: industry, office, technical and other employees, sales staff in large
  retail; 50 h: all others, e.g. construction, trades, small retail.
- `night_work_permitted`, `sunday_work_permitted` (Art. 17, 19): a permit exists, those findings become info.
- `holiday_work_surcharge_percent` (default 50 %) and `holiday_work_surcharge_mode` (`payroll` or `time_credit`),
  see below; `retention_years`.

Overtime terms (shown in the UI with these names):
- **Mehrarbeit / Überstunden** (OR 321c): time beyond the *contractual* target – the time balance.
- **Überzeit** (ArG Art. 12/13): time beyond the *legal* weekly maximum – counted separately per year; must be
  compensated with 25 % surcharge or time off (for office/technical staff only beyond 60 h per year).

## Sunday, public holiday and night work (Sonntags-, Feiertags- und Nachtarbeit)

| Situation | Law | RESORIXtrack |
|---|---|---|
| Public holidays | Equal to Sundays: 1 August (federal), up to 8 cantonal days (Art. 20a) | Holiday calendars from Swiss presets; 1 August marked federal |
| Temporary Sunday/holiday work | 50 % wage supplement, paid as money (Art. 19 para. 3) | `payroll` (default): hours and percentage in the timesheet and balances exports; `time_credit`: the percentage of the work in the Sunday and holiday windows is credited as time (GAV) |
| Regular Sunday work | No ArG supplement (Art. 19 para. 2) | Reported hours only; the percentage applies company-wide, payroll decides |
| Compensatory rest | ≤ 5 h: equal time off within 4 weeks; > 5 h: 24 h rest day on a working day in the week before or after (Art. 20) | `compensatory_rest` finding |
| Temporary night work (23:00–06:00) | 25 % wage supplement (Art. 17b para. 1) | Night hours in the exports |
| Regular night work | 10 % time compensation (Art. 17b para. 2) | Per person *Regular night work*: 10 % of night minutes credited as time (own credit in day and account) |
| Überzeit | 25 % supplement or time off (Art. 13) | Überzeit tally, see above |

- Windows: Sunday work is Saturday 23:00 to Sunday 23:00; holiday work 23:00 the evening before to 23:00 on the holiday
  (half days from 12:00); minutes on a holiday that is a Sunday count once, as holiday work. Night work 23:00 to 06:00.
- None of this applies to `arg_exempt` people (no time credits); the night credit also needs `compliance_enabled`.
- Settings that change figures (`compliance_enabled`, permits, surcharge, holiday mode, full-time hours) apply from a
  date (`setting_versions`), and so do a person's terms (team, holiday calendar, timezone, vacation days, `legal_weekly_max_hours`,
  `recording_mode`, `arg_exempt`, regular night work; `user_terms_history`). Each day is checked with the values of
  that day; nothing is ever applied before the last signed-off day (services and database guards).

## How the rules are applied

- Entries with gaps under 3 h form one working block; a block belongs to the day it starts (a night shift is one day).
- Daily rest: under 8 h is a violation; 8 to 11 h is a warning once per ISO week and a violation the second time.
- Überzeit is assigned cumulatively within the week. The 2 h per day limit ignores work-free weekdays (Mon to Sat).
- `weekly_max` is a warning (Überzeit is legal within limits); `overtime_yearly` warns from 80 % of the limit.
- Sunday work: Saturday 23:00 to Sunday 23:00, 1 August and full-day public holidays.
- `simplified` recording skips break, rest and day-span checks; `waived` and `arg_exempt` run no checks.
- Überzeit uses the legal maximum of each week; the yearly limit the one at the end of the year.
- A sick day after part of the day's work credits only what the schedule still lacks, never more than the day.
- Entitlement: vacation days per year (full-time, 5-day week) × scheduled days per week / 5 × employed share of the
  year, rounded up to the next half day.
- Minimum vacation: 4 weeks × scheduled days per week × employed share of the year; 5 weeks up to and including the
  year the person turns 20. `vacation_block` (info) is checked from 1 October: a run of 14 days or more of vacation and
  free days.

## Data protection (revDSG, OR 328b)

- **Purpose limitation (OR 328b)**: only data needed for the employment relationship. No location tracking, no
  behaviour monitoring (ArGV 3 Art. 26). The login log keeps IP and user agent for security only, deleted after
  `login_log_retention_days`.
- **Sensitive data** (health – Art. 5 lit. c revDSG): sick leave is visible to the person, their leads and HR
  only; team calendars show "absent" without the reason; doctor's notes are attachments with the same access
  rule and are never shown in lists or notifications.
- **Right of access / portability** (Art. 25, 28): self-service JSON export of all personal data under
  Profile → "Download my data"; administrators can export for a person.
- **Erasure**: anonymisation of former employees after the retention period (see above): name, email and personal
  fields are replaced, also in the person's own change-log snapshots (the only permitted change to the log); sessions,
  credentials, passkeys, API keys, notifications, sign-in log and documents are deleted. Time records stay, without
  identity, as long as the employer must keep them (ArGV 1 Art. 73). Free-text notes on entries and absences stay
  with them, and sealed sign-off snapshots keep the name they were sealed with (never shown); review notes before
  anonymising if they may name the person.
- **Information** (Art. 19): a privacy notice page (`/privacy`, editable text in Settings) linked from the
  sign-in page and the profile.
- **Security** (Art. 8): Argon2id, 2FA (optional or enforced), encrypted backups, server-side sessions, CSP,
  audit trail, data stays on the company's own server (no third parties; the Have I Been Pwned check sends only a
  5-character hash prefix and can be disabled).
- **Records of processing** (Art. 12): `docs/privacy.md` contains a template the operator can adopt.
