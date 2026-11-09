# Agent guide — AGT Event Calendar

A **Fastify** server (`server/`, Node 24, TypeScript) owns a **SQLite** database (`better-sqlite3`) and serves a
React 19 + Vite SPA (`src/`) plus a separate admin dashboard entry (`admin.html` → `src/admin/`). The REST API is
described by an OpenAPI 3.1 document generated from the TypeBox route schemas (`/api/openapi.json`). No router or
state library. No cloud services, no CDNs, and no outbound requests from the server. User prefs and bookmarks live
in `localStorage`.

**Database: SQLite**, because one instance serves one community: a single admin plus moderated public submissions
write rarely, the data is small, and one process owns it. Deployment: Docker Compose (`docker-compose.yml`) or a
local systemd service on Ubuntu/Debian (`deploy/agt-event-calendar.service`); both are documented in `README.md`.

This app follows, and is the reference implementation of, the
**[AGT Web Application Specification](docs/agt-webapp-spec.md) v1.0.1**. Read it before changing architecture,
API, security, UI or deployment. Where this app differs from the spec, see
[Deviations](#deviations-from-the-agt-web-app-spec) below.

## Branches (read first)

- `main` is the default branch and holds the code. Work on a feature branch and open a PR into `main`.
- Branches that serve live instances (`staging`, `prod`, if present) are **never pushed to directly**.

## Commands

```bash
npm ci              # install (lockfile is committed; prefer ci over install)
npm run check       # lint + test + build — run this before every commit
npm run lint        # strict tsc check of client, server and tests (no ESLint/Prettier)
npm test            # test:client (src/lib/*.test.ts) + test:server (server/test/*.test.ts)
npm run build       # SPA → dist/, server bundle → dist-server/index.mjs
npm run dev:server  # build + run the server on :8080 (reads ./config.yaml, data in ./data)
npm run dev         # Vite dev server on :5173, proxies /api to :8080
docker compose up -d --build   # the real deployment
```

Run a single test file:

```bash
npx esbuild server/test/migration.test.ts --bundle --platform=node --format=esm --packages=external --loader:.sql=text --outdir=.test-build/server --out-extension:.js=.mjs && node --test .test-build/server/migration.test.mjs
```

The Vite "chunks larger than 500 kB" warning on build is pre-existing and expected.

## Where things live

| Path | Purpose |
| --- | --- |
| `server/index.ts` | Entry point: loads `config.yaml` (`AGT_CONFIG_FILE`), opens the DB, reads `AGT_SETUP_PASSWORD`, listens |
| `server/app.ts` | `buildApp()`: security headers/CSP, error handling, public API, submissions, setup, login, static SPA |
| `server/adminRoutes.ts` | Admin-only API (session + `x-agt-request: 1` CSRF header required) |
| `server/openapi.ts`, `server/schemas.ts` | `@fastify/swagger` setup (`/api/openapi.json`) and the TypeBox schemas of every route |
| `server/config.ts` | TypeBox schema for `config.yaml` and `EDITABLE_SETTINGS` (dashboard-editable keys) |
| `server/context.ts` | `AppContext` and settings precedence: **config file > dashboard > default** |
| `server/db.ts`, `server/migrations/*.sql` | Numbered plain-SQL migrations, version in `PRAGMA user_version` |
| `server/repository.ts` | All SQL queries |
| `server/images.ts` | Image checks by magic bytes (PNG/JPEG/WebP/GIF, no SVG, ≤ 10 MB) and storage |
| `server/migration.ts`, `server/zip.ts` | Migrate from Amplify (ZIP import) and safe ZIP reading |
| `server/backup.ts` | Backup export / restore (never writes `config.yaml`) |
| `server/altcha.ts`, `server/passwords.ts`, `server/session.ts` | Captcha, scrypt hashes, cookie sessions |
| `server/test/` | `node:test` + Fastify `inject()`; `helpers.ts`; `fixtures/amplify-migration/` is the reference ZIP |
| `src/App.tsx` | Calendar root: API loading, filters, modals, bookmarks, `?event_id=` deep links (legacy IDs → UUID) |
| `src/lib/validation.ts` | **Shared** validation (server + browser). Change rules here only |
| `src/lib/api.ts`, `src/lib/client.ts` | API types/helpers and the browser fetch wrapper (`cache: 'no-store'`) |
| `src/lib/csv.ts`, `src/lib/holidays.ts` | Legacy CSV parsing, used only by Migrate from Amplify |
| `src/components/Markdown.tsx` | The only Markdown renderer. Raw HTML → text, HTTP(S) URLs only |
| `src/components/PortalGlyphs.tsx` | Portal codes as glyphs (NMS Glyphs Mono), only for 12-hex-digit codes |
| `src/components/SubmitEventModal.tsx`, `altcha.ts` | Public submission form with the bundled ALTCHA widget (lazy-loaded) |
| `src/admin/` | Admin dashboard; strings in `src/admin/i18n.ts` |
| `src/translations.ts` | Public UI strings for 10 locales (~2000 lines — grep, don't read whole) |
| `src/styles.css` | All public styling (grep for the class you need); admin styles in `src/admin/admin.css` |
| `public/` | Static assets incl. the bundled fonts (NMS Futura, NMS Glyphs Mono, flags). Large binaries — don't open |
| `deploy/` | systemd unit and Caddy example for local installations |
| `docs/agt-webapp-spec.md` | The AGT Web Application Specification (normative for all AGT apps) |

## Conventions and gotchas

- **Translations:** every key in `english` (`src/translations.ts`) and in `en` (`src/admin/i18n.ts`) must
  exist, non-empty, in all 10 locales. `translations.test.ts` and `adminTranslations.test.ts` enforce this.
  Find locale blocks with `grep -n "^const [a-z]*: Translations" src/translations.ts`. Brand names that are
  never translated go in `COMMON_TRANSLATIONS`. Interpolate with `formatTranslation(template, { key })`.
- **No hardcoded UI text** in components — use `getTranslations(locale)` / `getAdminTranslations(locale)`.
  Server error messages are English.
- **Content safety (do not weaken):** never add `rehype-raw` or any plugin that turns raw HTML into elements,
  and never use `dangerouslySetInnerHTML` for user- or admin-supplied content. Render Markdown only through
  `src/components/Markdown.tsx`. Keep `urlTransform={markdownUrlTransform}`. Never accept SVG uploads or trust
  a client `Content-Type`; check images with `validateImage()`. Keep the CSP `script-src 'self'`.
- **Config precedence is enforced on the server.** Anything that writes the `settings` table must reject or
  skip keys for which `isDefinedInConfig()` is true.
- **IDs:** new events always get `crypto.randomUUID()`. `legacy_id` is set only by Migrate from Amplify and
  is never a key. Validate with `isUuidV4()` / `isLegacyEventId()`.
- **Schema changes:** add a new `server/migrations/000N_*.sql` and append it to `MIGRATIONS` in `server/db.ts`.
  Never edit a released migration. Restore upgrades older backups by running the migrations.
- **No outbound requests** from the server, and no CDN assets in the client. Bundle everything.
- **Fetching:** the client uses `apiRequest()` (`cache: 'no-store'`); event data is never persisted
  client-side — don't add caching/service workers.
- **Tests:** client tests (`src/lib/*.test.ts`, non-recursive glob) run in plain Node with no DOM; stub
  `globalThis.window` as `bookmarks.test.ts` does. Server tests use `createTestServer()` from
  `server/test/helpers.ts` (temp data dir, cheap captcha). Put new logic in `src/lib/` or `server/` with tests.
- Times are stored/validated as UTC; the UI shows and accepts the user's chosen time zone (`settings.ts`, `datetime.ts`).
- TypeScript is `strict` with `noUnusedLocals`/`noUnusedParameters`; lint fails on unused symbols.
- Accessibility matters: modals manage focus (`useDialog`), icon buttons need `aria-label`s (from translations).
- **API routes:** every `/api/` route declares TypeBox schemas (`params`, `querystring`, `body`, every success
  response and `default: ErrorBodySchema` via `errorResponses`) plus `operationId`, `tags`, `summary` and
  `security` (`SECURITY.*` from `server/openapi.ts`). Response schemas must list every field: the serializer drops
  undeclared ones. Multipart bodies are documented with `config.multipartBody` (Fastify can't validate them).
  `server/test/openapi.test.ts` fails if a route is missing from the document or incomplete.
- **Admin CRUD responses:** create → `201 { <resource>, notices }`, replace → `200 { <resource>, notices }`,
  delete → `204` with no body. A breaking API change bumps the major version in `package.json`.
- **Portal codes** are shown with `<PortalGlyphs>` next to the hex text; never use the glyph font for other text.
- Commit messages: short imperative sentence (e.g. “Add event action toast notifications”).

## Deviations from the AGT web app spec

| Rule | What differs | Why |
| --- | --- | --- |
| NAME-2, CFG-2 | Env vars `AGT_SETUP_PASSWORD`, `AGT_CONFIG_FILE`, `AGT_STATIC_DIR` (no `EVENT_CALENDAR` segment); session cookie `agt_session`; Compose service `calendar` and volume `calendar-data`; SQLite file `agt-calendar.sqlite` | Legacy names from before the spec. Renaming them would break existing `.env` files, sign everyone out and orphan the data volume. |
| CFG-5 | Backup/import upload limits are under `migration.*` instead of `backup.*` | Operators may already set them in `config.yaml`; unknown keys stop the server. |
| STACK-1 | Extra runtime dependency `papaparse` | Parses the legacy CSVs for Migrate from Amplify. |
