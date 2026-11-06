# Agent guide — AGT Event Calendar

Client-only React 19 + TypeScript + Vite SPA. No backend, no router, no state library.
Data comes from public Google Sheets CSVs fetched at runtime; user prefs live in `localStorage`.

## Branches (read first)

- `main` holds only README/LICENSE. **There is no code on `main`.**
- `staging` is the development branch (auto-deployed by AWS Amplify). Base work and PRs on `staging`.
- `prod` is production; only updated by merging `staging` → `prod` via PR. Never push to it directly.

## Commands

```bash
npm ci              # install (lockfile is committed; prefer ci over install)
npm run check       # lint + test + build — run this before every commit
npm run lint        # strict tsc project check (no ESLint/Prettier in this repo)
npm test            # bundles src/lib/*.test.ts with esbuild, runs node:test
npm run build       # tsc -b && vite build → dist/
npm run dev         # Vite dev server, http://localhost:5173
```

Run a single test file:

```bash
npx esbuild src/lib/csv.test.ts --bundle --platform=node --format=esm --outdir=.test-build --out-extension:.js=.mjs && node --test .test-build/csv.test.mjs
```

The Vite "chunks larger than 500 kB" warning on build is pre-existing and expected.

## Where things live

| Path | Purpose |
| --- | --- |
| `src/App.tsx` | Root component: data loading, filters, modal open state, bookmarks, settings, `?event_id=` deep links |
| `src/config.ts` | All external URLs (event DB, change log, holidays, form, support) |
| `src/types.ts` | `CalendarEvent`, `EventFilters`, `DataWarning` |
| `src/translations.ts` | UI strings for 10 locales (~1800 lines — grep, don't read whole) |
| `src/styles.css` | All styling (~1800 lines, CSS custom properties in `:root`) — grep for the class you need |
| `src/components/*.tsx` | `Calendar`, `FilterBar`, `EventModal`, `BookmarksModal`, `SettingsModal`, `ChangeLogModal`, `NationalHolidaysModal`, `Icons` (inline SVG) |
| `src/lib/csv.ts` | Event CSV parsing + schema validation (`EVENT_FIELDS`) |
| `src/lib/date.ts` | Multi-day/overlap calendar math, UTC-offset formatting |
| `src/lib/filter.ts` | Event filtering |
| `src/lib/bookmarks.ts`, `settings.ts` | `localStorage` persistence (`agt_event_calendar_*` keys) |
| `src/lib/changelog.ts`, `holidays.ts` | Parsers for the change-log and national-holiday CSVs |
| `src/lib/urls.ts` | `safeExternalUrl`, cache-buster, glyph-tool and deep-link URL builders |
| `public/` | Static assets; `events.csv` is a local sample DB. Large binaries (`.mp3`, `.ttf`, `.webp`) — don't open |

The CSV schema is documented in `README.md` (“CSV schema”).

## Conventions and gotchas

- **Translations:** every key in `english` must exist, non-empty, in all 10 locale objects
  (`french`, `german`, `spanish`, `portuguese`, `italian`, `thai`, `chinese`, `hindi`, `japanese`).
  `src/lib/translations.test.ts` enforces this. When adding a string, add it to all locales —
  find each block with `grep -n "^const [a-z]*: Translations" src/translations.ts`.
  Brand/product names that are never translated go in `COMMON_TRANSLATIONS`.
  Interpolate with `formatTranslation(template, { key })` and `{{key}}` placeholders.
- **No hardcoded UI text** in components — use `getTranslations(settings.locale)`.
- **Tests** only cover `src/lib/` (glob is non-recursive: `src/lib/*.test.ts`). They run in plain
  Node with no DOM; keep lib code pure, or stub `globalThis.window` as `bookmarks.test.ts` does.
  Put new logic in `src/lib/` with a co-located `*.test.ts` rather than in components.
- **External URLs** from CSV data must pass `safeExternalUrl` (HTTP(S) only). Markdown is rendered with
  `react-markdown` + `remark-gfm`, no raw HTML, `urlTransform={markdownUrlTransform}`. Keep it that way.
- **Fetching:** every remote fetch uses `withCacheBuster(...)` and `cache: 'no-store'`. Event data is
  never persisted client-side — don't add caching/service workers.
- **Don't change `src/config.ts` URLs** unless asked; they point at the live production sheets.
  To develop against local data, temporarily set `EVENT_DATABASE_URL = '/events.csv'` and revert before committing.
- Times are stored/validated as UTC; the UI shows the user's chosen time zone (`settings.ts`).
- TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters`; lint fails on unused symbols.
- Accessibility matters: modals manage focus, icon buttons need `aria-label`s (from translations).
- Commit messages: short imperative sentence (e.g. “Add event action toast notifications”).
