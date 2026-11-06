# Agent guide — AGT Event Calendar

Self-hosted with Docker Compose. A **Fastify** server (`server/`, Node 24, TypeScript) owns a **SQLite**
database (`better-sqlite3`) and serves a React 19 + Vite SPA (`src/`) plus a separate admin dashboard
entry (`admin.html` → `src/admin/`). No router or state library. No cloud services, no CDNs, and no
outbound requests from the server. User prefs and bookmarks live in `localStorage`.

## Branches (read first)

- `main` holds only README/LICENSE. **There is no code on `main`.**
- `staging` and `prod` both serve live instances. **Do not push to them directly.**
- Base work on `staging`; open PRs as instructed by the issue/maintainer (for the self-hosting work: base on `staging`, target `main`).

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
| `src/components/SubmitEventModal.tsx`, `altcha.ts` | Public submission form with the bundled ALTCHA widget (lazy-loaded) |
| `src/admin/` | Admin dashboard; strings in `src/admin/i18n.ts` |
| `src/translations.ts` | Public UI strings for 10 locales (~2000 lines — grep, don't read whole) |
| `src/styles.css` | All public styling (grep for the class you need); admin styles in `src/admin/admin.css` |
| `public/` | Static assets incl. the bundled flag font. Large binaries — don't open |

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
- Commit messages: short imperative sentence (e.g. “Add event action toast notifications”).
