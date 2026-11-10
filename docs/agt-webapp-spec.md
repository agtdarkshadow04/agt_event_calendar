# AGT Web Application Specification

| | |
| --- | --- |
| **Spec version** | 3.0.0 |
| **Status** | Normative |
| **Audience** | AI coding agents that design, build, review or maintain AGT web applications |
| **Reference implementation** | [`Folfchie/agt_event_calendar`](https://github.com/Folfchie/agt_event_calendar) (AGT Event Calendar), with the deviations listed in [Appendix A](#appendix-a-reference-implementation-deviations) |

This document defines how every Alliance of Galactic Travellers (AGT) web application is built: stack,
repository layout, API, data storage, configuration, authentication, security, backups, UI design,
internationalization, deployment, testing and documentation. Follow it whenever you create a new AGT app or
change an existing one.

## 0. How to use this document

- **Keywords.** MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119. A MUST is never optional.
  Where a SHOULD is not followed, record the reason in the app's `AGENTS.md`.
- **Requirement IDs.** Rules carry IDs such as `API-3`. Cite them in commit messages, PR descriptions and
  reviews ("Implements CFG-4"), and when you record a deviation.
- **Placeholders.** Every app has a slug in three forms (see [§2](#2-naming)):

  | Placeholder | Form | Example (calendar) |
  | --- | --- | --- |
  | `<app>` | kebab-case | `event-calendar` |
  | `<app_snake>` | snake_case | `event_calendar` |
  | `<APP>` | UPPER_SNAKE_CASE | `EVENT_CALENDAR` |
  | `<App Name>` | Display name | `AGT Event Calendar` |

- **Precedence.** This spec is the baseline. An app's `AGENTS.md` MAY tighten a rule but MUST NOT loosen one
  unless it lists the rule under **Deviations from the AGT web app spec**, giving the rule ID and the reason.
  A deviation that is not documented is a bug.
- **When the spec is silent,** do what the reference implementation does. If the reference implementation
  is listed in Appendix A for that topic, follow the spec, not the reference.
- **Changing this spec.** Change it in a PR of its own. Bump the spec version (this is separate from the apps'
  versions, which follow [§21](#21-versioning-and-releases)): major for a new or stricter MUST,
  minor for a new SHOULD/MAY or a new section, patch for clarifications. New design tokens, locales and
  registry entries are added here first, then in apps.

## 1. Principles

1. **Self-hosted and self-contained.** An AGT app runs entirely on the operator's machine. No cloud services,
   no third-party CDNs, no telemetry, no outbound requests from the server.
2. **One operator, one admin.** Each instance has exactly one admin account, created on first run.
3. **Secure by default.** Safe defaults that need no tuning; dangerous options do not exist.
4. **Config file wins.** What the operator writes in `config.yaml` cannot be overridden from the UI, the API,
   a restore or a migration.
5. **Boring, uniform technology.** Every app uses the same stack and layout, so an agent that knows one AGT
   app knows them all.
6. **Recoverable.** Every instance can be backed up and restored from its admin dashboard.
7. **Accountable.** The admin can see what the server did (server log) and what users did (audit log).
8. **For a global community.** Every UI is accessible and available in all AGT locales.

## 2. Naming

- **NAME-1** Every app MUST have a unique slug: lowercase ASCII letters and digits, words separated by
  hyphens, without an `agt` prefix (e.g. `event-calendar`). Register it in the [app registry](#21-app-registry)
  before writing code.
- **NAME-2** Derived identifiers MUST use these forms:

  | Item | Form |
  | --- | --- |
  | GitHub repository | `agt_<app_snake>` |
  | npm package `name` | `agt-<app>` |
  | Environment variables | `AGT_<APP>_*` |
  | Session cookie | `agt_<app_snake>_session` |
  | `localStorage` keys | `agt_<app_snake>_*` (e.g. `agt_<app_snake>_settings`) |
  | Docker Compose service / named volume | `<app>` / `<app>-data` (and `<app>-db` for Postgres) |
  | Docker image | `agt-<app>:latest` |
  | Postgres database and role | `agt_<app_snake>` |
  | Local install: system user, code, config, data | `agt-<app>`, `/opt/agt-<app>`, `/etc/agt-<app>/`, `/var/lib/agt-<app>/` |
  | systemd unit | `agt-<app>.service` |
  | Backup file / manifest `format` | `agt-<app>-backup-<timestamp>.zip` / `agt-<app>-backup` |

- **NAME-3** The CSRF header is the same for every app: `x-agt-request: 1` (see [SEC-5](#103-csrf-and-cors)).

### 2.1 App registry

Each app has a unique default port, so several AGT apps can run on one host without changing configuration.
Add a row (next free port) when you create an app.

| Slug | Display name | Repository | Default port | Database |
| --- | --- | --- | --- | --- |
| `event-calendar` | AGT Event Calendar | `Folfchie/agt_event_calendar` | 8080 | SQLite |

## 3. Technology stack

- **STACK-1** Apps MUST use this stack. Adding a runtime dependency that is not listed here requires a reason
  in the PR description.

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 24 LTS (`"engines": { "node": ">=24.0.0" }`), ESM only (`"type": "module"`) |
| Language | TypeScript (`~5.8`), `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` |
| Server | Fastify 5 with `@fastify/type-provider-typebox` and `@sinclair/typebox` |
| Server plugins | `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/multipart` (if uploads), `@fastify/swagger` |
| API description | OpenAPI 3.1, generated from route schemas ([§6](#6-rest-api-and-openapi)) |
| Database | SQLite via `better-sqlite3`, **or** PostgreSQL via `pg` ([§7](#7-data-storage)) |
| Config parsing | `yaml` + TypeBox schema |
| Client | React 19 + Vite 6 (`@vitejs/plugin-react`) |
| Markdown (if needed) | `react-markdown` + `remark-gfm` only ([SEC-12](#106-user-content)) |
| Captcha (if anonymous writes) | `altcha` (widget) + `altcha-lib` (server) ([§11](#11-anonymous-input-and-altcha)) |
| ZIP (backups) | `yazl` (write) + `yauzl` (read) |
| Logging | `pino` (Fastify's logger) to stdout and the log store ([§13](#13-logging)) |
| Server bundle | `esbuild` → `dist-server/index.mjs` |
| Tests | `node:test` + `node:assert/strict`; Fastify `inject()` for HTTP |
| Lint | `tsc -b` (no ESLint, no Prettier) |

- **STACK-2** The client MUST NOT use a router library or a global state library (Redux, Zustand, …).
  Use React state, context and URL query parameters. An app with more than one public page MAY add a second
  Vite entry instead of a router.
- **STACK-3** Do not add a CSS framework (Tailwind, Bootstrap, …) or a component library. Use plain CSS with
  the AGT design tokens ([§15](#15-visual-design-system)).
- **STACK-4** Commit `package-lock.json`. Install with `npm ci`.

## 4. Repository layout

- **REPO-1** Apps MUST use this layout. Files marked *(if …)* exist only when the feature does.

```text
agt_<app_snake>/
├── AGENTS.md                 # agent guide (§20.2); CLAUDE.md contains only "@AGENTS.md"
├── CLAUDE.md
├── README.md                 # operator documentation (§20.1)
├── LICENSE
├── CHANGELOG.md              # release notes (§21.5)
├── Dockerfile
├── docker-compose.yml
├── .env.example              # secrets/bootstrap only, documented
├── config.example.yaml       # every key, commented, with its default
├── .gitignore  .dockerignore .gitattributes
├── deploy/
│   ├── agt-<app>.service     # systemd unit for local installs (§18.2)
│   └── Caddyfile.example     # TLS reverse proxy example
├── index.html                # public SPA entry
├── admin.html                # admin dashboard entry (noindex)
├── package.json  package-lock.json
├── tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json
├── vite.config.ts
├── public/                   # bundled static assets: logo, fonts (never hotlinked)
├── server/
│   ├── index.ts              # entry: load config, open DB, read env, listen, graceful shutdown
│   ├── app.ts                # buildApp(context, options): plugins, headers, errors, public routes, static
│   ├── adminRoutes.ts        # /api/admin/* (session + CSRF)
│   ├── openapi.ts            # @fastify/swagger registration and shared schemas
│   ├── config.ts             # TypeBox config schema, defaults, EDITABLE_SETTINGS
│   ├── context.ts            # AppContext, settings precedence helpers
│   ├── db.ts                 # open DB, MIGRATIONS list, runMigrations
│   ├── migrations/0001_initial.sql
│   ├── migrations/logs/0001_initial.sql   # log store migrations (LOG-1)
│   ├── repository.ts         # all SQL lives here
│   ├── http.ts               # HttpError, multipart helper
│   ├── passwords.ts          # scrypt hashing, constant-time compare
│   ├── session.ts            # cookie sessions, CSRF check
│   ├── logs.ts               # log store, server-log stream, retention job (§13)
│   ├── audit.ts              # audit onResponse hook, IP hashing (§13)
│   ├── backup.ts  zip.ts     # backup/restore and safe ZIP handling
│   ├── images.ts             # (if uploads) magic-byte validation and storage
│   ├── altcha.ts             # (if anonymous writes)
│   └── test/                 # *.test.ts + helpers.ts (+ fixtures/)
└── src/
    ├── main.tsx  App.tsx     # public UI root
    ├── styles.css            # public styles; tokens block from §15
    ├── translations.ts       # public UI strings, all locales
    ├── components/           # public components; useDialog.ts; Icons.tsx
    ├── lib/                  # framework-free logic + *.test.ts (validation.ts, api.ts, client.ts, settings.ts …)
    └── admin/                # admin dashboard: main.tsx AdminApp.tsx *Panel.tsx admin.css i18n.ts context.ts
                              # incl. ServerLogPanel.tsx, AuditLogPanel.tsx (§13.6)
```

- **REPO-2** `.gitignore` and `.dockerignore` MUST exclude `.env`, `.env.*` (except `.env.example`),
  `config.yaml`, `data/`, `dist/`, `dist-server/`, `.test-build/` and `node_modules/`.
- **REPO-3** Shared logic that both the server and the browser need (validation, API types, formatting)
  MUST live in `src/lib/` and be imported by the server. Never duplicate a validation rule.

## 5. Server architecture

- **SRV-1** `server/index.ts` is the only file that reads `process.env`, the filesystem location of the config
  file, or calls `listen()`. It builds an `AppContext` and passes it to `buildApp()`.
- **SRV-2** `buildApp(context, options)` in `server/app.ts` MUST return a fully configured Fastify instance
  without listening, so tests can use `inject()`. It takes `{ logger?, staticDir? }`.
- **SRV-3** `AppContext` holds `config` (resolved, immutable), `db` (swappable on restore), the setup password
  (or `null`) and `version` (from `package.json`). Routes read state only through the context.
- **SRV-4** All SQL MUST live in `server/repository.ts` (split into `server/repository/*.ts` when it exceeds
  ~600 lines). Queries MUST be parameterized; never build SQL from user input. Routes call repository
  functions; they do not contain SQL.
- **SRV-5** Errors: throw `HttpError(statusCode, code, message, fields?)`. One `setErrorHandler` maps every
  error to the error body ([API-6](#62-request-and-response-conventions)). Unexpected errors are logged and
  returned as `500 { error: "internal", message: "An unexpected server error occurred." }`, never with stack
  traces or internal messages.
- **SRV-6** Logging uses pino as Fastify's logger, level from `server.logLevel`, and also feeds the server log
  ([§13](#13-logging)). MUST NOT log passwords, setup passwords, session tokens, cookies, HMAC keys, database
  passwords, raw client IP addresses or request bodies.
- **SRV-7** Handle `SIGTERM` and `SIGINT`: `await app.close()`, close the database, exit 0.
- **SRV-8** Refuse to start (exit 1, one clear log line) on an invalid config file, a database schema newer
  than the app supports, or a missing required secret.
- **SRV-9** Static files: register `@fastify/static` on `dist/` with `index: false`. Serve `GET /` →
  `index.html`, `GET /admin` → `admin.html`, redirect `/admin/` → `/admin`. Hashed files under `/assets/` get
  `Cache-Control: public, max-age=31536000, immutable`; everything else gets `no-store`.
- **SRV-10** Unknown routes return `404` with the error body, not an HTML page.
- **SRV-11** `GET /api/health` MUST run a trivial database query and return `200 { "status": "ok" }`. It is
  public, unauthenticated, not rate limited, and used by the Docker healthcheck.

## 6. REST API and OpenAPI

### 6.1 Paths and methods

- **API-1** All API routes live under `/api/`. Public routes: `/api/<resources>`. Admin routes:
  `/api/admin/<resources>`. Auth and setup: `/api/setup`, `/api/setup/status`, `/api/admin/login`,
  `/api/admin/logout`, `/api/admin/session`. There is no version segment in the path (see API-12).
- **API-2** Resources are plural kebab-case nouns. Use the standard verbs:

  | Operation | Method and path | Success |
  | --- | --- | --- |
  | List | `GET /api/admin/<resources>` | `200` array, or a page (API-8) |
  | Read | `GET /api/admin/<resources>/{id}` | `200` resource |
  | Create | `POST /api/admin/<resources>` | `201 { <resource>: {...}, notices: FieldError[] }` |
  | Replace | `PUT /api/admin/<resources>/{id}` | `200 { <resource>: {...}, notices: FieldError[] }` |
  | Partial update | `PATCH /api/admin/<resources>/{id}` (only if needed) | `200` as above |
  | Delete | `DELETE /api/admin/<resources>/{id}` | `204`, no body |
  | Action | `POST /api/admin/<resources>/{id}/<verb-or-field>` (e.g. `/status`) | `200` resource or result |

  `<resource>` is the singular camelCase name (`event`, `holiday`). `notices` are non-blocking validation
  warnings; send `[]` when there are none.
- **API-3** Public endpoints MUST return only public fields. Define a separate public response schema so
  Fastify's serializer strips everything else (status, submitter data, internal timestamps).

### 6.2 Request and response conventions

- **API-4** JSON in and out (`application/json`), camelCase property names. File uploads use
  `multipart/form-data`, with structured data in a JSON-encoded field (e.g. `event`).
- **API-5** IDs are lowercase RFC 9562 UUIDv4 strings ([DATA-6](#73-ids-times-and-files)). A malformed ID
  returns `404`, not `400`.
- **API-6** Every non-2xx response has this body:

  ```json
  { "error": "validation_failed", "message": "The event is invalid.", "fields": [{ "field": "name", "message": "Name is required." }] }
  ```

  `error` is a stable snake_case code that clients may branch on. `message` is English text for humans.
  `fields` appears only for field-level validation errors. Standard codes and statuses:

  | Status | `error` | When |
  | --- | --- | --- |
  | 400 | `invalid_request`, `validation_failed`, `captcha_failed` | Schema or semantic validation failed |
  | 401 | `unauthorized`, `invalid_credentials`, `invalid_setup_password` | No/invalid session or wrong password |
  | 403 | `csrf`, `<feature>_closed` | Missing CSRF header; feature disabled by the admin |
  | 404 | `not_found` | Unknown route, unknown or invisible resource |
  | 409 | `defined_in_config`, `conflict` | Setting locked by `config.yaml`; state conflict |
  | 410 | `setup_complete` | First-run setup after the admin exists |
  | 413 | `file_too_large`, `field_too_large` | Upload limit exceeded |
  | 415 | `multipart_required`, `image_rejected` | Wrong content type or rejected file |
  | 422 | `archive_rejected` | Backup/import archive failed checks |
  | 429 | `rate_limited` | Rate limit hit; message says when to retry |
  | 500 | `internal` | Unexpected error |
  | 503 | `setup_password_missing` | First run, but no setup password configured |

- **API-7** Timestamps in API payloads are ISO 8601 UTC strings ending in `Z`. Dates without a time are
  `YYYY-MM-DD`.
- **API-8** Collections whose size is bounded by admin effort (events, holidays) MAY be returned as a plain
  array. Collections that can grow without bound (logs, submissions over time) MUST paginate with
  `?limit=<1..200>&cursor=<opaque>` and return `{ "items": [...], "nextCursor": "<opaque>" | null }`.
- **API-9** The server never sets CORS headers and never answers preflight requests with permission
  ([SEC-6](#103-csrf-and-cors)).

### 6.3 OpenAPI

- **API-10** Every route under `/api/` MUST declare TypeBox schemas for `params`, `querystring`, `body` (when
  present) and `response` (every success status, plus `default` referencing the shared `ErrorBody` schema).
  Request schemas MUST set `additionalProperties: false`. Semantic validation (cross-field rules, translated
  messages) still runs through the shared validators in `src/lib/validation.ts`, after the schema check.
- **API-11** Register `@fastify/swagger` in `server/openapi.ts` **before** any route, with
  `openapi: { openapi: '3.1.0', info: { title: '<App Name> API', version: <package.json version> } }`.
  Serve the generated document at `GET /api/openapi.json` (public, `hide: true` so it does not describe
  itself). Every route sets:
  - `operationId`: unique camelCase verb + noun (`listEvents`, `createAdminEvent`, `updateSettings`),
  - `tags`: `public`, `auth`, `admin`, or a resource name,
  - `summary`: one English sentence,
  - `security`: `[]` for public routes; `[{ sessionCookie: [], csrfHeader: [] }]` for state-changing admin
    routes and `[{ sessionCookie: [] }]` for admin reads.

  Declare the security schemes once:

  ```ts
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'agt_<app_snake>_session' },
      csrfHeader: { type: 'apiKey', in: 'header', name: 'x-agt-request', description: 'Must be "1".' },
    },
  }
  ```

  Multipart and binary endpoints describe their parts/content types in the schema (`consumes`,
  `produces`, or `content` objects) so the document is complete.
- **API-12** The OpenAPI `info.version` equals the app version. A breaking API change (removed field, renamed
  route, changed semantics) MUST bump the app's major version (VER-3), after a deprecation period (VER-10), and be
  listed in `CHANGELOG.md` with an upgrade note (VER-9).
- **API-13** A server test MUST build the app, fetch `/api/openapi.json`, and assert that:
  every `/api/` route registered on the app (except `hide: true` ones) appears in the document; every
  operation has a unique `operationId`, `tags`, a `2xx` response with a schema and a `default` error
  response; and the document's `openapi` field is `3.1.0`.
- **API-14** An interactive API UI (e.g. Swagger UI) is optional. If shipped, it MUST be bundled (no CDN),
  served only to a signed-in admin, and work under the unchanged CSP ([SEC-1](#101-response-headers)).

## 7. Data storage

### 7.1 Choosing the engine

- **DATA-1** Each app supports **exactly one** database engine, chosen at design time and recorded in the app
  registry, `AGENTS.md` and `README.md`. Do not add support for the other engine later; changing engines is a
  major version with a documented migration path.
- **DATA-2** Choose **SQLite** unless at least one of these is true, in which case choose **PostgreSQL**:
  - expected data (excluding uploaded files) larger than ~10 GB,
  - sustained concurrent writes from many users (more than a few writes per second), not only one admin
    plus moderated public submissions,
  - more than one app process or replica must share the data,
  - the app needs Postgres-specific features (row-level locking under contention, `LISTEN/NOTIFY`, advanced
    full-text search, JSONB indexing).

  Write the deciding reason in `AGENTS.md`.

### 7.2 Migrations

- **DATA-3** Schema changes are numbered plain-SQL files `server/migrations/NNNN_<description>.sql`, imported
  as text (esbuild `--loader:.sql=text`) and appended to `MIGRATIONS` in `server/db.ts`. Never edit or
  reorder a released migration; add a new one.
- **DATA-4** Migrations run automatically at startup, each in its own transaction. A database whose schema
  version is newer than the app supports MUST make the app refuse to start (SRV-8). Restoring an older backup
  runs the pending migrations on it.
- **DATA-5 (SQLite)** Record the version in `PRAGMA user_version`. On open set `journal_mode = WAL`,
  `foreign_keys = ON` and `busy_timeout = 5000`. The database file lives in `storage.dataDir`.
  Use `better-sqlite3`'s synchronous API and `db.transaction()`. Keep an `EXPECTED_TABLES` list used to check
  restored databases.
- **DATA-5 (PostgreSQL)** Record versions in a `schema_migrations (version integer primary key, name text not
  null, applied_at timestamptz not null default now())` table. Take `pg_advisory_lock(<app-specific constant>)`
  while migrating so concurrent starts are safe. Use a single `pg.Pool`. Wrap multi-statement writes in a
  `withTransaction(pool, async (client) => …)` helper that always releases the client. Use
  `timestamptz` for instants, `uuid` for IDs and `text` rather than `varchar(n)`.

### 7.3 IDs, times and files

- **DATA-6** New records get `crypto.randomUUID()` (UUIDv4), stored lowercase. Validate incoming IDs with a
  shared `isUuidV4()`. Never use auto-increment integers as public IDs. Legacy IDs from imports MAY be kept
  in a separate `legacy_id` column for redirects, but are never a key.
- **DATA-7** Store instants in UTC (SQLite: ISO 8601 text with `Z`; Postgres: `timestamptz`). Convert to the
  user's time zone only in the UI.
- **DATA-8** Every table has `created_at` and `updated_at`, except pure join or log tables.
- **DATA-9** Uploaded files are stored on disk under `storage.dataDir/<uploadsDir>` with server-generated
  names `<uuid>.<ext>`, never in the database and never under the client-supplied name. The database stores
  the ID, detected MIME type, size and SHA-256.
- **DATA-10** All persistent state (database, log store, uploads, automatic backups) lives under one data directory:
  `/app/data` in Docker (one named volume), `/var/lib/agt-<app>` for local installs. Postgres data lives in
  its own volume or cluster.

## 8. Configuration

### 8.1 Sources

- **CFG-1** Configuration comes from exactly three places:

  | Source | Contains | Location |
  | --- | --- | --- |
  | `config.yaml` | Everything that is not secret | Docker: `./config.yaml` mounted read-only at `/app/config.yaml`. Local: `/etc/agt-<app>/config.yaml` |
  | `.env` | Secrets and first-run bootstrap values only | Docker: `env_file: .env`. Local: `/etc/agt-<app>/.env` via systemd `EnvironmentFile=` |
  | Dashboard settings | Keys listed in `EDITABLE_SETTINGS`, stored in the `settings` table | Database |

- **CFG-2** Environment variables are limited to this set. Do not add others without changing this spec.

  | Variable | Set by | Purpose |
  | --- | --- | --- |
  | `AGT_<APP>_SETUP_PASSWORD` | Operator (`.env`) | First-run setup only ([§9](#9-authentication-and-first-run)) |
  | `AGT_<APP>_DB_PASSWORD` | Operator (`.env`) | Postgres apps only |
  | `AGT_<APP>_CONFIG_FILE` | Dockerfile / systemd unit | Path of `config.yaml` (default `./config.yaml`) |
  | `AGT_<APP>_DATABASE_HOST` | `docker-compose.yml` | Postgres apps only; default host when `database.host` is not in `config.yaml` |
  | `AGT_<APP>_STATIC_DIR` | Development only | Override path to `dist/` |
  | `NODE_ENV` | Dockerfile / systemd unit | `production` |

  Other secrets the app needs (third-party keys are rare, because there are no outbound requests) follow the
  `AGT_<APP>_<NAME>` pattern and belong in `.env`.
- **CFG-3** `config.yaml` is validated at startup against a TypeBox schema in `server/config.ts`. Every key is
  optional and has a default. Unknown keys and invalid values MUST stop the server with a message naming the
  key (e.g. `Invalid config.yaml: server.prot: Unexpected property`). A missing file means "all defaults" and
  logs a warning. The app MUST NOT write to `config.yaml`.
- **CFG-4** `config.example.yaml` documents every key, commented out, with its default and a one-line
  description, grouped as in the template below. It states that secrets go in `.env` and that the config file
  wins over the dashboard.
- **CFG-5** Standard keys (use these names; add app-specific groups after `site`):

  ```yaml
  # Config-file-only keys
  # server:
  #   host: 0.0.0.0
  #   port: <registry port>
  #   trustProxy: false          # true, or proxy IP/CIDR (string or list)
  #   logLevel: info             # fatal|error|warn|info|debug|trace|silent
  # storage:
  #   dataDir: data              # relative to the working directory
  #   databaseFile: agt-<app>.sqlite   # SQLite apps; relative to dataDir
  #   uploadsDir: uploads        # relative to dataDir
  #   backupsDir: backups        # relative to dataDir
  #   logDatabaseFile: logs.sqlite     # SQLite apps; log store (LOG-1), relative to dataDir
  # database:                    # Postgres apps only; password is AGT_<APP>_DB_PASSWORD in .env
  #   host: localhost
  #   port: 5432
  #   name: agt_<app_snake>
  #   user: agt_<app_snake>
  # session:
  #   ttlHours: 12
  #   secureCookie: auto         # auto|true|false
  # rateLimits:
  #   login:   { max: 10, windowMinutes: 15 }
  #   setup:   { max: 10, windowMinutes: 15 }
  #   adminUploads: { max: 120, windowMinutes: 15 }
  # altcha:                      # apps with anonymous writes
  #   hmacKey: <generated if unset, ≥ 32 chars>
  #   cost: 5000
  #   challengeTtlSeconds: 600
  #
  # Keys that can also be set in the dashboard
  # site:
  #   title: <App Name>
  #   supportUrl: https://www.nms-agt.com/support
  # uploads:
  #   maxImageBytes: 10485760    # capped at 10 MB
  # backup:
  #   maxZipBytes: 209715200
  #   maxUncompressedBytes: 1073741824
  #   maxEntries: 10000
  # logs:                        # retention (LOG-16)
  #   serverRetentionDays: 30
  #   serverMaxEntries: 100000
  #   auditRetentionDays: 365    # at least 30
  #   auditMaxEntries: 1000000
  ```

### 8.2 Dashboard settings and precedence

- **CFG-6** Every app MUST have a **Settings** tab in the admin dashboard. `server/config.ts` exports
  `EDITABLE_SETTINGS`: a map from dotted key (`site.title`) to `{ schema, default, description }`. Only these
  keys can be stored in the `settings` table (value as JSON).
- **CFG-7** The effective value of a setting is: **config file > dashboard > default**. Compute it in one
  place (`settingStates()` / `setting()` in `server/context.ts`). Every state carries
  `{ key, value, source: 'config' | 'dashboard' | 'default', locked, default, description }`.
- **CFG-8** The server enforces precedence. `PUT /api/admin/settings` with `{ values: { key: value | null } }`
  rejects the whole request with `409 defined_in_config` (message: "`<key>` is defined in the configuration
  file and cannot be changed from the dashboard.") if any key is locked; `400 unknown_setting` for keys not in
  `EDITABLE_SETTINGS`; `400 invalid_setting` for schema failures. `null` resets to default. Any other code
  path that writes `settings` (restore, import, bulk update) MUST skip locked keys and report them.
- **CFG-9** The Settings tab shows locked keys read-only with the label "Set in the configuration file".
- **CFG-10** Settings the public UI needs are exposed through `GET /api/settings/public`, which returns only
  non-sensitive values (title, support URL, feature flags, limits).

## 9. Authentication and first run

### 9.1 The admin account

- **AUTH-1** There is exactly one admin account per instance, in an `admin` table constrained to one row
  (`id INTEGER PRIMARY KEY CHECK (id = 1)` in SQLite; equivalent check in Postgres). There are no other
  users, roles or self-registration. Public visitors are anonymous.
- **AUTH-2** Passwords are hashed with Node's built-in scrypt: `N = 2^15, r = 8, p = 1`, 16-byte random salt,
  64-byte key, input normalized with NFKC, stored as `scrypt$N$r$p$<salt b64>$<hash b64>`. Plaintext passwords
  are never stored or logged.
- **AUTH-3** Admin passwords MUST be 12–1024 characters. Compare secrets (setup password, usernames) with a
  constant-time function. On login, verify against a dummy hash when no admin exists, so timing does not
  reveal whether setup has run. Return the same `401 invalid_credentials` for a wrong username or password.
- **AUTH-4** Changing the password (`POST /api/admin/password`, requires the current password) ends every
  session and starts a new one for the caller.

### 9.2 First-run setup

- **AUTH-5** First run is protected by a setup password read from `AGT_<APP>_SETUP_PASSWORD` in `.env`.
  The flow MUST be:
  1. `GET /api/setup/status` → `{ adminExists, setupPasswordConfigured }`.
  2. While no admin exists, `/admin` shows the setup screen: setup password, admin username, new password,
     confirmation. If the variable is unset or empty, the screen shows "Setup is unavailable:
     AGT_<APP>_SETUP_PASSWORD is not set. Set it in .env and restart." and `POST /api/setup` returns
     `503 setup_password_missing`.
  3. `POST /api/setup { setupPassword, username, password }` (CSRF header required, rate limited):
     `401 invalid_setup_password` if wrong; `400 validation_failed` if the username is empty, the password is
     too short, or **the password equals the setup password** (it cannot be reused); `410 setup_complete` once
     an admin exists, **even if the variable is still set**. On success it creates the admin, signs them in
     and returns `201 { username }`.
  4. The setup password never becomes the admin password and is never stored.
- **AUTH-6** After setup the operator MUST be told to remove the variable, in all four places:
  - the server log, once on success: "Admin account created. Remove AGT_<APP>_SETUP_PASSWORD from .env and
    restart.";
  - the server log, **at every startup** while an admin exists and the variable is still set (warning);
  - the admin dashboard, as a persistent warning banner while it is still set
    (`GET /api/admin/session` returns `setupPasswordStillSet`);
  - `README.md` and `.env.example`, in the First run section.
- **AUTH-7** Recovery from a lost admin password is documented in Troubleshooting: restore a backup, or delete
  the admin row and sessions with the database CLI, set the setup password and restart.

### 9.3 Sessions

- **AUTH-8** Sessions are opaque random tokens (32 bytes, base64url) in the cookie `agt_<app_snake>_session`
  with `HttpOnly`, `SameSite=Strict`, `Path=/` and `Secure` per `session.secureCookie` (`auto` = when the
  request is HTTPS, which needs `trustProxy` behind a proxy). Only the SHA-256 of the token is stored, with
  an expiry of `session.ttlHours`. Expired sessions are rejected and purged (e.g. whenever a new session is
  created). A backup never contains sessions.
- **AUTH-9** All `/api/admin/*` routes except `login` require a valid session (`401 unauthorized`
  otherwise), enforced by one `onRequest` hook in `adminRoutes.ts`, not per route.

## 10. Security baseline

### 10.1 Response headers

- **SEC-1** Every response carries this exact Content-Security-Policy. Apps MAY narrow it (e.g. drop
  `http:`/`https:` from `img-src` when they do not render external images) but MUST NOT widen it, and MUST
  NOT add `'unsafe-inline'`, `'unsafe-eval'` or any external host to `script-src`/`style-src`/`connect-src`.

  ```text
  default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http: blob:;
  font-src 'self'; connect-src 'self'; media-src 'self'; worker-src 'self'; object-src 'none';
  base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  ```

- **SEC-2** Also on every response: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`.
- **SEC-3** API and HTML responses: `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`,
  `Pragma: no-cache`, `Expires: 0` (hashed `/assets/` excepted, SRV-9).

### 10.2 Transport and proxies

- **SEC-4** Apps serve plain HTTP only and document a TLS-terminating reverse proxy (Caddy example in
  `deploy/Caddyfile.example`). `server.trustProxy` controls `X-Forwarded-*` trust; default `false`.

### 10.3 CSRF and CORS

- **SEC-5** Every state-changing request to `/api/setup`, `/api/admin/*` (including login and logout) MUST
  carry `x-agt-request: 1`, otherwise `403 csrf`. Combined with `SameSite=Strict` cookies and no CORS, this
  blocks cross-site requests. The browser client adds the header automatically for non-GET requests.
- **SEC-6** Never register `@fastify/cors` or send `Access-Control-Allow-*` headers.

### 10.4 Rate limits

- **SEC-7** Register `@fastify/rate-limit` with `global: false` and apply per-route limits, configurable in
  `config.yaml`: login and password change (10 / 15 min), setup (10 / 15 min), admin uploads (120 / 15 min),
  every anonymous write (default 5 / 60 min, dashboard-editable), captcha challenges (60 / min). Rate-limit
  responses use the error body with `429 rate_limited`.

### 10.5 Secrets

- **SEC-8** Secrets live only in `.env` (or, for generated secrets such as the ALTCHA HMAC key, in an
  `app_secrets` table). They never appear in `config.yaml`, logs, API responses, the OpenAPI document,
  error messages or the client bundle. `.env` is never included in backups.

### 10.6 User content

- **SEC-9** **Uploads.** Accept only PNG, JPEG, WebP and GIF, detected by magic bytes; reject a declared
  `Content-Type` or extension that does not match the detected type. **Never accept SVG** (or HTML, PDF,
  etc. unless the app's purpose requires it and this spec is extended). Maximum 10 MB per image, enforced
  while streaming (`@fastify/multipart` limits). Serve stored files with the detected `Content-Type`,
  `Content-Disposition: inline` and `nosniff`. Images attached to unpublished content are visible only to the
  admin.
- **SEC-10** **Archives.** Read ZIPs only through `server/zip.ts`, which rejects absolute paths, `..`
  segments, symbolic links, too many entries, too large a total uncompressed size, and entries outside an
  allowlist of expected paths. Stream uploads to a temp directory under `backupsDir` and always delete it.
- **SEC-11** **Rendering.** Never use `dangerouslySetInnerHTML` for user- or admin-supplied content. React's
  escaping is the default defence.
- **SEC-12** **Markdown.** Render Markdown only through one `src/components/Markdown.tsx` component using
  `react-markdown` + `remark-gfm` with: a remark plugin that turns raw HTML nodes into text, never
  `rehype-raw` or any plugin that creates elements from HTML; `urlTransform` that keeps only `http:` and
  `https:` URLs; external images rendered with `loading="lazy"`, `referrerPolicy="no-referrer"` and a fallback
  when they fail. Store Markdown exactly as written.
- **SEC-13** **Links.** User-supplied URLs are accepted only with `http:`/`https:` schemes and rendered with
  `rel="noopener noreferrer"` and `target="_blank"`.

### 10.7 No outbound traffic

- **SEC-14** The server MUST NOT make outbound network requests (no `fetch`, webhooks, update checks,
  telemetry, avatar/image proxying, remote fonts). The client loads only same-origin files, except external
  images that authors put in Markdown where the app allows it (README must say that visitors' browsers load
  those directly).

### 10.8 Containers and processes

- **SEC-15** The container runs as the non-root `node` user with `read_only: true`, `tmpfs: /tmp`,
  `security_opt: no-new-privileges:true`, and only the data volume writable. The systemd unit uses the
  hardening in [§18.2](#182-local-installation-ubuntu--debian).

## 11. Anonymous input and ALTCHA

- **ALT-1** Any endpoint that accepts writes from anonymous visitors (submissions, reports, contact forms)
  MUST require a self-hosted ALTCHA proof-of-work solution **and** a rate limit (SEC-7). Apps with no
  anonymous writes do not include ALTCHA.
- **ALT-2** Server: `GET /api/altcha/challenge` issues challenges with `altcha-lib` (SHA-256, cost and TTL
  from `altcha.*`). The HMAC key comes from `altcha.hmacKey` in `config.yaml` or is generated once (32 random
  bytes) and stored in `app_secrets`. Each solved challenge is accepted **once** (atomically insert
  each used challenge ID with its expiry into an `altcha_used` table and purge expired rows); expired challenges are
  rejected with `400 captcha_failed` and a message telling the user to verify again.
- **ALT-3** Client: the `altcha` widget is bundled and lazy-loaded only when the form opens; its
  proof-of-work worker is a same-origin bundled worker (`worker-src 'self'`). Style it with the
  `--altcha-*` variables mapped to AGT tokens. Never load the widget from a CDN.
- **ALT-4** Anonymous submissions MUST NOT ask for email addresses or other personal data beyond what the
  feature strictly needs. If an identifier is needed, use the submitter's AGT username, shown only to the
  admin. Anonymous content is stored as `pending` and is public only after admin approval in a
  **Moderation queue** tab (Approve / Reject / Edit).
- **ALT-5** When the admin turns the feature off (`<feature>.enabled: false`), the server rejects the writes
  and challenge requests with `403 <feature>_closed`, and the UI shows that the feature is closed instead of
  hiding it silently.

## 12. Backup and restore

- **BAK-1** Every app MUST provide **Backup & restore** in the admin dashboard, backed by
  `GET /api/admin/backup` (download) and `POST /api/admin/restore` (multipart `backup` file +
  `action=preview|restore`).
- **BAK-2** A backup is one ZIP named `agt-<app>-backup-<ISO timestamp with : and . replaced by ->.zip`:

  ```text
  manifest.json        # { format: "agt-<app>-backup", formatVersion, appVersion, schemaVersion,
                       #   createdAt, files: [{ path, size, sha256 }] }
  database.sqlite      # SQLite apps: online-backup snapshot, sessions deleted, VACUUMed, journal_mode DELETE
  database.dump        # Postgres apps: pg_dump --format=custom (sessions table data excluded)
  uploads/<uuid>.<ext> # every stored upload
  config.yaml          # the current file, byte for byte, if one exists
  ```

  `.env` and the log store (LOG-17) are never included. The README warns that backups contain the admin
  password hash and generated secrets and must be stored securely.
- **BAK-3** Restore MUST first run a **preview** that validates without changing anything: manifest format
  and checksums, only expected paths, size and entry limits, database integrity (`PRAGMA integrity_check` /
  `pg_restore --list`), schema version (older → will be migrated; newer → refused), required tables, and
  every upload through the image checks. The preview reports counts, warnings and how the backup's
  `config.yaml` differs from the current one.
- **BAK-4** Restore then: writes an automatic pre-restore backup to
  `<backupsDir>/pre-restore-backup-<timestamp>.zip` and keeps it; replaces the database and uploads so that a
  failure leaves the instance unchanged (SQLite: prepare files beside the live ones, then rename-swap and
  reopen `context.db`; Postgres: `pg_restore --clean --if-exists --single-transaction --no-owner`); runs pending
  migrations; drops dashboard settings for keys now locked by `config.yaml` and lists them in the report;
  ends all sessions (the restored admin account replaces the current one) and signs the caller out. The log
  store is left untouched, and the restore itself is audited (LOG-17).
- **BAK-5** Restore MUST NEVER write `config.yaml`. If the backup contains one, the preview shows a line diff
  and offers it for download; the README explains how to put it in place by hand.
- **BAK-6** Postgres apps run `pg_dump`/`pg_restore` as child processes with the password in the `PGPASSWORD`
  environment variable of the child (never on the command line), and the client version MUST be ≥ the server
  major version.

## 13. Logging

Every app keeps two logs, stored in the database and shown in the admin dashboard:

| | Server log | Audit log |
| --- | --- | --- |
| Contains | Events **not** caused by a user: startup, shutdown, migrations, scheduled jobs, configuration warnings, internal errors | Events **caused by a user**, admin or anonymous: every state-changing request, sensitive reads, sign-ins, submissions, and rejected or denied attempts |
| Purpose | Debugging; showing warnings and errors to the admin | Accountability: who did what, when, with what outcome |
| Admin can | Filter, search, export, clear | Filter, search, export. **Never** edit or clear it |

Rule of thumb: if a request caused it, it belongs in the audit log; if the server did it by itself, it belongs in
the server log. When a user's request fails because of an internal error, both logs get an entry: the audit entry
records the outcome, the server log entry records the error. The two share the request ID.

### 13.1 Storage

- **LOG-1** Both logs are stored in a **log store** separate from the app's data, so backups and restores never
  touch them (LOG-17):
  - SQLite apps: a second SQLite file, `storage.logDatabaseFile` (default `logs.sqlite`, relative to `dataDir`),
    opened with the same pragmas as the main database (DATA-5).
  - Postgres apps: a `logs` schema in the app's database.

  The log store has its own numbered migrations in `server/migrations/logs/NNNN_*.sql`, listed in `LOG_MIGRATIONS`
  and run at startup like DATA-3/DATA-4. It also holds a `log_meta` key-value table (the IP-hash key and the
  server-log "seen" marker).
- **LOG-2** Log tables are append-only from the application's point of view: rows are never updated, except the
  `count`/`last_at` columns of a coalesced audit entry (LOG-11), and are deleted only by retention (LOG-15) or, for
  the server log only, by the admin (LOG-20). Log tables are exempt from DATA-8.
- **LOG-3** A failure to write a log entry MUST NOT fail the request or crash the server. Report it once to
  stdout (never recursively into the server log) and carry on.
- **LOG-4** Times are UTC (`at`, and `last_at` for audit entries). Every entry has a UUIDv4 `id`. Index both
  tables on `at` and on every column the admin can filter by.

### 13.2 Server log

- **LOG-5** Create the logger with `pino` (a direct dependency, same major version as the one Fastify uses),
  writing through `pino.multistream` to stdout **and** to a stream that inserts entries into the log store, and pass
  it to Fastify as `loggerInstance`. stdout follows `server.logLevel`. The log store receives **info and above**
  (`info`, `warn`, `error`, `fatal`), whatever `server.logLevel` is. `debug` and `trace` go to stdout only.
- **LOG-6** Per-request access logs ("incoming request", "request completed") are **not** stored in the server
  log: they describe user activity, which the audit log covers. Set `disableRequestLogging: true` or filter them out
  of the log-store stream.
- **LOG-7** A server log entry has: `id`, `at`, `level`, `source`, `message`, `requestId` (when the event happened
  while handling a request, e.g. a 500), and `details` (JSON). `source` is a short stable name of the subsystem:
  `startup`, `shutdown`, `config`, `migrations`, `retention`, `backup`, `http` (unexpected errors while handling a
  request), or an app-specific one. Messages are English.
- **LOG-8** At minimum the server log records: startup (app version, schema versions, listen address, config file
  found or defaults used); configuration warnings (including the setup-password reminders of AUTH-6); every
  migration applied; each retention run that deleted entries (with counts); every unexpected error (5xx), with the
  error message and stack in `details`; failures of background work; shutdown.
- **LOG-9** SRV-6 and SEC-8 apply in full: no passwords, setup passwords, tokens, cookies, keys, database passwords
  or request bodies in `message` or `details`. Error details contain only the error's name, message, stack and the
  route; never the request headers or body.

### 13.3 Audit log

- **LOG-10** An audit entry has:

  | Field | Content |
  | --- | --- |
  | `id`, `at`, `last_at`, `count` | ID; first and last time; number of identical events (`count` is 1 unless coalesced, LOG-11) |
  | `actor_type` | `admin` (valid session) or `anonymous` |
  | `actor` | Admin: the username. Anonymous: an identifier the feature already collects (e.g. the submitter's AGT username), else null |
  | `ip_hash` | Pseudonymous client address (LOG-12). Never the raw IP |
  | `client` | `web` when the request came from the app's own UI (LOG-13), otherwise `api` |
  | `action` | The route's OpenAPI `operationId` (e.g. `createAdminEvent`, `login`, `submitEvent`) |
  | `method`, `route` | HTTP method and the route pattern (`/api/admin/events/:id`), never the full URL with query |
  | `target_type`, `target_id` | The affected resource (e.g. `event` and its UUID), when there is one |
  | `outcome` | `success` (2xx/3xx), `denied` (401, 403), `rate_limited` (429) or `failure` (any other 4xx/5xx) |
  | `status_code`, `request_id` | HTTP status; Fastify request ID, shared with any server log entry for the same request |
  | `details` | JSON summary of the change, never the full payload (LOG-14) |

- **LOG-11** **What is audited.** Audit through one `onResponse` hook (in `server/audit.ts`), not by hand in each
  handler, so no route can be forgotten:
  - every request to a non-GET `/api/` route, whatever the client and whatever the outcome; this includes
    successful and failed setup, login and logout, anonymous submissions, and every admin change;
  - GET routes marked `config: { audit: true }`: sensitive reads such as backup downloads and log exports;
  - every 401 or 403 response from an `/api/admin/` route, and every 429 response from any route, including GET
    routes that are otherwise not audited.

  Ordinary reads (lists, details, health, the OpenAPI document) and unknown routes are not audited. Handlers add
  the target and details by setting `request.audit` (`{ targetType, targetId, actor, details }`); the hook fills in
  everything else.

  **Coalescing.** Entries whose outcome is not `success` are coalesced: if an entry with the same `action`,
  `outcome`, `status_code` and `ip_hash` was written in the last 60 seconds, increment its `count` and set `last_at`
  instead of inserting a new row. This keeps floods of failed logins or rate-limited requests from filling the log.
- **LOG-12** **IP pseudonymization.** `ip_hash` = the first 16 hex characters of HMAC-SHA256(key, address), where
  `key` is 32 random bytes generated once and stored in `log_meta`, and `address` is `request.ip` (which honours
  `server.trustProxy`). Normalize IPv4-mapped IPv6 addresses to IPv4. For IPv6, hash only the /64 prefix, because
  clients rotate addresses inside their /64. The raw IP is never stored or logged, in either log. Because the key
  lives in the log store, hashes stay comparable across restores.
- **LOG-13** `apiRequest()` (FE-2) sends `x-agt-client: web` on every request, and the hook records `client: web`
  when it is present. This header is informational only: it is easy to forge, and never affects authorization.
- **LOG-14** `details` summarizes what changed and MUST NOT contain secrets (SEC-8) or bulk content:
  - Settings changes: each key with its old and new value.
  - Create/replace: the resource's name or title and the changed field names, not the field values (Markdown
    bodies, descriptions and file contents are never copied into the log).
  - Uploads, imports, restores: file size, detected type and the counts from the report.
  - Validation failures: the field names that failed, not the submitted values.
  - Password changes and setup: only that they happened.

### 13.4 Retention

- **LOG-15** A retention job runs at startup and then every hour (`setInterval(...).unref()`). It deletes entries
  older than the retention period, then, if a log still has more entries than its cap, deletes the oldest until it
  is at the cap. For the audit log, the cap removes the oldest `denied`, `rate_limited` and `failure` entries first,
  and the oldest `success` entries only when there are none left. Each run that deletes anything writes one server
  log entry with the counts.
- **LOG-16** Retention is configured with these dashboard-editable settings (CFG-6, config file wins):

  | Key | Default | Allowed |
  | --- | --- | --- |
  | `logs.serverRetentionDays` | `30` | 1–3650 |
  | `logs.serverMaxEntries` | `100000` | 1000–10000000 |
  | `logs.auditRetentionDays` | `365` | 30–3650 |
  | `logs.auditMaxEntries` | `1000000` | 10000–10000000 |

  The audit minimum of 30 days stops an admin from erasing recent audit history by shortening retention. Changing
  these settings is itself audited (it is a settings change).

### 13.5 Backups

- **LOG-17** Backups do **not** contain either log, and restore never changes the log store. A restore is audited
  like any other request, so the audit log keeps the record of the restore and of everything before it. The README
  says that logs are not part of backups.

### 13.6 Admin dashboard

- **LOG-18** The dashboard has two tabs, **Server log** and **Audit log** (UI-8), backed by these admin routes
  (session required; full schemas per API-10; both lists paginate per API-8, newest first):

  | Route | Purpose |
  | --- | --- |
  | `GET /api/admin/logs/server` | List with filters `level` (minimum level), `source`, `from`, `to`, `q` (text in message), `limit`, `cursor` |
  | `GET /api/admin/logs/server/export` | Same filters plus `format=jsonl\|csv`; download (`config.audit: true`) |
  | `GET /api/admin/logs/server/summary` | `{ unseenWarnings, unseenErrors }` since the last "seen" marker |
  | `POST /api/admin/logs/server/seen` | Sets the "seen" marker to now |
  | `DELETE /api/admin/logs/server` | Clears the server log; `204` (audited like every write) |
  | `GET /api/admin/logs/audit` | List with filters `actorType`, `action`, `outcome`, `targetType`, `targetId`, `from`, `to`, `q` (text in actor, action, target and details), `limit`, `cursor` |
  | `GET /api/admin/logs/audit/export` | Same filters plus `format=jsonl\|csv`; download (`config.audit: true`) |

  There is no route that edits or deletes audit entries.
- **LOG-19** Both tabs show a table (time in the user's time zone, plus the columns of LOG-7 or LOG-10), the filters
  above, paging, and an **Export** button that downloads the current filter as JSON Lines or CSV. Clicking an
  entry shows its `details`. Levels and outcomes use colour and text (never colour alone): `error`/`fatal`/`failure`
  in `--agt-red`, `warn`/`denied`/`rate_limited` in `--agt-orange`. Action codes are shown as they are (they are
  stable identifiers); column and filter labels are translated (I18N-3).
- **LOG-20** The Server log tab has a **Clear log** button that asks for confirmation. The Audit log tab has no
  delete or clear control.
- **LOG-21** **Error badge.** While there are unseen `warn` or higher entries, the Server log tab shows a badge with
  their count (`.admin-badge`; red when any are `error` or `fatal`), and the admin header shows a link to the tab.
  Opening the tab calls `POST /api/admin/logs/server/seen`. Poll the summary when the dashboard loads and when tabs
  change. Don't poll in the background.
- **LOG-22** Exports are generated on the server, streamed, and named `agt-<app>-<server|audit>-log-<timestamp>.<ext>`.
  CSV exports MUST neutralize spreadsheet formulas: prefix any cell that starts with `=`, `+`, `-`, `@`, tab or
  carriage return with a single quote.

### 13.7 Privacy

- **LOG-23** The README documents what both logs contain: the audit log holds pseudonymous IP hashes, admin
  usernames and identifiers that anonymous features collect, for `logs.auditRetentionDays`. Public forms that write
  to the audit log SHOULD say, in one translated sentence, that submissions are logged with a pseudonymous network
  identifier for abuse prevention.

## 14. Frontend architecture

- **FE-1** Two Vite entries: `index.html` (public UI, `src/main.tsx`) and `admin.html` (admin dashboard,
  `src/admin/main.tsx`, `<meta name="robots" content="noindex">`). Both set `lang`, the viewport meta,
  `<meta name="theme-color" content="#0a0a0a">` and the AGT logo favicon. The admin bundle MUST NOT be
  imported by the public entry.
- **FE-2** All API calls go through `apiRequest()` in `src/lib/client.ts`: same-origin, `cache: 'no-store'`,
  `credentials: 'same-origin'`, JSON in/out, adds the CSRF header for non-GET requests and `x-agt-client: web` to
  every request (LOG-13), and throws
  `ApiError(status, message, code, fields)` built from the error body. API types live in `src/lib/api.ts`.
- **FE-3** Server data is never persisted on the client (no service workers, no IndexedDB/localStorage
  caches of API data). `localStorage` holds only user preferences and user-owned lists (e.g. bookmarks) under
  `agt_<app_snake>_*` keys, read defensively (invalid JSON → defaults).
- **FE-4** Deep links use query parameters on `/` (e.g. `?event_id=<uuid>`), not paths, and are rewritten
  with `history.replaceState` when normalized.
- **FE-5** Every load and mutation has visible loading, success and error states. Errors show the server's
  `message` (and per-field `fields` next to the fields). Long operations (import, restore) show a preview
  first and require an explicit confirm.
- **FE-6** Forms validate with the same `src/lib/validation.ts` functions the server uses, so messages match.
  The server remains the authority.
- **FE-7** Icons are inline React SVG components in `src/components/Icons.tsx` (`aria-hidden="true"`), never
  an icon font or external sprite.
- **FE-8** Framework-free logic (date math, filtering, parsing, validation, settings) lives in `src/lib/`
  with unit tests; components stay thin.

## 15. Visual design system

The AGT look is dark, high-contrast, orange-on-black with red accents, matching the AGT brand.
All AGT apps MUST look like one family.

### 15.1 Tokens

- **UI-1** `src/styles.css` MUST start with this block, verbatim. `src/admin/admin.css` imports or repeats
  it. Use tokens (`var(--…)`) instead of raw colours in component CSS; add new tokens to this spec first.

  ```css
  :root {
    color-scheme: dark;
    font-family: 'NMS Futura', Inter, ui-sans-serif, system-ui, sans-serif;
    color: #ffb451;
    background: #0a0a0a;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    --agt-orange: #ffb451;      /* primary text accent, links, focus ring */
    --agt-red-orange: #e25530;  /* primary buttons, scrollbar */
    --agt-red: #ff0500;         /* borders of primary/selected elements, danger */
    --bg: #0a0a0a;              /* page background */
    --surface: #111111;         /* panels, cards */
    --surface-raised: #161616;  /* headers, buttons, inputs */
    --surface-soft: #1a1a1a;    /* hover / nested surfaces */
    --text: #f7f3ee;            /* body text */
    --muted: #a39c93;           /* secondary text, help text */
    --line: rgba(255, 5, 0, 0.22);        /* default borders */
    --line-strong: rgba(255, 5, 0, 0.55); /* emphasized borders, button borders */
    --radius-sm: 0.55rem;       /* buttons, inputs */
    --radius: 0.85rem;          /* panels, cards */
    --radius-lg: 1.15rem;       /* modals */
    --shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
  }
  ```

- **UI-2** The theme is dark only. Do not add a light theme.

### 15.2 Typography and assets

- **UI-3** Bundle fonts in `public/` and declare them with `@font-face` (`font-display: swap`):
  `NMS Futura` (`/NMSFuturaProBook_Kerned.ttf`) for UI text; a monospace stack
  (`ui-monospace, SFMono-Regular, Menlo, monospace`) for data, codes, timestamps and labels in tables;
  `Twemoji Country Flags` (`/fonts/TwemojiCountryFlags.woff2`, `unicode-range: U+1F1E6-1F1FF`, keep its
  CC BY 4.0 licence file) wherever flags are shown; `NMS Glyphs Mono` for portal codes (UI-14). The fallback
  stack must render Thai, Chinese, Hindi and Japanese (system fonts), because NMS Futura does not cover them.
- **UI-14** Portal codes MUST be displayed as No Man's Sky portal glyphs using the bundled **NMS Glyphs Mono**
  typeface, copied from the reference implementation (`public/NMS-Glyphs-Mono-fixed2026.ttf`; internal
  family name `NMS Glyphs`, style `Glyphs-Mono`). The font maps only the characters `0–9` and uppercase
  `A–F`, one glyph per hexadecimal digit. Rules:
  - Declare it once and use it only through the `.portal-glyphs` class, never as a general text font:

    ```css
    @font-face {
      font-family: 'NMS Glyphs Mono';
      src: url('/NMS-Glyphs-Mono-fixed2026.ttf') format('truetype');
      font-display: block; /* never flash the hex digits in a fallback font as if they were glyphs */
    }

    .portal-glyphs {
      font-family: 'NMS Glyphs Mono';
      font-size: 1.5em;
      line-height: 1;
      letter-spacing: 0.08em;
      font-variant-ligatures: none;
      white-space: nowrap;
    }
    ```

  - Render glyphs only for a valid code: exactly 12 hexadecimal digits after trimming and uppercasing
    (check with a shared `isPortalCode()` in `src/lib/`). Uppercase the code before rendering, because the
    font has no lowercase characters. Anything else (placeholders such as `TBA`, legacy values) is shown as
    plain text in the monospace stack, never in the glyph font.
  - Always show the hexadecimal code as text as well (`.portal-code-value`, monospace stack) next to the
    glyphs. The glyph element is `aria-hidden="true"` and `translate="no"`, so screen readers and translation
    tools get the hex text. Copy buttons, share links and exports use the hex text.
  - Glyphs inherit the text colour (`--agt-orange` by default); do not recolour individual glyphs.
  - Forms that accept a portal code take hex input in a normal text field and MAY show a live glyph preview
    using the same class.
- **UI-4** Headings and button labels are uppercase with wide letter spacing (`0.12em`) and heavy weight;
  body text is sentence case. Headings use `#fff`; body text uses `--text`; secondary text uses `--muted`.
- **UI-5** Use the official logo `public/AgtOfficialLogo.webp` as the favicon and in the header brand lockup
  (decorative: `alt=""` and `aria-hidden="true"` next to visible brand text). Copy brand assets from the
  reference implementation; never hotlink them.

### 15.3 Page chrome

- **UI-6** `html, body { min-width: 300px }`. The body background is `--bg` with two subtle radial gradients
  and a faint 40 px grid overlay (`body::before`, fading out towards the bottom), as in the reference
  `styles.css`.
- **UI-7** Public layout: a `site-header` with the brand lockup (logo, "Alliance of Galactic Travellers"
  brand name, product name) and a row of round icon buttons on the right (each with `aria-label` and
  `title`), then `<main id="main-content">`, then a `site-footer`. Include a support link to
  `site.supportUrl`, and a user settings button ([I18N-4](#17-internationalization)).
- **UI-8** Admin layout: `admin-shell` → `admin-header` (title, signed-in username, "View site" link, Sign
  out) → `admin-main` (max width 80 rem) → `admin-tabs` (a `role="tablist"` row of `.button`s;
  `aria-selected="true"` gets `--agt-red` border and a translucent red background; counts in `.admin-badge`)
  → one `admin-panel` per tab (`--surface`, `--line` border, `--radius`). Standard tabs, in order:
  resource tabs, **Moderation queue** (if anonymous writes), **Settings**, **Server log**, **Audit log**
  ([§13.6](#136-admin-dashboard)), **Backup & restore**, **Account** (change password). Import/migration tabs, if
  any, go before Backup & restore.

### 15.4 Components

- **UI-9** Use these class names and behaviours from the reference CSS (copy, don't reinvent):

  | Class | Use |
  | --- | --- |
  | `.button` | Default button: `--surface-raised`, `--line-strong` border, `--radius-sm`, orange uppercase 0.65 rem bold text, min-height 2.45 rem |
  | `.button-primary` | One per view: white text on `--agt-red-orange`, `--agt-red` border |
  | `.button-secondary`, `.button-icon` | Secondary actions; square icon-only buttons (need `aria-label`) |
  | `.field` (`> span` label, input/select/textarea), `.field-help`, `.field-error`, `[aria-invalid='true']` | Form fields |
  | `.modal-backdrop`, `.modal-header`, `.modal-close`, `.modal-scroll-region`, `.modal-toast` | Dialogs |
  | `.error-note`, `.success-note`, `.admin-notice` (`.danger`) | Inline status messages |
  | `.sr-only` | Visually hidden text |

- **UI-10** Focus: `outline: 2px solid var(--agt-orange); outline-offset: 3px` on `:focus-visible` for all
  interactive elements. Never remove outlines without this replacement. Selection colour: black on
  `--agt-orange`. Scrollbars: thin, `--agt-red-orange` thumb.
- **UI-11** Transitions are 0.15 s ease on colour, background, border, transform and shadow. Wrap all
  animation in a `@media (prefers-reduced-motion: reduce)` override that disables it.
- **UI-12** Responsive breakpoints: `1180px`, `760px`, `520px` (public) and `640px` (forms/admin). Layouts
  MUST work from 300 px wide without horizontal page scrolling; wide tables scroll inside their container.
- **UI-13** Media and sound never auto-play with sound. Any ambient audio (like the AGT anthem) is off until
  the user turns it on, and the choice is stored in user settings.

## 16. Accessibility

- **A11Y-1** Target WCAG 2.2 AA. Text contrast ≥ 4.5:1 (the token pairs above meet it; check new pairs).
- **A11Y-2** Dialogs use the shared `useDialog(dialogRef, initialFocusRef, onClose)` hook: Escape closes,
  Tab is trapped, initial focus is set, focus returns to the opener, page scroll is locked. Dialogs have
  `role="dialog"`, `aria-modal="true"` and `aria-labelledby`. Openers set `aria-haspopup="dialog"` and
  `aria-expanded`.
- **A11Y-3** Every icon-only button has a translated `aria-label` (and matching `title`). Decorative images
  and icons are `aria-hidden="true"`.
- **A11Y-4** Status changes (loading, saved, errors, connection state) are announced with `role="status"` /
  `aria-live="polite"`; blocking errors use `role="alert"`.
- **A11Y-5** Every input has a visible label; errors are linked with `aria-invalid` and
  `aria-describedby`. Everything is operable by keyboard alone.
- **A11Y-6** Provide a user-selectable font scale (1×–2×) in user settings and size text in `rem`.

## 17. Internationalization

- **I18N-1** Every app ships all AGT locales, in this order (`value`, label, flag):

  | Code | Label | Flag |
  | --- | --- | --- |
  | `en` | English | 🇬🇧 |
  | `fr` | Français (French) | 🇫🇷 |
  | `de` | Deutsch (German) | 🇩🇪 |
  | `es` | Español (Spanish) | 🇪🇸 |
  | `pt` | Português (Portuguese (Brazilian)) | 🇧🇷 |
  | `it` | Italiano (Italian) | 🇮🇹 |
  | `th` | ไทย (Thai) | 🇹🇭 |
  | `zh` | 中文 (Mandarin Chinese) | 🇨🇳 |
  | `hi` | हिन्दी (Hindi) | 🇮🇳 |
  | `ja` | 日本語 (Japanese) | 🇯🇵 |

  Adding a locale means adding it to this table first, then to every app.
- **I18N-2** Public strings live in `src/translations.ts`: `export const LOCALES`, `type Locale`,
  `type Translations`, one object per locale, `TRANSLATIONS: Record<Locale, Translations>`,
  `getTranslations(locale)` (falls back to English) and `formatTranslation(template, values)` with
  `{{name}}` placeholders. Admin strings live in `src/admin/i18n.ts` with `getAdminTranslations(locale)`.
  Brand and product names that are never translated go in a `COMMON_TRANSLATIONS` object.
- **I18N-3** Components MUST NOT contain hard-coded user-visible text (including `aria-label`, `title`,
  placeholders and `alt`). Tests (`src/lib/translations.test.ts`, `src/lib/adminTranslations.test.ts`) MUST
  assert that every key in English exists, non-empty, in every locale. Translate new keys into all locales in
  the same change; never leave English copies as placeholders in other locales.
- **I18N-4** The public UI has a **Settings** dialog with at least language and font scale, plus time zone
  (`Auto` or a fixed UTC offset) if the app shows times. Preferences are stored in
  `localStorage["agt_<app_snake>_settings"]` and shared by the public UI and the admin dashboard. Default
  language: English (do not auto-detect unless the app's AGENTS.md says so).
- **I18N-5** Format dates, times and numbers with `Intl` using the chosen locale and time zone. Server error
  `message`s are English; the client may map known `error` codes to translated text.

## 18. Deployment

Installation instructions assume Ubuntu 24.04 LTS or Debian 12/13. Both methods MUST be documented in
`README.md` and kept working.

### 18.1 Docker Compose

- **DEP-1** `Dockerfile` (two stages; adjust `<APP>`):

  ```dockerfile
  # syntax=docker/dockerfile:1
  FROM node:24-bookworm-slim AS build
  RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY . .
  RUN npm run build && npm prune --omit=dev

  FROM node:24-bookworm-slim AS runtime
  # Postgres apps: install postgresql-client-<server major> from the PGDG apt repository here (BAK-6).
  ENV NODE_ENV=production \
      AGT_<APP>_CONFIG_FILE=/app/config.yaml
  WORKDIR /app
  COPY --from=build --chown=node:node /app/package.json ./
  COPY --from=build --chown=node:node /app/node_modules ./node_modules
  COPY --from=build --chown=node:node /app/dist ./dist
  COPY --from=build --chown=node:node /app/dist-server ./dist-server
  RUN mkdir -p /app/data && chown node:node /app/data
  USER node
  VOLUME ["/app/data"]
  EXPOSE <port>
  HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:<port>/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
  CMD ["node", "dist-server/index.mjs"]
  ```

- **DEP-2** `docker-compose.yml` (SQLite app):

  ```yaml
  services:
    <app>:
      build: .
      image: agt-<app>:latest
      restart: unless-stopped
      # Plain HTTP only. Put a TLS-terminating reverse proxy in front and set server.trustProxy.
      ports:
        - "<port>:<port>"
      env_file:
        - path: .env
          required: false
      volumes:
        - <app>-data:/app/data
        - ./config.yaml:/app/config.yaml:ro
      read_only: true
      tmpfs:
        - /tmp
      security_opt:
        - no-new-privileges:true
      healthcheck:
        test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:<port>/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
        interval: 30s
        timeout: 5s
        start_period: 15s
        retries: 3

  volumes:
    <app>-data:
  ```

  Because `./config.yaml` is bind-mounted, the README tells operators to create it
  (`cp config.example.yaml config.yaml`) before the first `docker compose up`.
- **DEP-3** Postgres apps add a database service and wire it up. Do not publish the database port.

  ```yaml
  services:
    <app>:
      # ...as above, plus:
      environment:
        AGT_<APP>_DATABASE_HOST: db
      depends_on:
        db:
          condition: service_healthy
    db:
      image: postgres:18-bookworm
      restart: unless-stopped
      environment:
        POSTGRES_DB: agt_<app_snake>
        POSTGRES_USER: agt_<app_snake>
        POSTGRES_PASSWORD: ${AGT_<APP>_DB_PASSWORD:?Set AGT_<APP>_DB_PASSWORD in .env}
      volumes:
        - <app>-db:/var/lib/postgresql
      security_opt:
        - no-new-privileges:true
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U agt_<app_snake> -d agt_<app_snake>"]
        interval: 10s
        timeout: 5s
        retries: 5

  volumes:
    <app>-data:
    <app>-db:
  ```

- **DEP-4** `.env.example` documents each variable with comments, including the first-run instructions:

  ```dotenv
  # <App Name> secrets and bootstrap values (.env)
  # Copy to .env. Never commit .env; it is never included in backups.

  # Temporary setup password, used ONLY on first run to create the single admin
  # account at /admin. It does not become the admin password.
  # After creating the admin account, REMOVE this line and restart
  # (docker compose up -d, or sudo systemctl restart agt-<app>).
  # While it is still set, the server logs a warning at every start.
  AGT_<APP>_SETUP_PASSWORD=

  # Postgres apps only: password of the agt_<app_snake> database role.
  # AGT_<APP>_DB_PASSWORD=
  ```

- **DEP-5** Upgrades (VER-13): read the CHANGELOG upgrade notes and download a backup, then
  `git fetch --tags && git checkout vX.Y.Z && docker compose up -d --build`. Migrations run at startup. Install
  instructions likewise check out the latest release tag after `git clone`.

### 18.2 Local installation (Ubuntu / Debian)

- **DEP-6** The local method is a systemd service. The README documents these steps (adapted per app):

  ```bash
  # 1. Node.js 24 from NodeSource, and build tools for native modules
  curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
  sudo -E bash /tmp/nodesource_setup.sh
  sudo apt-get install -y nodejs git build-essential python3

  # 2. System user and code
  sudo useradd --system --home-dir /var/lib/agt-<app> --shell /usr/sbin/nologin agt-<app>
  sudo git clone https://github.com/<owner>/agt_<app_snake>.git /opt/agt-<app>
  sudo git -C /opt/agt-<app> checkout vX.Y.Z   # the latest release (VER-13)
  cd /opt/agt-<app>
  sudo npm ci && sudo npm run build && sudo npm prune --omit=dev

  # 3. Configuration
  sudo mkdir -p /etc/agt-<app>
  sudo cp config.example.yaml /etc/agt-<app>/config.yaml
  sudo cp .env.example /etc/agt-<app>/.env
  sudo chmod 600 /etc/agt-<app>/.env
  # Edit /etc/agt-<app>/config.yaml: set storage.dataDir: /var/lib/agt-<app>
  # Edit /etc/agt-<app>/.env: set AGT_<APP>_SETUP_PASSWORD

  # 4. Service
  sudo cp deploy/agt-<app>.service /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable --now agt-<app>
  ```

  Postgres apps add: install PostgreSQL `<major>` from the PGDG apt repository
  (`sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh`,
  then `sudo apt-get install -y postgresql-<major>`), create the role and database
  (`sudo -u postgres createuser --pwprompt agt_<app_snake>` and
  `sudo -u postgres createdb --owner agt_<app_snake> agt_<app_snake>`), put the password in `.env` as
  `AGT_<APP>_DB_PASSWORD`, and add `After=postgresql.service` / `Wants=postgresql.service` to the unit.
- **DEP-7** `deploy/agt-<app>.service`:

  ```ini
  [Unit]
  Description=<App Name>
  After=network-online.target
  Wants=network-online.target

  [Service]
  Type=simple
  User=agt-<app>
  Group=agt-<app>
  WorkingDirectory=/opt/agt-<app>
  Environment=NODE_ENV=production
  Environment=AGT_<APP>_CONFIG_FILE=/etc/agt-<app>/config.yaml
  EnvironmentFile=-/etc/agt-<app>/.env
  ExecStart=/usr/bin/node dist-server/index.mjs
  Restart=on-failure
  RestartSec=5
  StateDirectory=agt-<app>
  StateDirectoryMode=0750
  UMask=0027
  NoNewPrivileges=true
  ProtectSystem=strict
  ProtectHome=true
  PrivateTmp=true
  PrivateDevices=true
  ProtectKernelTunables=true
  ProtectKernelModules=true
  ProtectControlGroups=true
  RestrictSUIDSGID=true
  RestrictNamespaces=true
  LockPersonality=true
  CapabilityBoundingSet=

  [Install]
  WantedBy=multi-user.target
  ```

  Do not add `MemoryDenyWriteExecute=true`: it breaks the V8 JIT.
- **DEP-8** The README's First run section gives the local equivalent of "remove the setup password and
  restart": delete the line from `/etc/agt-<app>/.env`, then `sudo systemctl restart agt-<app>`. Logs:
  `journalctl -u agt-<app>`.
- **DEP-9** Local upgrades (VER-13): read the CHANGELOG upgrade notes and download a backup, then
  `cd /opt/agt-<app> && sudo git fetch --tags && sudo git checkout vX.Y.Z && sudo npm ci && sudo npm run build &&
  sudo npm prune --omit=dev && sudo systemctl restart agt-<app>`.

### 18.3 TLS reverse proxy

- **DEP-10** `deploy/Caddyfile.example`:

  ```caddyfile
  <app>.example.org {
      reverse_proxy 127.0.0.1:<port>
  }
  ```

  With a proxy, set `server.trustProxy: 127.0.0.1` (local) or the proxy's address/CIDR (Docker network), and
  keep `session.secureCookie: auto`. When the proxy runs on the same host, bind the app to `127.0.0.1` or
  restrict the published port.

## 19. Testing and tooling

- **TEST-1** `package.json` scripts MUST be:

  | Script | Command |
  | --- | --- |
  | `dev` | `vite` (proxies `/api` to the server port) |
  | `dev:server` | `npm run build:server && node dist-server/index.mjs` |
  | `build` | `npm run build:client && npm run build:server` |
  | `build:client` | `tsc -b && vite build` |
  | `build:server` | `esbuild server/index.ts --bundle --platform=node --target=node24 --format=esm --packages=external --loader:.sql=text --outfile=dist-server/index.mjs` |
  | `start` | `node dist-server/index.mjs` |
  | `lint` | `tsc -b --pretty false` |
  | `test` | `npm run test:client && npm run test:server` |
  | `test:client` | esbuild `src/lib/*.test.ts` → `.test-build/client`, then `node --test` |
  | `test:server` | esbuild `server/test/*.test.ts` → `.test-build/server`, then `node --test --test-concurrency=1` |
  | `check` | `npm run lint && npm test && npm run build` |

- **TEST-2** `npm run check` MUST pass before every commit and in CI.
- **TEST-3** Client tests run in plain Node without a DOM; stub `globalThis.window` / `localStorage` where
  needed. Server tests use `createTestServer()` from `server/test/helpers.ts`, which creates a temp data dir,
  a cheap ALTCHA cost, and returns `{ app, context, close() }`; tests call `app.inject()` and close servers in
  `after()`. Postgres apps create a unique schema per test server in the database given by
  `AGT_<APP>_TEST_DATABASE_URL` and drop it on close.
- **TEST-4** Required test coverage, at minimum:
  - first-run setup: unset password (503), wrong password (401), reuse of setup password (400), missing CSRF
    header (403), success (201 + session), disabled after setup (410) even while the variable is set;
  - login, logout, session expiry, password change ends other sessions;
  - every admin route rejects requests without a session (401) and mutations without CSRF (403);
  - config: unknown key and invalid value rejected; precedence; `409 defined_in_config`;
  - OpenAPI completeness (API-13);
  - security headers and CSP present on HTML and API responses;
  - uploads: magic-byte detection, SVG rejected, mismatched type rejected, size limit;
  - ALTCHA (if present): valid, replayed, expired;
  - backup round trip; restore preview; tampered checksum rejected; newer schema refused; locked settings
    skipped; `config.yaml` never written; pre-restore backup created;
  - migrations from an empty database and from each released schema version;
  - translation completeness for public and admin strings;
  - versioning (§21): `package.json` holds a valid SemVer version (VER-1); the newest `CHANGELOG.md` heading is
    that version; every major version's section has **Upgrade notes**; `/api/openapi.json` reports the same
    version;
  - every shared validator in `src/lib/validation.ts`;
  - logging (§13):
    - every non-GET `/api/` route, and every `config.audit` GET route, writes an audit entry, with the right
      `outcome` for success, validation failure, 401/403 and 429 (iterate the registered routes as in API-13);
    - failed setup and login attempts are audited and coalesced, with `count` growing;
    - `ip_hash` is set and no raw IP address appears in either log;
    - `details` never contains passwords or the submitted values of failed fields;
    - startup and migrations write server log entries, `debug` entries and request access logs do not, and a
      500 writes a server log entry that shares the audit entry's `request_id`;
    - retention deletes by age and by cap, removing non-success audit entries first, and respects the 30-day
      audit minimum;
    - backups contain no log data, and a restore leaves both logs in place and appends its own audit entry;
    - clearing the server log works and is audited, and no route can delete audit entries;
    - the warnings/errors summary and the "seen" marker;
    - CSV exports neutralize formula-like cells.
- **TEST-5** Never skip, disable or weaken a test to make a change pass.

## 20. Documentation

### 20.1 README.md (for operators)

- **DOC-1** `README.md` MUST start with the title, the AI disclosure line
  (`> **AI Disclosure:** This software was created using generative AI. Its functionality has been verified by human review.`),
  a one-paragraph description and the self-hosting guarantees (no cloud, no CDNs, no outbound requests,
  where data lives). Then these sections, in order:
  1. **Contents**
  2. **Installation**: *Docker Compose* (§18.1) and *Local installation (Ubuntu/Debian)* (§18.2), both checking
     out a release tag, *TLS and reverse proxies*, *Upgrading* (read the upgrade notes in `CHANGELOG.md`, back up,
     check out the new tag) and *Rolling back* (VER-13)
  3. **First run** (AUTH-5/6, including removing the setup password and restarting, for both methods)
  4. **Configuration reference**: sources, precedence, table of config-file-only keys, table of
     dashboard-editable keys (key, default, description)
  5. **Admin dashboard**: one bullet per tab
  6. App-specific sections (features, imports)
  7. **Backup & restore**, including restoring `config.yaml` by hand, and that logs are not in backups
  8. **Logs**: what the server log and the audit log contain, retention settings, export, and the privacy note
     of LOG-23
  9. **Content safety** (what is accepted and how it is rendered)
  10. **Development** (commands table, project layout table, link to `AGENTS.md` and this spec)
  11. **Troubleshooting** (refuses to start, setup password missing, locked out, rate limits, proxy/HTTPS;
      pointing to the Server log tab first)

### 20.2 AGENTS.md (for agents)

- **DOC-2** `AGENTS.md` is the agent entry point; `CLAUDE.md` contains only `@AGENTS.md`. It MUST contain, in
  order: a two-paragraph overview (stack, database engine and why, deployment), a link to this spec with the
  spec version the app follows, **Branches**, **Commands** (including how to run a single test file),
  **Where things live** (path → purpose table), **Conventions and gotchas**, and **Deviations from the AGT
  web app spec** (rule ID, what differs, why; "None" if empty). Keep it short and current; update it in the
  same PR as the code it describes.

## 21. Versioning and releases

Every AGT app is versioned with [Semantic Versioning 2.0.0](https://semver.org/): `MAJOR.MINOR.PATCH`. The version
tells operators what an upgrade means for them. A major upgrade may need action, while a minor or patch upgrade
never does.

### 21.1 The version number

- **VER-1** The app version is the `version` field in `package.json`, and nowhere else. `package-lock.json` follows
  it: set both with `npm version <version> --no-git-tag-version`. The version is a full SemVer version without build
  metadata: `MAJOR.MINOR.PATCH`, optionally followed by a release-candidate suffix (VER-7).
- **VER-2** The app reports its version, always read from `package.json` at startup (SRV-3):
  - OpenAPI `info.version` (API-12);
  - `appVersion` in every backup manifest (BAK-2);
  - the startup server log entry (LOG-8);
  - the admin dashboard header, from `version` in `GET /api/admin/session`.

  The public UI does not need to show it.

### 21.2 What each part means

Classify a change by its effect on the people who run and use the app: operators (install, config, upgrade),
API clients, and users. When a change fits more than one level, the highest level wins. When in doubt, choose the
higher level.

- **VER-3** **MAJOR**: the upgrade can break an existing installation or client, or needs operator action. That
  is any of:
  - **API break** (API-12): a removed or renamed route, parameter or response field; a changed type or meaning; a
    newly required request field; stricter validation that rejects input the previous version accepted; a changed
    status code or response shape.
  - **Operator break**: a removed or renamed `config.yaml` key, environment variable, Compose service or volume,
    install path, systemd unit or default port; a changed default that changes how existing installations behave;
    a change that stops backups made by the previous version from being restored.
  - **Irreversible data change**: a migration that deletes or rewrites existing data (dropping a table or column
    that holds data, transforming stored values). Migrations that only add schema are not major (VER-4).
  - **Raised runtime requirement**: a newer Node.js major, PostgreSQL major, Ubuntu/Debian release or Docker Compose
    feature than the previous version needed.
  - **Database engine change** (DATA-1).
- **VER-4** **MINOR**: new capability that existing installations and clients can ignore:
  - new features, routes, optional request fields, query parameters and response fields;
  - new config keys or settings whose defaults keep the current behaviour;
  - additive migrations (new tables, columns, indexes, backfills that don't lose data);
  - new locales or UI text;
  - deprecations (VER-10);
  - visible UI changes, including removing a UI-only feature that has no API or configuration impact (list it
    under **Removed**).
- **VER-5** **PATCH**: corrections that keep documented behaviour: bug fixes, security fixes, translation fixes,
  performance improvements, refactors, and dependency updates that don't raise runtime requirements or change
  behaviour.
- **VER-6** **No bump**: changes to files that don't ship (documentation outside the UI, tests, CI, `AGENTS.md`,
  this spec). Anything that changes what is built or deployed (code, assets, migrations, `Dockerfile`,
  `docker-compose.yml`, `deploy/`, `config.example.yaml`) needs at least a patch.

### 21.3 Pre-1.0 and release candidates

- **VER-7** New apps start at `0.1.0`. While the major version is 0, a change that VER-3 calls major bumps the
  MINOR version, and everything else bumps PATCH. Release `1.0.0` when the app is first deployed to a live instance;
  from then on VER-3..6 apply in full.

  Release candidates `X.Y.Z-rc.N` (N from 1) MAY be tagged to test a release before it ships. Set the version to
  `X.Y.Z-rc.N` in a PR, tag it, then set it back to `X.Y.Z` for the release. Release candidates never run on a live
  instance.

### 21.4 Bumping in each PR

- **VER-8** Each PR that VER-6 does not exempt bumps the version in the same PR, relative to the **last released
  version** (the newest `vX.Y.Z` tag, VER-11), to the level its changes need. `main` therefore always carries the
  version that would ship next. If `main` already carries an unreleased bump at that level or higher, the PR keeps
  it. Example: after release `2.1.0`, a fix makes `main` `2.1.1`. A new feature then makes it `2.2.0`, and a second
  feature keeps `2.2.0`. A breaking change then makes it `3.0.0`.

  The PR description states the level and the rule that requires it (e.g. "Minor: new optional query parameter,
  VER-4").

### 21.5 CHANGELOG

- **VER-9** Every app has a `CHANGELOG.md` at the repository root in [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)
  format. The PR that changes the app also adds its entries.
  - Headings: `## [X.Y.Z] - Unreleased` while unreleased (it always matches `package.json`), then
    `## [X.Y.Z] - YYYY-MM-DD` when released. Newest first.
  - Groups, in this order and only when non-empty: **Upgrade notes** (major versions only, and always present for
    them), **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**.
  - Entries are short sentences for operators and users, not commit messages, and link the PR.
  - **Upgrade notes** say exactly what an operator must do before or after upgrading: back up first; renamed keys
    or variables, old and new; new runtime requirements; one-time steps. Every breaking change in the version has a
    note.
  - The in-app change log, if an app has one, is separate user-facing content; it does not replace `CHANGELOG.md`.

### 21.6 Deprecation

- **VER-10** Before a major version removes or renames a `config.yaml` key, environment variable, or API route,
  parameter or field, that item MUST be deprecated in at least one earlier minor release:
  - it keeps working unchanged;
  - `CHANGELOG.md` lists it under **Deprecated**, with its replacement and the major version that removes it;
  - API routes and schema properties are marked `deprecated: true`, so they show as deprecated in `/api/openapi.json`;
  - a renamed config key or environment variable is accepted under both names. If both are set, the new one wins,
    and the server log warns once at startup (LOG-8) whenever the old name is used.

  A security fix MAY skip the deprecation period when keeping the old behaviour would leave users exposed. The
  upgrade notes say so.

### 21.7 Tags and releases

- **VER-11** A release is an annotated git tag `vX.Y.Z` (the `package.json` version with a `v` prefix) on a commit
  on `main` where `CHANGELOG.md` has the dated heading for that version, plus a GitHub Release named `vX.Y.Z` whose
  body is that version's CHANGELOG section. Mark release candidates as pre-releases. Tags are never moved or
  deleted: a bad release is fixed by a new patch release.
- **VER-12** Agents prepare releases but do not publish them on their own. The **release PR** only changes the
  version's CHANGELOG heading from `Unreleased` to the release date. Agents create the tag and the GitHub Release
  only when the maintainer explicitly asks for that release.
- **VER-13** Installations run released versions. The README's install and upgrade steps check out a release tag,
  not `main` (DEP-5, DEP-6, DEP-9), and tell operators to read the CHANGELOG upgrade notes and take a backup
  before upgrading. Downgrading in place is not supported, because an app refuses a newer schema (DATA-4). The README
  documents rolling back as: check out the previous tag, then restore the backup taken before the upgrade.

## 22. Agent workflow

- **WF-1** Branches: each app documents its branches in `AGENTS.md`. Branches that serve live instances
  (e.g. `staging`, `prod`) are never pushed to directly; changes arrive by reviewed PR.
- **WF-2** Commit messages are one short imperative sentence ("Add event action toast notifications"), with
  a body when the change needs explaining. Cite requirement IDs when a change implements or deviates from
  this spec.
- **WF-3** One concern per PR. Code, tests, translations, README/AGENTS.md and `config.example.yaml` change
  together.
- **WF-4** Never weaken a security rule (§10, §11, AUTH-*) to make something work. If a rule blocks a real
  need, stop and propose a spec change.
- **WF-5** Before you finish: `npm run check` passes; new strings are translated into all locales; new
  routes have full schemas and appear in `/api/openapi.json`; new config keys are in the schema,
  `config.example.yaml` and the README tables; new tables have a migration; the version is bumped as §21 requires
  and `CHANGELOG.md` has the entries (VER-8, VER-9); the compliance checklist below still holds.

## 23. Compliance checklist

Use this list to review a new app or a large change. Every item must be true or listed as a deviation.

- [ ] Slug registered; names follow NAME-2; unique default port.
- [ ] Stack and layout match §3–§4; lockfile committed; `npm run check` passes.
- [ ] Engine chosen per DATA-1/2 and documented; numbered migrations; UUIDv4 IDs; UTC times.
- [ ] Every `/api/` route has full TypeBox schemas, `operationId`, tags, security; `/api/openapi.json` is
      complete (API-13 test); error bodies follow API-6.
- [ ] `config.yaml` validated, read-only, documented; `.env` holds only secrets; env vars limited to CFG-2.
- [ ] Settings tab with config-file-wins precedence enforced on the server (CFG-6..9).
- [ ] Single admin; first-run setup with `AGT_<APP>_SETUP_PASSWORD`; operator told to remove it (AUTH-6).
- [ ] Sessions, CSRF header, no CORS, rate limits, CSP and headers (SEC-1..7).
- [ ] Uploads checked by magic bytes, no SVG; ZIPs read safely; Markdown rendered safely; no outbound requests.
- [ ] ALTCHA + rate limit + moderation on every anonymous write (§11), or no anonymous writes.
- [ ] Backup & restore with manifest, preview, pre-restore backup, atomic swap, never writes `config.yaml` (§12).
- [ ] Server log and audit log in a separate log store, shown in the admin dashboard with filters, export and the
      error badge; audit via one hook, coalesced, IP-pseudonymized, append-only; retention settings; not in
      backups (§13).
- [ ] Two Vite entries; `apiRequest()`; no client caching of server data.
- [ ] Design tokens verbatim; AGT fonts and logo bundled; portal codes shown in NMS Glyphs Mono with hex
      text (UI-14); reference component classes; responsive to 300 px.
- [ ] WCAG 2.2 AA: dialogs via `useDialog`, labelled icon buttons, live regions, font scale.
- [ ] All 10 locales complete for public and admin strings; no hard-coded UI text.
- [ ] Docker Compose and systemd installs documented and working; healthcheck; non-root; hardened.
- [ ] README sections per DOC-1; AGENTS.md per DOC-2 with deviations.
- [ ] SemVer version in `package.json`, bumped in each PR (§21); `CHANGELOG.md` with upgrade notes for majors;
      deprecations before removals; releases tagged `vX.Y.Z` with GitHub Releases; installs check out tags.

## Appendix A: Reference implementation deviations

The AGT Event Calendar predates this spec and was brought into compliance afterwards. The deviations below are
also listed in its `AGENTS.md`. Unless a row says "to fix", they are kept on purpose. **Do not copy them into
other apps.**

| Rule | Calendar today | Why |
| --- | --- | --- |
| NAME-2, CFG-2 | Env vars `AGT_SETUP_PASSWORD`, `AGT_CONFIG_FILE`, `AGT_STATIC_DIR` (no app segment); cookie `agt_session`; Compose service `calendar`, volume `calendar-data`; SQLite file `agt-calendar.sqlite` | Renaming would break existing `.env` files, sign everyone out and orphan the data volume. New apps use the spec names. |
| CFG-5 | Backup/import limits live under `migration.*` | Operators may have them in `config.yaml`, and unknown keys stop the server. |
| STACK-1 | Extra runtime dependency `papaparse` | Parses the legacy CSVs for Migrate from Amplify. |
| §21 (VER-2, VER-9, VER-11, VER-13) | No `CHANGELOG.md` and no release tags yet; the admin dashboard doesn't show the version; the README installs and upgrades from `main` | **Not kept: to fix.** Added in spec 3.0.0. |

Calendar-specific features that are **not** part of the standard: Migrate from Amplify (`server/migration.ts`,
`src/lib/csv.ts`), legacy 4-hex event IDs, bookmarks, the national holidays and change log content types, the
anthem audio and the portal glyph tool link. They are examples of app-specific features, not templates.
