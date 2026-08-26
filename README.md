# AGT Event Calendar

AGT Event Calendar is a responsive React application for events hosted by the Alliance of Galactic Travellers and related No Man's Sky communities. It loads a fresh CSV database on every page visit, validates each row, supports live filtering, represents multi-day events, and opens complete event information in an accessible modal.

## Local setup

Requirements:

- Node.js 18.18 or newer
- npm 9 or newer

Install and start the development server:

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`.

## Build, lint, and test

```bash
npm run lint
npm test
npm run build
```

The production site is written to `dist/`. The lint command performs a strict TypeScript project check. Tests cover CSV quoting and validation, filtering, and multi-day calendar behavior.

## Event database configuration

The source is centralized in `src/config.ts` as `EVENT_DATABASE_URL`.

- Keep the supplied Google Sheets CSV URL to use the live database.
- Change it to `/events.csv` to use the local file at `public/events.csv`.
- Another publicly accessible HTTP(S) CSV URL can be used without changing application logic.

Every database request uses `cache: "no-store"` and a timestamp query parameter. Events are kept only in React memory: the application does not write the database to local storage, IndexedDB, a service worker, or another client-side cache.

### Updating the local CSV

Replace `public/events.csv` while preserving the header names below. A production deployment creates a new static asset, and `customHttp.yml` sends explicit no-cache headers for `/events.csv`.

CSV values follow standard quoting rules. Fields containing commas—especially `EVENT_NAME` or a multi-link `EVENT_LINKS` value—must be enclosed in double quotes. Embedded double quotes are represented by two double quotes.

## CSV schema

| Field | Required | Validation and meaning |
| --- | --- | --- |
| `EVENT_ID` | Yes | Exactly four hexadecimal characters. |
| `EVENT_NAME` | Yes | Plaintext event name. |
| `EVENT_DATETIME_START` | Yes | UTC ISO 8601 timestamp ending in `Z` or `+00:00`. |
| `EVENT_DATETIME_END` | No | UTC ISO 8601 timestamp; cannot precede the start. |
| `EVENT_CIV` | No | Full host civilization or group name. |
| `EVENT_TYPE` | Yes | Plaintext event type. |
| `EVENT_MD_URI` | No | Public HTTP(S) URL for a Markdown description. |
| `EVENT_COVER_IMG_URI` | No | Public HTTP(S) event-cover image URL. |
| `EVENT_LINKS` | No | Comma-separated HTTP(S) URLs inside one properly quoted CSV field. |
| `EVENT_GALAXY_NAME` | Yes | Galaxy name. |
| `EVENT_REGION_NAME` | Yes | Region name. |
| `EVENT_SYSTEM_NAME` | Yes | System name. |
| `EVENT_PLANET_NAME` | No | Planet name. |
| `EVENT_PORTAL_CODE` | Yes | Exactly 12 alphanumeric characters. |

Surrounding whitespace is trimmed. A malformed row is skipped and reported in the data-warning panel; valid rows continue to render. Unsafe external URL schemes are ignored. Markdown is rendered without raw HTML, and outbound links use a new isolated browsing context.

## AWS Amplify Hosting

The repository includes `amplify.yml` with the expected Amplify Hosting pipeline:

- Dependency install: `npm ci`
- Build: `npm run build`
- Output directory: `dist`
- Cached build dependency path: `node_modules/**/*`
- Root-level `customHttp.yml` with no-cache headers for the local event database

In Amplify Hosting, connect this repository and select the intended deployment branch. No backend, environment variable, secret, or SPA rewrite is required because the application uses one client entry point and no client-side routes.

## Maintenance notes

- Event parsing and schema validation live in `src/lib/csv.ts`.
- Calendar overlap and multi-day calculations live in `src/lib/date.ts`.
- Filter behavior lives in `src/lib/filter.ts`.
- The database URL and bug-report URL live in `src/config.ts`.
- Visual tokens and responsive rules live in `src/styles.css`.

The interface presents calendar timestamps in the viewer's local timezone. The details modal shows both local time and the authoritative UTC instant.

## Troubleshooting

### The database cannot be loaded

Confirm the CSV is public, returns an HTTP success response, and permits cross-origin browser requests. For Google Sheets, publish the correct sheet tab to the web as CSV. Browser privacy extensions can also block Google-hosted resources.

### Events are skipped

Open the warning panel above the filters. It reports source row numbers and validation messages. Check required headers, four-character hexadecimal IDs, UTC timestamps, 12-character portal codes, and CSV quoting.

### A description or cover does not appear

The remote host must allow browser requests. Only HTTP(S) URLs are accepted. A failed optional resource does not prevent the rest of the event details from rendering.

### Amplify build fails during `npm ci`

Run `npm install` locally and commit the resulting `package-lock.json`, then verify the Amplify build image provides Node.js 18.18 or newer.
