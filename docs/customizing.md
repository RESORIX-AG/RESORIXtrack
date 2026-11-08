# Customizing

## Branding (no rebuild)

**Administration → Settings → Company**

| Setting | Effect |
|---|---|
| Company name | Browser title, emails, reports |
| Accent colour | `#rrggbb`; replaces `--brand`, all brand shades derive from it. Empty: RESORIX blue. |
| Logo on dark, logo on light | SVG, PNG or WebP, up to 1 MB, transparent background. Used on the sign-in page, in the app and on PDF reports. Emails use the PNG only (mail clients do not render SVG); with custom logos but no PNG, emails show the company name as text. |

Logos are stored in `/data/branding/` and included in backups. SVG files with scripts, event handlers or external references are refused.

A modified or rebranded version must replace the RESORIX logos, see [LICENSING.md](../LICENSING.md#trademarks).

## Theme tokens

All colours, radii and shadows are CSS custom properties in **`src/styles.css`**, authored in OKLCH. Dark tokens are the base; the `light` variant swaps them. The theme follows the device (`prefers-color-scheme`) unless the person picks Light or Dark in the top bar: then `<html>` gets `.light` or `.dark` (cookie `rt_theme`). Use the `light:` and `dark:` utilities, they cover both cases.

| Token group | Examples |
|---|---|
| Brand | `--brand`, `--brand-bright`, `--brand-ink`, `--navy`, `--gradient-brand` |
| Surfaces | `--background`, `--card`, `--popover`, `--muted`, `--border` |
| Status (one lightness and chroma, hue varies) | `--work`, `--break`, `--absent`, `--holiday`, `--positive`, `--negative`, `--warning`, `--info` |
| Charts | `--chart-1` … `--chart-5` |
| Sidebar | `--sidebar` and friends |

Change values, then rebuild (`pnpm build`, or `docker compose up -d --build`). Components use only these tokens through Tailwind classes; rules in [design.md](design.md).

## Icons

`public/favicon.svg`, `public/apple-touch-icon.png`, `public/manifest.webmanifest` (installable app). Default artwork in `public/brand/`. Replace and rebuild.

## Languages

English, German, French and Italian ship. UI strings are JSON files in `src/i18n/<locale>/<namespace>.json`; placeholders `{name}`, plurals with `_one` / `_other` (`_few`, `_many` where needed). Email texts are in `src/server/mail/strings.ts`; PDF and spreadsheet labels come from the `reports.pdf` keys; holiday names from `holidays.json`.

### Change a string

```bash
pnpm tsx scripts/i18n-set.ts time.add_entry "Add entry" "Eintrag hinzufügen" "Ajouter une entrée" "Aggiungi registrazione"
pnpm tsx scripts/i18n-set.ts --file keys.json   # { "ns.key": ["en", "de", "fr", "it"] }
pnpm i18n:check
```

German uses Swiss spelling (ss), Swiss terms (Absenz, Ferien, Pensum, Überzeit, visieren) and "du"; French and Italian use "tu".

### Add a language

1. Copy `src/i18n/en` to `src/i18n/<code>` and translate. Keep keys and placeholders.
2. Add `{ code, label, intl }` to `LOCALES` in `src/lib/locales.ts`. Validators, profile, setup, emails and `scripts/i18n-set.ts` all read it.
3. Add a locale object to `src/server/mail/strings.ts` and to `MAIL_STRINGS` (the type check and `mail.test.ts` fail until it is complete).
4. Run `pnpm i18n:check` (missing keys, placeholder mismatches) and `pnpm test`.

## Public-holiday presets

Calendars come from canton presets only (`CH-ZH` …), built on `date-holidays`; RESORIXtrack keeps no holiday data of its own. See `src/server/services/holiday-presets.ts`. A calendar keeps its preset key in `region_code` and its ticked optional and commune days in `preset_days`; the worker adds next year's holidays every 1 October.

## Absence types

No code needed: **Settings → Absence types**. Built-in type names are translated in `src/i18n/<locale>/absence_types.json`.
