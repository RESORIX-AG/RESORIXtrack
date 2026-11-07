# Design rules

RESORIXtrack keeps the look of v1 – Inter, the RESORIX blue `#35a1cc` with its navy gradient, dark and
light themes following the device (or the person's choice), accent overridable by administrators – rebuilt on shadcn/ui (Base UI primitives). The rules below come
from *Refactoring UI* and *The Invisible Geometry of Interfaces*; they are defaults, not suggestions. Deviate
only when you can name the reason in one sentence.

## Tokens (src/styles.css)

- Colours are OKLCH tokens. Use Tailwind classes bound to them (`bg-card`, `text-muted-foreground`,
  `text-positive`, `bg-brand-soft`, `text-work` …). Never a hex value in a component.
- **Status family** (`work`, `break`, `absent`, `holiday`, `positive`, `negative`, `warning`, `info`) shares one
  lightness and chroma; only hue varies, so no state shouts louder by accident. Colour never carries meaning
  alone: pair it with an icon, a sign (+/−) or text (`StatusBadge`, `Duration`).
- Type scale: 12 / 14 / 16 / 18 / 24 / 30 px (`text-xs sm base lg 2xl 3xl`). Page title `text-2xl font-semibold`,
  section title `text-base font-semibold`, key figures `text-3xl font-semibold tabular`. Max ~3 sizes per view.
- Spacing: Tailwind 4 px scale; sections `gap-6`, groups `gap-3`, inside controls `gap-2`. Start generous.
- Radii nest: card `rounded-xl` (14 px) → inner elements `rounded-lg` → chips `rounded-md`.
- Numbers that line up use tabular numerals (`tabular`; tables do it automatically).

## Hierarchy & separation

- **One primary action per view** (filled button). Secondary: `outline`; tertiary: `ghost`/link. Destructive
  actions use `destructive` and are never the default focus.
- Emphasise by de-emphasising: muted secondary text, fewer labels (a value with a unit rarely needs a label).
- **Separation ladder** – use the least that works: space → tint (`bg-card`/`bg-muted`) → hairline border →
  shadow. Resting cards: tint + hairline, **no shadow**. `shadow-overlay` only for things that float
  (popover, dialog, sheet, dropdown).
- Fewer borders: separate table rows with hairlines, not boxes; group form sections by space.

## Controls & overlays

- Choose the control by the decision: immediate on/off → `Switch` (applies now); on/off inside a form →
  `Checkbox`/`SwitchField` (applies on save); 2–5 visible options → `Segmented` (`SegmentedField`); short fixed
  lists up to 6 → `Select`; dynamic or long lists (teams, people, projects, calendars, timezones, cantons) →
  searchable `Combobox` (`ComboboxField`). Both open below the trigger, never over it; action → `<button>`, navigation → `<Link>`.
- No native pickers: dates use `DatePicker`/`DateField`, colours `ColorPicker`, files `FilePicker`, times
  `TimeInput`/`TimeField` (follows 12/24 h, suggests times in a list). Pickers drop the leading icon when a label sits above.
- Geometry: inputs, selects, buttons, date triggers and segmented controls are 36 px (`h-9`), icon buttons
  `size-9`; 32 px (`sm`) only inside table rows and dense table toolbars. Controls `rounded-lg`, segments and
  chips `rounded-md`, cards `rounded-xl`.
- Decision buttons stay neutral at rest and show their meaning on hover and focus: `intent="positive"`
  (approve, sign off a row, restore) or `intent="negative"` (decline, cancel, delete, remove, revoke) on
  `outline`/`ghost` buttons. The page's primary action stays filled; `destructive` is for confirm dialogs.
- Disruption ladder – lowest rung that works: inline → expand → tooltip (never essential info) → popover →
  dialog (required decision or destructive confirm only) → page. On mobile, dialogs with forms become
  `Drawer`/`Sheet` from the bottom.
- **Reversible actions run immediately with an Undo toast** (`undoToast`). Confirm only irreversible,
  high-consequence actions, effortfully (`ConfirmDialog typeToConfirm`). Toasts stack expanded (max 3),
  hide after 4 s (Undo 8 s) and their action button is primary.
- Don't disable without explanation. A submit button stays enabled and explains on click; when something is
  unavailable for a reason the user can fix, say how (e.g. "Select employees to sign off").

## Layout

- One page width (`Page`: `max-w-screen-2xl`); reading text keeps a measure on the text block (`max-w-prose`).
- Settings, profile and person detail use `SettingsGroup` + `SettingRow`: a titled card, rows split by
  hairlines, label and short hint left (at most half), control right; stacked below `md`. Save bar spans the
  page and sticks to the bottom only while there are unsaved changes.
- Sheets and dialogs (`ResponsiveDialog`, `EditorSheet`): header (title, optional status line), scrolling body,
  sticky footer with the actions: primary right, secondary left of it, a quiet destructive action far left.
  Never actions in the body. Width by content: `sm` confirm/reason, `md` single record (entry, absence,
  project, team), `lg` longer forms (person, schedule, import), `xl` tables. Short fields share rows (2–3
  columns) in `lg`/`xl` sheets.
- Details read as a definition list: muted labels left, values right, empty rows left out.
- Free text is a `TextareaField`: grows from two lines, a counter appears near the server limit.

## Forms

`useAppForm` for every form with field validation. Validate a field on blur, then live while it is corrected; on
submit show all errors and focus the first one. Messages at the field, saying how to fix. Reserve no layout jumps.
Short decisions without field validation (confirm, optional note, required reason) are native form Actions with
`PendingButton` (`ConfirmDialog`, `ReasonDialog`).

## Motion

One set for every overlay, defined once in `src/styles.css` (keyframes on `data-open`/`data-closed`, so they
also play when an overlay mounts already open). Nothing else moves except the period slide.

| Element | In | Out | Movement |
|---|---|---|---|
| Side sheet, backdrop | 220 ms ease-out | 160 ms ease-in | slide 32 px from its edge + fade |
| Phone drawer | 220 ms ease-out | drawer's own (drag keeps working) | from the bottom edge |
| Dialog, alert dialog | 180 ms | 130 ms | fade + scale 0.97 |
| Popover, menu, select, combobox | 120 ms | 100 ms | fade + scale 0.96 from the anchor |
| Tooltip | 120 ms | 100 ms | fade |
| Collapsible section | 180 ms | 180 ms | height + opacity |

`prefers-reduced-motion` cuts movement to an instant change.

## Feedback, motion, loading

- Hover/focus colour transitions 150–200 ms (`transition-colors duration-150`); press feedback instant.
- Movement only to show a change the user caused (entering dialogs, toasts, sheets: 150–250 ms ease-out).
  A period step (‹ ›) slides the period's content 24 px in its direction (`PeriodContent`).
  No looping or ambient motion. `prefers-reduced-motion` cuts movement.
- Loading by latency: < 100 ms nothing; structured content → `Skeleton` in the shape of the content;
  spinner only inside a button after submit; > 1 s → progress with a message. Clock actions are optimistic.
- Every list has an empty state that says what to do next (`Empty` component, one action).

## Focus & keyboard

Every interactive element is a real `button`/`a`/input; nothing else is focusable. After navigation focus moves
to the page `h1` (done by the shell). Dialogs trap focus and restore it. Shortcuts: `⌘K` search, `S` clock
in/out (only when no input is focused), `Esc` closes. Show shortcuts in tooltips.

## Responsive

Works from 360 px. Below `md`: bottom tab bar + "More" sheet, sticky clock bar, tables become stacked rows
(DataTable does it), dialogs become bottom sheets, touch targets ≥ 44 px (CSS does it for coarse pointers),
safe areas respected. Never horizontal page scroll; wide content scrolls inside its own container.

## Long lists

Paginate short, browsable lists (`DataTable` pages 50 rows). Lists that can run into hundreds of rows turn
pagination off (`pageSize={false}`): above 150 rows the DataTable renders only the rows in view inside a scroll
container with a sticky header, with fixed column widths (`meta.width`) so nothing jumps. Server logs load older
rows while scrolling (cursor pages, `infinite`) instead of page buttons. Rows stay keyboard reachable (↑/↓,
Enter) and screen readers hear the full size.

## Component checklist (run for every new element)

Purpose (one job; primary?) · States (default, hover, focus-visible, active, selected, loading, error, empty,
disabled-with-reason) · Hierarchy tier · Separation rung · Focus & keyboard · Feedback · Accessibility (role,
name, contrast, target size) · Density & narrow-width behaviour.

## Text

No yapping. Every word on screen must earn its place.
- Page headers: a title, no description line unless the page is unusable without it.
- No explanatory paragraphs, intros, or "here you can…" sentences. Explanations go into a tooltip, a field description of
  a few words, or the docs.
- Labels: 1 to 3 words. Buttons: a verb (Save, Sign off, Approve). Empty states: one short line plus one action.
- Errors say what to fix, in one sentence. Toasts: 2 to 5 words ("Entry saved").
- Prefer a value with a unit over a labelled sentence. Never repeat what the layout already shows.
