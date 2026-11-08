# Record of processing (template)

Template for the record of processing activities under Art. 12 revDSG for time recording with RESORIXtrack. Copy it, fill in the `[…]` fields, adjust what differs in your company. Companies with fewer than 250 employees are exempt unless they process sensitive data on a large scale or carry out high-risk profiling (Art. 24 DSV); keeping the record is still good practice. This is a template, not legal advice.

The privacy notice for employees (Art. 19 revDSG) is set under Settings → Privacy and shown at `/privacy`.

---

## Processing activity: working time and absence recording

| Field | Entry |
|---|---|
| Controller | [Company name, address] |
| Contact for data protection | [Name, email] |
| Data protection advisor (if any) | [Name, email] |
| System | RESORIXtrack [version], self-hosted at [server location / hosting provider] |
| Date of this record | [date] |

### Purposes

- Recording working and rest times as required by ArG Art. 46 and ArGV 1 Art. 73.
- Managing time and vacation accounts, absences and approvals (OR 321c, 329 ff.).
- Payroll input and monthly sign-off of timesheets.
- Checking compliance with working-time limits (ArG).
- [Project time recording for internal cost allocation, if projects are used.]
- Security of the system (sign-in log).

### Data subjects

- Employees, including former employees.
- [Temporary staff, apprentices, interns.]

### Categories of personal data

| Category | Data |
|---|---|
| Identity and contract | Name, email, team, role, employment start and end, pensum, work schedule, vacation entitlement, timezone, language, [date of birth, if used for minimum vacation] |
| Working time | Start, end and breaks per day, daily totals, corrections with reasons, balances, overtime and Überzeit |
| Projects | Project per time entry (if enabled) |
| Absences | Vacation, training, other absences; **sick leave and doctor's notes (health data, sensitive under Art. 5 lit. c revDSG)** |
| Approvals and sign-offs | Decisions, notes, sign-off date and signer |
| Change log | Who changed which record, when, before and after, why |
| Access and security | Password hash, two-factor and passkey credentials, API keys (hashed), sessions, sign-in attempts with IP address and device |

No location tracking, no behaviour monitoring (ArGV 3 Art. 26).

### Recipients

| Recipient | Access |
|---|---|
| The employee | Own data |
| Team leads and deputies | Data of their team members, including sick leave |
| HR | Data of all employees |
| Administrators | Master data and settings, no working times |
| [Payroll / accounting] | [Exported reports] |
| [Hosting / IT service provider] | [Server operation; processor contract per Art. 9 revDSG] |
| [Email provider] | Notification emails |
| Labour inspectorate | On request (ArG Art. 46) |

Disclosure abroad: [none / country and safeguards]. The Have I Been Pwned password check sends a 5-character hash prefix only and can be disabled.

### Retention

| Data | Retention |
|---|---|
| Time records, absences, sign-offs, change log | At least 5 years after they lapse (ArGV 1 Art. 73); setting "Retention" = [5 / 10] years. 10 years if they serve as payroll vouchers (OR 958f). |
| Former employees | Anonymised after employment end + retention period (Employees → Access → Anonymise). |
| Sign-in log | [365] days (Settings → Security) |
| Read notifications | 180 days |
| Backups | Nightly backups kept [14] days; off-site copies [period] |

### Technical and organisational measures (Art. 8 revDSG)

- Hosting on the company's own server [location], internal network or VPN only.
- Role-based access with strict isolation; administrators see no working times.
- Argon2id password hashes, breached-password check, two-factor authentication or passkeys [required for administrators / everyone], optional single sign-on.
- Server-side sessions, CSRF protection, Content-Security-Policy, rate limiting.
- Append-only change log; signed-off months sealed and protected by database triggers.
- Encrypted backups (Argon2id + ChaCha20-Poly1305), off-site copies [where].
- Full-disk encryption on the server [yes / no].
- Data export for access requests (Art. 25 revDSG); anonymisation after the retention period.
- [Organisational: who holds administrator and HR rights, review interval.]

Details: [security.md](security.md), [compliance.md](compliance.md).
