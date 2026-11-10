# AGT Web Application Specification

| | |
| --- | --- |
| **Spec version** | 6.0.0 |
| **Status** | Normative. 6.0.0 is the first production-ready version; earlier versions were development releases, and apps that follow one should move to 6.0.0 (SPEC-3) |
| **Audience** | AI coding agents that design, build, review or maintain AGT web applications |
| **Source** | [`agtdarkshadow04/agt_webapp_specification`](https://github.com/agtdarkshadow04/agt_webapp_specification), released as tags `vX.Y.Z` (SPEC-1) |
| **Reference implementation** | [`agtdarkshadow04/agt_event_calendar`](https://github.com/agtdarkshadow04/agt_event_calendar) (AGT Event Calendar); its deviations are listed in its `AGENTS.md` |
| **Reference version** | AGT Event Calendar 2.2.0, commit [`ba223a786c7eb58e3f42f83e4b51ab5e84fb8160`](https://github.com/agtdarkshadow04/agt_event_calendar/tree/ba223a786c7eb58e3f42f83e4b51ab5e84fb8160) (not yet tagged; becomes the tag `v2.2.0` once it exists) |
| **Assets** | [`assets/`](https://github.com/agtdarkshadow04/agt_webapp_specification/blob/v6.0.0/assets/README.md) in the source repository: the AGT logo and fonts, with SHA-256, sources and licences (UI-15) |
| **Owner** | Alliance of Galactic Travellers; maintained by [`agtdarkshadow04`](https://github.com/agtdarkshadow04) |
| **Release date and approval** | The date of this version's section in `CHANGELOG.md`. A version is approved when the owner merges its release PR and creates the annotated tag `vX.Y.Z` (SPEC-1); the tag's GitHub Release is the record |
| **Security contact** | Report vulnerabilities in the spec or in an AGT app privately through the repository's **Security** tab → **Report a vulnerability** (GitHub private vulnerability reporting), never in a public issue |

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
- **When the spec is silent,** do what the reference implementation does at the **Reference version** in the
  header (not its latest commit, which may already follow a newer spec), except where its `AGENTS.md` lists a
  deviation for that topic: then follow the spec, not the reference. The calendar's app-specific features
  (Migrate from Amplify, legacy 4-hex event IDs, bookmarks, national holidays and the change-log content type,
  the anthem audio, the portal glyph tool link) are examples, not templates.

### 0.1 Where the spec lives

- **SPEC-1** The source of truth is the `agt-webapp-spec.md` file in the
  [`agtdarkshadow04/agt_webapp_specification`](https://github.com/agtdarkshadow04/agt_webapp_specification)
  repository. Each spec release is an annotated tag `vX.Y.Z` on its `main` branch, with an entry in that repository's
  `CHANGELOG.md`. Released tags are never moved or deleted.
- **SPEC-2** Every app keeps a **pinned copy** of the spec version it follows at `docs/agt-webapp-spec.md`,
  byte-identical to `agt-webapp-spec.md` at that release tag. The app's `AGENTS.md` names the version and the tag
  (DOC-2). Never edit the copy: the app's differences go in its deviations table, and changes to the rules go to the
  spec repository as a PR. Agents read the pinned copy, not the spec repository's `main`, so they follow the rules
  the app has actually adopted.
- **SPEC-3** Moving an app to a newer spec version is a PR of its own in the app's repository. It replaces the copy
  with the file from the new tag and updates the version and tag in `AGENTS.md`. It then either implements the new
  rules or lists each unimplemented one as a deviation marked "to fix". An app may lag behind the newest spec, but
  its `AGENTS.md` always states which version it follows.
- **SPEC-4** **Changing this spec.** Open a PR in the spec repository that changes only the spec, its `README.md`
  and `CHANGELOG.md`. Bump the spec version (separate from the apps' versions, which follow
  [§21](#21-versioning-and-releases)): major for a new or stricter MUST, minor for a new SHOULD/MAY or a new
  section, patch for clarifications. Add a `CHANGELOG.md` entry in the same PR, keeping requirement IDs stable:
  never reuse or renumber an ID, and mark a removed rule as removed instead of deleting its ID silently. New design
  tokens, locales and registry entries are added here first, then in apps. As with apps (VER-12), agents create
  release tags only when the maintainer asks.

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
  | Postgres database and role | `agt_<app_snake>`; restore preview database `agt_<app_snake>_preview` (BAK-3) |
  | Local install: system user, code, config, data | `agt-<app>`, `/opt/agt-<app>`, `/etc/agt-<app>/`, `/var/lib/agt-<app>/` |
  | systemd unit | `agt-<app>.service` |
  | Backup file / manifest `format` | `agt-<app>-backup-<timestamp>.zip` / `agt-<app>-backup` |

- **NAME-3** The CSRF header is the same for every app: `x-agt-request: 1` (see [SEC-5](#103-csrf-and-cors)).

### 2.1 App registry

Each app has a unique default port, so several AGT apps can run on one host without changing configuration.
Add a row (next free port) when you create an app.

| Slug | Display name | Repository | Default port | Database |
| --- | --- | --- | --- | --- |
| `event-calendar` | AGT Event Calendar | `agtdarkshadow04/agt_event_calendar` | 8080 | SQLite |

## 3. Technology stack

- **STACK-1** Apps MUST use this stack. Adding a runtime dependency that is not listed here requires a reason
  in the PR description.

| Concern | Choice |
| --- | --- |
| Runtime | Node.js 26 LTS and npm 11.20 or newer within npm 11 (STACK-7), pinned with `"engines": { "node": ">=26.0.0 <27", "npm": ">=11.20.0 <12" }`; ESM only (`"type": "module"`) |
| Language | TypeScript (`~7.0`), `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` |
| Server | Fastify 5 with `@fastify/type-provider-typebox` and `@sinclair/typebox` |
| Server plugins | `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/multipart` (if uploads), `@fastify/swagger` |
| API description | OpenAPI 3.1, generated from route schemas ([§6](#6-rest-api-and-openapi)) |
| Database | SQLite via `better-sqlite3`, **or** PostgreSQL via `pg` ([§7](#7-data-storage)) |
| Config parsing | `yaml` + TypeBox schema |
| Client | React 19 + Vite 8 (`vite` `^8.3`, `@vitejs/plugin-react` `^6.3`) |
| Markdown (if needed) | `react-markdown` + `remark-gfm` only ([SEC-12](#106-user-content)) |
| Captcha (if anonymous writes) | `altcha` (widget) + `altcha-lib` (server) ([§11](#11-anonymous-input-and-altcha)) |
| ZIP (backups) | `yazl` (write) + `yauzl` (read) |
| Logging | `pino` (Fastify's logger) to stdout and the log store ([§13](#13-logging)) |
| Server bundle | `esbuild` (`^0.28`; Vite 8 needs 0.27 or newer) → `dist-server/index.mjs` |
| Tests | `node:test` + `node:assert/strict`; Fastify `inject()` for HTTP |
| Browser tests (dev only, TEST-6) | `@playwright/test` with Chromium; optionally `@axe-core/playwright` |
| Lint | `tsc -b` (no ESLint, no Prettier) |

The `engines` ranges MUST be exactly the release lines above, with an upper bound: a range without one (such as
`>=26.0.0`) also accepts Node.js 27 and every later major, none of which this spec version has reviewed. Moving
to the next LTS line is a major spec change (STACK-5). npm only warns about an `engines` mismatch unless
`engine-strict` is set; apps MAY add `engine-strict=true` to a committed `.npmrc` to make it an error. Apps do not
set `packageManager`, which only Corepack reads.

- **STACK-2** The client MUST NOT use a router library or a global state library (Redux, Zustand, …).
  Use React state, context and URL query parameters. An app with more than one public page MAY add a second
  Vite entry instead of a router.
- **STACK-3** Do not add a CSS framework (Tailwind, Bootstrap, …) or a component library. Use plain CSS with
  the AGT design tokens ([§15](#15-visual-design-system)).
- **STACK-4** Commit `package-lock.json`. Install with `npm ci`.
- **STACK-5** **Supported versions.** The versions in STACK-1 are the release lines this spec version requires;
  raising one is a major spec change. Within them, apps SHOULD only use versions that their maintainers still fix:

  | Dependency | Supported means | Check |
  | --- | --- | --- |
  | Node.js | An Active or Maintenance LTS line that is not past its end-of-life date | [nodejs/Release schedule](https://github.com/nodejs/Release#release-schedule) |
  | Vite | The latest minor of a major that Vite still patches: the current major, or the latest minor of the previous or second-to-last major (the latter gets security patches only). Use a range that resolves to that minor, e.g. `^8.3` rather than `^8.0.0` | [Vite releases](https://vite.dev/releases#supported-versions) |
  | Other dependencies (TypeScript, Fastify, React, …) | The latest minor and patch of the major in use; maintainers rarely patch older lines | The package's release notes |

  A dependency whose required line is no longer supported is reported in the dependency review (STACK-6) and, if it
  is required by this spec, as an issue on the spec repository so the next major spec version can raise it.
- **STACK-6** **Dependency review.** Apps SHOULD review their dependencies:
  - in every release PR (VER-12): list the `package-lock.json` changes since the last release (new packages, major
    version changes) and the result of `npm audit --omit=dev`, in the PR description;
  - when a Node.js line changes LTS status (each April and October) and at least every six months: check each
    STACK-1 dependency against STACK-5, and record the result in an issue or the next release PR.

  Updating within the allowed ranges is a PATCH or MINOR release of the app (VER-4, VER-5); moving to a new major of
  a dependency follows the usual version rules for its effect on installations.
- **STACK-7** **Install scripts.** npm 11.20 and newer (bundled with Node.js 26) skips the install scripts of every
  dependency that `package.json` does not approve in `allowScripts`. Apps MUST record a decision for every dependency
  that has one, with `npm install-scripts approve <pkg>` or `npm install-scripts deny <pkg>`, so that `npm ci` behaves
  the same everywhere; `npm install-scripts ls` MUST list nothing. Approve `better-sqlite3` and `esbuild`: both ship
  prebuilt binaries and work even when denied, but their scripts are the fallback for a platform without one (the
  Dockerfile and DEP-6 install the build tools `better-sqlite3`'s `node-gyp rebuild` needs). Approve any other script
  only with a reason in the PR description.

## 4. Repository layout

- **REPO-1** Apps MUST use this layout. Files marked *(if …)* exist only when the feature does.

```text
agt_<app_snake>/
├── AGENTS.md                 # agent guide (§20.2); CLAUDE.md contains only "@AGENTS.md"
├── CLAUDE.md
├── README.md                 # operator documentation (§20.1)
├── LICENSE
├── CHANGELOG.md              # release notes (§21.5)
├── docs/agt-webapp-spec.md   # pinned copy of the spec version the app follows (SPEC-2); never edited
├── Dockerfile
├── docker-compose.yml
├── .env.example              # secrets/bootstrap only, documented
├── config.example.yaml       # every key, commented, with its default
├── .gitignore  .dockerignore .gitattributes
├── deploy/
│   ├── agt-<app>.service     # systemd unit for local installs (§18.2)
│   ├── Caddyfile.example     # TLS reverse proxy example
│   └── postgres-init/10-app-role.sh  # Postgres apps: creates the non-superuser role and databases (DEP-3)
├── index.html                # public SPA entry
├── admin.html                # admin dashboard entry (noindex)
├── package.json  package-lock.json
├── tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json
├── vite.config.ts
├── playwright.config.ts      # browser tests (TEST-6)
├── tests/e2e/                # *.spec.ts (TEST-6)
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
│   ├── migrations/control/0001_operation.sql # Postgres: control schema (BAK-12)
│   ├── repository.ts         # all SQL lives here
│   ├── http.ts               # HttpError, multipart helper
│   ├── passwords.ts          # scrypt hashing, constant-time compare
│   ├── session.ts            # cookie sessions, CSRF check
│   ├── dataWrite.ts          # withDataWrite(): the backup/restore write barrier (BAK-8, BAK-12)
│   ├── logs.ts               # log store, server-log stream, retention job (§13)
│   ├── audit.ts              # audit onResponse hook, IP hashing (§13)
│   ├── backup.ts  zip.ts     # backup/restore and safe ZIP handling
│   ├── images.ts             # (if uploads) magic-byte validation and storage
│   ├── altcha.ts             # (if anonymous writes)
│   └── test/                 # *.test.ts + helpers.ts (+ fixtures/)
└── src/
    ├── main.tsx  App.tsx     # public UI root
    ├── agt-base.css          # AGT base stylesheet, copied unmodified from the spec repository (UI-16)
    ├── styles.css            # public styles; imports agt-base.css first
    ├── translations.ts       # public UI strings, all locales
    ├── components/           # public components; useDialog.ts; Icons.tsx
    ├── lib/                  # framework-free logic + *.test.ts (validation.ts, api.ts, client.ts, settings.ts …)
    └── admin/                # admin dashboard: main.tsx AdminApp.tsx *Panel.tsx admin.css i18n.ts context.ts
                              # incl. ServerLogPanel.tsx, AuditLogPanel.tsx (§13.6)
```

- **REPO-2** `.gitignore` and `.dockerignore` MUST exclude `.env`, `.env.*` (except `.env.example`),
  `config.yaml`, `data/`, `dist/`, `dist-server/`, `.test-build/`, `test-results/`, `playwright-report/` and
  `node_modules/`.
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
  than the app supports, a missing required secret, or an invalid setup password (AUTH-5).
- **SRV-9** Static files: register `@fastify/static` on `dist/` with `index: false`. Serve `GET /` →
  `index.html`, `GET /admin` → `admin.html`, redirect `/admin/` → `/admin`. Hashed files under `/assets/` get
  `Cache-Control: public, max-age=31536000, immutable`; everything else gets `no-store`.
- **SRV-10** Unknown routes return `404` with the error body, not an HTML page.
- **SRV-11** `GET /api/health` MUST run a trivial database query and return `200 { "status": "ok" }`, or
  `200 { "status": "maintenance" }` without querying while its process is in the `restore` state (BAK-8, BAK-12). It is public, unauthenticated,
  not rate limited, and used by the Docker healthcheck.

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
  {
    "error": "validation_failed",
    "message": "The event is invalid.",
    "fields": [
      { "field": "name", "code": "required", "message": "Name is required." },
      { "field": "description", "code": "too_long", "message": "Description must be at most 4000 characters.", "params": { "max": 4000 } }
    ]
  }
  ```

  ```json
  { "error": "rate_limited", "message": "Too many requests. Try again in 42 seconds.", "params": { "retryAfterSeconds": 42 } }
  ```

  | Field | Type | Meaning |
  | --- | --- | --- |
  | `error` | string | Stable snake_case code; clients translate it (I18N-6) and may branch on it |
  | `message` | string | English text for humans, logs and API users; clients show it only for codes they do not know |
  | `params` | object, optional | Values the translated text needs (table below). Number, string or boolean values only |
  | `fields` | `FieldError[]`, optional | Only for field-level validation errors |

  A **`FieldError`** (also used for `notices`, API-2) is `{ field, code, message, params? }`: `field` is the request
  property (dotted for nested ones, e.g. `links.2`), `code` a field code from the table below, `message` English
  text, and `params` the values that code needs.

  | Field `code` | When | `params` |
  | --- | --- | --- |
  | `required` | Missing or empty | — |
  | `too_long` | Longer than allowed | `{ max }` (characters) |
  | `too_short` | Shorter than allowed | `{ min }` (characters) |
  | `out_of_range` | Number or date outside the allowed range | `{ min?, max? }` |
  | `too_many` | A list has too many items | `{ max }` |
  | `invalid_format` | Wrong format (UUID, date, time zone, portal code, …) | — |
  | `invalid_url` | Not an absolute `http:` or `https:` URL | — |
  | `not_allowed` | Not one of the allowed values | — |
  | `duplicate` | Must be unique and is not | — |
  | `mismatch` | Must equal another field and does not (e.g. password confirmation) | `{ other }` (field name) |
  | `same_as_setup_password` | The new admin password equals the setup password (AUTH-5) | — |

  An app MAY add field codes for checks this table does not cover, in the same snake_case form; they are listed with
  the error codes in the `ErrorBody` schema description (below). Standard codes and statuses:

  | Status | `error` | When |
  | --- | --- | --- |
  | 400 | `invalid_request`, `validation_failed`, `captcha_failed` | Schema or semantic validation failed |
  | 400 | `unknown_setting`, `invalid_setting` | Settings update with a key not in `EDITABLE_SETTINGS`, or an invalid value (CFG-8) |
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
  | 503 | `maintenance` | A restore is running, or a write waited too long for a backup (BAK-8); sent with `Retry-After` |

  Error codes whose text needs a value send it in `params`:

  | `error` | `params` |
  | --- | --- |
  | `rate_limited`, `maintenance` | `{ retryAfterSeconds }` (the `Retry-After` header is sent too) |
  | `file_too_large`, `field_too_large` | `{ maxBytes }` |
  | `defined_in_config` | `{ key }` (the setting key) |

  The table is the standard set, not an exhaustive list. Use a standard code whenever its situation applies.
  An app MAY add its own codes for situations the table does not cover (e.g. `file_required` for a multipart
  request without its file part); they follow the same snake_case form and status rules. The `ErrorBody`
  schema's `error` property SHOULD list every code the app returns, standard and app-specific, in its OpenAPI
  `description`, and the `FieldError` schema's `code` property every field code. Both schemas declare `params` as
  an optional object of string, number or boolean values.

- **API-7** Timestamps in API payloads are ISO 8601 UTC strings ending in `Z`. Dates without a time are
  `YYYY-MM-DD`.
- **API-8** Collections whose size is bounded by admin effort (events, holidays) MAY be returned as a plain
  array. Collections that can grow without bound (logs, submissions over time) MUST paginate with
  `?limit=<1..200>&cursor=<opaque>` and return `{ "items": [...], "nextCursor": "<opaque>" | null }`.
  - **Order** by a unique key that only grows (e.g. a log's `seq`), newest first. If the natural order is a
    column that is not unique (e.g. a timestamp), add the unique key as a tie-breaker. Then items written while a
    client pages never shift a page, and no item appears twice.
  - **Cursor:** the position after the last item returned, encoded opaquely (e.g. base64url of that item's `seq`).
    It does not expire. A cursor that cannot be decoded returns `400 invalid_request`. A cursor whose item has
    since been deleted (e.g. by retention) still works: the next page starts after that position.
  - `limit` defaults to `50`. `nextCursor` is `null` on the last page. Filters are sent again with every page;
    the server does not store them in the cursor.
- **API-9** The server never sets CORS headers and never answers preflight requests with permission
  ([SEC-6](#103-csrf-and-cors)).

### 6.3 OpenAPI

- **API-10** Every route under `/api/` MUST declare TypeBox schemas for `params`, `querystring`, `body` (when
  present) and `response` (every success status, plus `default` referencing the shared `ErrorBody` schema).
  Request schemas MUST set `additionalProperties: false`, and this applies to `params` and `querystring` as well
  as `body`. With Fastify's default Ajv options (`removeAdditional: true`), unknown properties are then removed
  before the handler runs rather than rejected; an app MAY set `ajv: { customOptions: { removeAdditional: false } }`
  to reject them with `400 invalid_request` instead. Either way the handler never sees an undeclared property.
  Semantic validation (cross-field rules, translated
  messages) still runs through the shared validators in `src/lib/validation.ts`, after the schema check.
- **API-11** Register `@fastify/swagger` in `server/openapi.ts` **before** any route, with
  `openapi: { openapi: '3.1.0', info: { title: '<App Name> API', version: <package.json version> } }`.
  Serve the generated document at `GET /api/openapi.json` (public, `hide: true` so it does not describe
  itself). Every route sets:
  - `operationId`: unique camelCase verb + noun (`listEvents`, `createAdminEvent`, `updateSettings`),
  - `tags`: `public`, `auth`, `admin`, or a resource name,
  - `summary`: one English sentence,
  - `security`: what the route really requires (AUTH-9, SEC-5), from this table:

    | Route | Needs | `security` |
    | --- | --- | --- |
    | Public reads and anonymous writes (e.g. `GET /api/events`, `GET /api/setup/status`, `POST /api/submissions`) | Nothing | `[]` |
    | `POST /api/setup`, `POST /api/admin/login` | CSRF header, no session | `[{ csrfHeader: [] }]` |
    | Other admin reads (`GET`) | Session | `[{ sessionCookie: [] }]` |
    | Other admin writes (including `POST /api/admin/logout`) | Session and CSRF header | `[{ sessionCookie: [], csrfHeader: [] }]` |

    Define these four values once (e.g. a `SECURITY` object in `server/openapi.ts`) and use them in every route.

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
  response; and the document's `openapi` field is `3.1.0`. The test SHOULD also assert that each operation's
  `security` is the API-11 value for its route (by path and method, as in the table), so a route documented as
  public or session-only cannot silently need more or less.
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

  A SQLite app runs exactly one app process per data directory; its operation lock (BAK-8) exists only in that
  process. A Postgres app MUST implement the shared operation lock (BAK-12) even when it runs one process, so it can
  run several processes or replicas without code changes. All processes of a Postgres app share one data directory
  (`dataDir`: uploads, backups, the BAK-11 marker), for example one Docker volume or a network filesystem with atomic
  rename, and the same database.

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
- **DATA-11 (PostgreSQL)** The PostgreSQL counterpart of DATA-5; until spec 5.1.0 it was also numbered DATA-5.
  Record versions in a `schema_migrations (version integer primary key, name text not
  null, applied_at timestamptz not null default now())` table. Run all startup migrations under the migration lock,
  in the order BAK-12 gives (**Startup**), so concurrent starts are safe. Use a single `pg.Pool`. Wrap multi-statement writes in a
  `withTransaction(pool, async (client) => …)` helper that always releases the client. Use
  `timestamptz` for instants, `uuid` for IDs and `text` rather than `varchar(n)`. The app's own tables, sequences,
  indexes and constraints live in the `public` schema and nowhere else (no functions, triggers, views or extensions;
  BAK-3's allowlist rejects them); the log store uses `logs` (LOG-1) and the operation lock `control` (BAK-12).
  The app connects as the role `agt_<app_snake>`, which MUST NOT be a superuser and owns only the app database and
  its preview database; at startup the app refuses to start (SRV-8) if `SELECT rolsuper FROM pg_roles WHERE rolname
  = current_user` is true.

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

- **CFG-1** Configuration comes from exactly three sources:

  | Source | Contains | Location |
  | --- | --- | --- |
  | `config.yaml` | Every non-secret setting an operator chooses | Docker: `./config.yaml` mounted read-only at `/app/config.yaml`. Local: `/etc/agt-<app>/config.yaml` |
  | Process environment | Only the variables listed in CFG-2: operator secrets and first-run bootstrap values from `.env`, plus a few operational variables that the Dockerfile, systemd unit, Compose file or development and CI tooling set | `.env`: Docker `env_file: .env`, local `/etc/agt-<app>/.env` via systemd `EnvironmentFile=`. Others: where CFG-2's **Set by** column says |
  | Dashboard settings | Keys listed in `EDITABLE_SETTINGS`, stored in the `settings` table | Database |

  An operator writes only `config.yaml`, `.env` and dashboard settings. The launcher-set variables are part of the
  shipped Dockerfile, unit and Compose file; an operator changes them only by editing those files, and every one of
  them is overridden by its `config.yaml` key where CFG-2 names one.

- **CFG-2** Environment variables are this set plus app-specific secrets (see below). Everything else that is not
  secret goes in `config.yaml` (CFG-1), never in an environment variable. The **Set by** column separates the
  operator's `.env` from the variables the launcher or tooling sets.

  | Variable | Set by | Purpose |
  | --- | --- | --- |
  | `AGT_<APP>_SETUP_PASSWORD` | Operator (`.env`) | First-run setup only ([§9](#9-authentication-and-first-run)) |
  | `AGT_<APP>_DB_PASSWORD` | Operator (`.env`) | Postgres apps only |
  | `AGT_<APP>_CONFIG_FILE` | Dockerfile / systemd unit | Path of `config.yaml` (default `./config.yaml`) |
  | `AGT_<APP>_DATABASE_HOST` | `docker-compose.yml` | Postgres apps only; default host when `database.host` is not in `config.yaml` |
  | `AGT_<APP>_SERVER_HOST` | Dockerfile | Listen address when `server.host` is not in `config.yaml` (the Dockerfile sets `0.0.0.0`; DEP-1) |
  | `AGT_<APP>_STATIC_DIR` | Development only | Override path to `dist/` |
  | `AGT_<APP>_TEST_DATABASE_URL` | Developer / CI | Postgres apps only; database for server tests (TEST-3). Never read by the production server |
  | `NODE_ENV` | Dockerfile / systemd unit | `production` |

  **App-specific secrets.** An app MAY add environment variables only for secrets the operator supplies (SEC-8;
  rare, because there are no outbound requests). Name them `AGT_<APP>_<NAME>`, put them in `.env`, and list each
  one in `.env.example` (DEP-4) and in the README's configuration reference, with what it is for.
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
  #   host: 127.0.0.1            # default: AGT_<APP>_SERVER_HOST if set (0.0.0.0 in the Docker image), else 127.0.0.1
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
  #   previewName: agt_<app_snake>_preview   # scratch database for the restore preview (BAK-3)
  #   user: agt_<app_snake>
  # session:
  #   ttlHours: 12
  #   secureCookie: auto         # auto|true|false
  # rateLimits:
  #   login:   { max: 10, windowMinutes: 15 }
  #   setup:   { max: 10, windowMinutes: 15 }
  #   adminUploads: { max: 120, windowMinutes: 15 }
  # altcha:                      # apps with anonymous writes; the HMAC key is generated (ALT-2), never configured
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
  keys can be stored in the `settings` table (value as JSON). Each `schema` enforces the allowed values below;
  a value outside them is rejected with `400 invalid_setting` (CFG-8), and the same schema validates the key in
  `config.yaml` (CFG-3):

  | Key | Default | Allowed |
  | --- | --- | --- |
  | `site.title` | `<App Name>` | 1–100 characters |
  | `site.supportUrl` | `https://www.nms-agt.com/support` | An absolute `http:` or `https:` URL |
  | `<feature>.enabled` | `true` | Boolean (ALT-5) |
  | `<feature>.rateLimit.max` | `5` | Integer 1–10000 (anonymous writes, SEC-7) |
  | `<feature>.rateLimit.windowMinutes` | `60` | Integer 1–1440 |
  | `uploads.maxImageBytes` | `10485760` | Integer 1024–10485760 (10 MB, SEC-9) |
  | `backup.maxZipBytes` | `209715200` | Integer 1024–2147483648 (2 GiB) |
  | `backup.maxUncompressedBytes` | `1073741824` | Integer 1024–8589934592 (8 GiB) |
  | `backup.maxEntries` | `10000` | Integer 1–100000 |
  | `logs.*` | See LOG-16 | See LOG-16 |

  App-specific editable keys SHOULD declare their range in their schema the same way.
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
  are never stored or logged. scrypt needs about `128 · r · (N + p + 2)` bytes, which for these parameters is
  just over Node's default `maxmem` of 32 MiB, so a call without `maxmem` fails with
  `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`. Every scrypt call, hashing and verifying, MUST pass the fixed options
  `{ N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }`; `maxmem` is never computed from a stored hash.

  Verifying MUST first check the stored hash and reject it, **without calling scrypt**, unless all of these hold:
  - it has exactly six `$`-separated fields and the first is `scrypt`;
  - `N`, `r` and `p` are decimal integers without sign or leading zeros, and equal a supported parameter profile.
    The only profile is `N = 32768, r = 8, p = 1`; list profiles in one constant in `server/passwords.ts`, and add a
    new one only together with the code that rehashes on the next successful login;
  - the salt and the hash are standard base64 that decodes to exactly 16 and 64 bytes.

  A stored hash that fails this check (corrupted, edited in the database, or from a crafted backup) can never
  verify: login and the current-password check of AUTH-4 return the same `401 invalid_credentials` as a wrong
  password, and the server log gets an `error` (source `auth`, "The stored admin password hash is malformed or uses
  unsupported scrypt parameters."; never the hash itself). Recovery is AUTH-7.
- **AUTH-3** Admin passwords MUST be 12–1024 characters. The admin username is trimmed of surrounding whitespace
  and MUST then be 1–64 characters (`400 validation_failed` otherwise; lengths here and in AUTH-5 count Unicode code
  points, as JSON Schema `maxLength` does); it is stored as entered after trimming (no case folding or other
  normalization), so login compares the trimmed input with it exactly. Compare secrets (setup password,
  usernames) with a constant-time function that does not return early when the lengths differ: compare the
  SHA-256 digests of both values with `crypto.timingSafeEqual`, or pad both to the longer length, compare them,
  and only then also compare the lengths (as the reference implementation's `secretsEqual()` does). On login, verify against a dummy hash when no admin exists, so timing does not
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

  **Startup check.** While no admin exists and `AGT_<APP>_SETUP_PASSWORD` is set and not empty, its value MUST be
  at most 1024 characters, measured as read from the environment, so it can be typed into a request that the schema
  below accepts. A longer value stops the server (SRV-8) with "AGT_<APP>_SETUP_PASSWORD is longer than 1024
  characters. Set a shorter value in .env and restart." An empty value still means "not set" (step 2). Once an admin
  exists the value is not checked, only warned about (AUTH-6).

  Request size: the setup and login body schemas cap `setupPassword` and `password` at 1024 characters
  (`maxLength`, matching AUTH-3) and `username` at 64. Fastify's `bodyLimit` for JSON requests SHOULD be at most
  2 MiB (`2 * 1024 * 1024`); multipart uploads are limited separately (SEC-9, BAK-1).
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
  Because the app itself never encrypts, a default install MUST be reachable only from the host it runs on:
  `server.host` defaults to `127.0.0.1` (CFG-5), and Compose publishes the port on `127.0.0.1` only (DEP-2).
  Inside the container the app listens on `0.0.0.0` (`AGT_<APP>_SERVER_HOST`, DEP-1), which the loopback-only
  published port keeps off the network. Making the app reachable from other machines is an explicit operator
  change, documented in the README's *TLS and reverse proxies* section together with the proxy setup (DEP-10).
  The server SHOULD write one `warn` server-log entry (source `security`) per process, the first time a login or
  setup request arrives over plain HTTP from a non-loopback address, saying that credentials were sent
  unencrypted and that a TLS proxy is needed.

### 10.3 CSRF and CORS

- **SEC-5** Every state-changing request to `/api/setup`, `/api/admin/*` (including login and logout) MUST
  carry `x-agt-request: 1`, otherwise `403 csrf`. Combined with `SameSite=Strict` cookies and no CORS, this
  blocks cross-site requests. The browser client adds the header automatically for non-GET requests.
- **SEC-6** Never register `@fastify/cors` or send `Access-Control-Allow-*` headers.

### 10.4 Rate limits

- **SEC-7** Register `@fastify/rate-limit` with `global: false` and apply per-route limits, configurable in
  `config.yaml`: login and password change (10 / 15 min), setup (10 / 15 min), admin uploads (120 / 15 min),
  every anonymous write (default 5 / 60 min, dashboard-editable), captcha challenges (60 / min). Rate-limit
  responses use the error body with `429 rate_limited`. Limits are counted per client address: keep the plugin's
  default key, `request.ip`, which honours `server.trustProxy` (SEC-4). Behind a proxy, a missing or wrong
  `trustProxy` makes every client share the proxy's address and therefore one limit.

### 10.5 Secrets

- **SEC-8** Secrets live only in these places:

  | Location | Holds | In backups |
  | --- | --- | --- |
  | `.env` | Operator-supplied secrets: `AGT_<APP>_SETUP_PASSWORD`, `AGT_<APP>_DB_PASSWORD`, other `AGT_<APP>_<NAME>` secrets (CFG-2) | No (BAK-2) |
  | `app_secrets` table (main database) | Generated secrets that belong to the data, e.g. the ALTCHA HMAC key (ALT-2), created at startup, never by a request (BAK-8) | Yes, as part of the database |
  | `log_meta` table (log store) | The IP-hash key only (LOG-12) | No (LOG-17) |

  The admin password hash (AUTH-2) and session token hashes (AUTH-8) are stored in their own tables and are not
  secrets in this sense, but the README still warns that backups contain the password hash (BAK-2). Secrets never
  appear in `config.yaml` (which is copied into backups byte for byte, BAK-2), logs, API responses, the OpenAPI
  document, error messages or the client bundle. Config keys that would hold a secret MUST NOT exist.

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
  from `altcha.*`). The HMAC key is generated once (32 random bytes) **at startup**, after migrations and before the
  server listens, if `app_secrets` has none, and again at the end of a restore (BAK-4 step 5) if the restored data
  has none, and stored there (SEC-8); requests only read it, so
  `GET /api/altcha/challenge` never writes the main database. It
  is never read from `config.yaml` or the environment. Each solved challenge is accepted **once** (atomically insert
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

### 12.1 Archive format

- **BAK-1** Every app MUST provide **Backup & restore** in the admin dashboard, backed by
  `GET /api/admin/backup` (download) and `POST /api/admin/restore` (multipart `backup` file +
  `action=preview|restore`).
- **BAK-2** A backup is one ZIP named `agt-<app>-backup-<ISO timestamp with : and . replaced by ->.zip`, for example
  `agt-event-calendar-backup-2026-11-10T06-30-59-123Z.zip`:

  ```text
  manifest.json        # see below
  database.sqlite      # SQLite apps: online-backup snapshot, sessions deleted, VACUUMed, journal_mode DELETE
  database.dump        # Postgres apps: pg_dump --format=custom --schema=public --no-owner --no-privileges --exclude-table-data=sessions
  uploads/<uuid>.<ext> # every stored upload
  config.yaml          # the current file, byte for byte, if one exists
  ```

  `.env` and the log store (LOG-17) are never included. For Postgres apps the log store is the `logs` schema of
  the same database (LOG-1), so `pg_dump` dumps only the app's `public` schema (DATA-11), which also leaves out the
  `control` schema of the shared operation lock (BAK-12). The README warns that backups contain the admin
  password hash and generated secrets and must be stored securely, and that only backups made by an AGT instance
  the operator trusts should be restored: a Postgres restore runs the SQL in the dump, within the limits of BAK-3.

  `manifest.json` (UTF-8 JSON) has exactly these fields:

  | Field | Type | Value |
  | --- | --- | --- |
  | `format` | string | `agt-<app>-backup` |
  | `formatVersion` | integer | `1` (BAK-7) |
  | `appVersion` | string | The app's SemVer version (VER-1) |
  | `schemaVersion` | integer | Database schema version (DATA-4) |
  | `createdAt` | string | ISO 8601 UTC, ending in `Z` (API-7) |
  | `files` | array | One `{ path, size, sha256 }` per archive entry **except `manifest.json` itself** |

  `path` is a relative POSIX path (`/` separators, no leading `/`, no `.` or `..` segments, no backslashes); `size`
  is the entry's uncompressed length in bytes; `sha256` is 64 lowercase hex digits. Every archive entry other than
  `manifest.json` MUST be listed, and every listed path MUST exist. Example:

  ```json
  {
    "format": "agt-event-calendar-backup",
    "formatVersion": 1,
    "appVersion": "2.2.0",
    "schemaVersion": 2,
    "createdAt": "2026-11-10T06:30:59.123Z",
    "files": [
      { "path": "database.sqlite", "size": 98304, "sha256": "<64 hex digits>" },
      { "path": "uploads/0b6c2f1e-7d4a-4c1e-9a52-3f0e8d2b6a71.webp", "size": 52144, "sha256": "<64 hex digits>" },
      { "path": "config.yaml", "size": 812, "sha256": "<64 hex digits>" }
    ]
  }
  ```

- **BAK-7** **Format compatibility.** `formatVersion` changes only when the archive layout or the manifest changes
  in a way an older app cannot read. An app MUST restore every `formatVersion` from `1` up to its own (older
  database schemas are migrated, BAK-4) and MUST refuse a newer one with `422 archive_rejected`. A change that
  makes the app write a new `formatVersion` is a MINOR app release if older backups still restore (VER-4).

### 12.2 Consistency and concurrency

- **BAK-8** **Operation lock.** Every app process has one local lock with four states: `idle`, `backup`, `restore`
  and `restore_failed` (BAK-11; it answers requests like `restore`). In a SQLite app it is the whole lock. In a
  Postgres app the database enforces the lock for every process (BAK-12): the local state follows the shared state
  and decides what requests are answered, while database locks decide which requests and writes may run.
  - A backup or restore starts only from `idle`; otherwise it returns `409 conflict` ("A backup or restore is
    already running.") without doing anything. The one exception is the recovery restore of BAK-11, which starts
    from `restore_failed`. The pre-restore backup (BAK-4) runs under the restore's own lock.
  - **Draining.** Entering a state waits for the requests and jobs that the state stops and that are **already in
    progress**: for `backup`, every data write (below); for `restore`, every `/api/` request and background job.
    New ones that the state stops are held from the moment the state is entered (`backup`) or refused (`restore`).
    The drain lasts up to 30 seconds. If something is still running then, the operation is abandoned: the lock
    returns to `idle`, nothing has changed, and the request gets `409 conflict` ("The server is busy. Try again.").
    A **data write** is any request or background job that changes the main database or `uploads/`, whatever its
    HTTP method; session rows (login, logout, expiry purges) are not data writes, because backups never contain
    sessions (AUTH-8) and a restore replaces them anyway. Every route declares it in its route options,
    `config: { writesData: true | false }`, and every job when it is registered; the barrier is applied from that
    declaration, never from the method. All writes to the main database and `uploads/` go through
    `withDataWrite(fn)` (`server/dataWrite.ts`), which applies the barrier (SQLite: the in-flight counter; Postgres:
    the BAK-12 write procedure) and marks the call with `AsyncLocalStorage`. Every repository and upload function
    that writes MUST check that mark and throw outside it, so an undeclared write fails in tests instead of
    slipping past a backup. Generated secrets are created at startup (ALT-2, SEC-8), never by a request. SQLite apps
    count data writes with an in-flight counter that
    each such request or job increments when it starts and decrements when it ends, including on error, and drain
    a restore with a second counter of every `/api/` request (except `GET /api/health`) and job. Postgres apps drain
    through database locks instead (BAK-12), which cover every process: the write lock for a backup, the activity
    lock and then the write lock for a restore. The process that runs the operation also drains its own requests
    with the local counters, because its own locks never block it.
  - **During `backup`:** reads proceed. A new data write waits for the lock to return to `idle`, for up to 30
    seconds, and then proceeds. Past 30 seconds it returns `503 maintenance` with `Retry-After: 10`.
  - **During `restore`:** every `/api/` request except `GET /api/health` returns `503 maintenance` with
    `Retry-After: 10` and the message "Maintenance in progress. Try again in a moment." `GET /api/health` returns
    `200 { "status": "maintenance" }`, so Docker does not restart the container mid-restore (SRV-11). Background
    jobs pause. HTML and static files are still served.
  - Clients show `503 maintenance` as a non-blocking "Maintenance in progress" notice (FE-5) and retry the request
    once after `Retry-After`; they never treat it as a sign-out.
- **BAK-9** **Consistent snapshot.** A backup starts only after the drain (BAK-8) has finished (Postgres: once the
  backup holds the exclusive write lock, BAK-12), and is created entirely while the `backup` state holds: the database snapshot (SQLite `db.backup()`; Postgres
  `pg_dump`) and the copy of `uploads/` are taken with no data write in between, so every upload the snapshot
  references is in the archive with the content it had at that moment.
- **BAK-12** **Shared operation lock (Postgres apps).** The processes of a Postgres app coordinate through the
  database. Three advisory locks do the fencing, and PostgreSQL enforces them across every process; the shared
  state row only decides how requests are answered.

  | Lock | Key | Held by |
  | --- | --- | --- |
  | Operation lock | `(0, hashtext('agt_<app_snake>_operation'))` | The backup or restore owner, exclusive, for the whole operation, so only one runs at a time |
  | Activity lock | `(0, hashtext('agt_<app_snake>_activity'))` | Every process, **shared**, while it has any `/api/` request (except `GET /api/health`) or job in progress; the restore owner, **exclusive**, while it works |
  | Write lock | `(0, hashtext('agt_<app_snake>_writes'))` | Every data write, **shared**, for its whole duration; the backup or restore owner, **exclusive**, while it works |

  PostgreSQL grants an exclusive request only when every other session holding the lock has released it, and queues
  new shared requests behind a waiting exclusive one. So taking the write lock exclusively drains the writes in
  progress in every process and holds back new ones, and taking the activity lock exclusively does the same for
  every request and job, however long a process is paused. A session's own locks never block it, so the owner's
  process drains its own requests with its local counters (BAK-8). Locks are always taken in the order operation,
  activity, write, and released in reverse, so no two holders can wait for each other. Advisory locks belong to one
  database; every check of `pg_locks` MUST include `database = (SELECT oid FROM pg_database WHERE datname =
  current_database())`.

  - **Control connection.** Each process opens one dedicated `pg.Client` (not from the pool) at startup and keeps it
    open for the life of the process. The owner holds the locks it takes on it, so they survive the pool being closed and
    recreated during a restore (BAK-4). A follower reconnects it if it drops.
  - **Control schema.** The `control` schema has its own numbered migrations in
    `server/migrations/control/NNNN_*.sql`, listed in `CONTROL_MIGRATIONS` and recorded in
    `control.schema_migrations` (same columns as DATA-11's `schema_migrations`). They are separate from the app's
    migrations because a restore replaces the app's schema but never this one. `0001_operation.sql` is:

    ```sql
    CREATE TABLE control.operation (
      id integer PRIMARY KEY CHECK (id = 1),
      state text NOT NULL CHECK (state IN ('idle', 'backup', 'restore', 'restore_failed')),
      generation bigint NOT NULL,
      owner uuid,                  -- process running the operation (crypto.randomUUID() at startup)
      started_at timestamptz,
      pre_restore_backup text,     -- file name, set once BAK-4 step 3 has written it
      admin_session_hash text,     -- BAK-11 recovery session: SHA-256 of the restoring admin's session token,
      admin_username text,         --   their username,
      admin_session_expires_at timestamptz  --   and that session's expiry (AUTH-8)
    );
    INSERT INTO control.operation (id, state, generation) VALUES (1, 'idle', 0);
    ```

    A later spec or app version changes the control schema only by adding a migration, never by editing a released
    one. `pg_dump` excludes the `control` schema (BAK-2), and restore never touches it (BAK-4).
  - **Startup.** Each process runs these steps on its control connection before it listens or runs jobs:
    1. Take the **migration lock** `pg_advisory_lock(0, hashtext('agt_<app_snake>_migrations'))` (session level;
       it waits for another starting process). Everything up to step 6 runs under it, so processes that start
       together set up and migrate one at a time.
    2. `CREATE SCHEMA IF NOT EXISTS control` and `CREATE TABLE IF NOT EXISTS control.schema_migrations (…)`, then
       run the pending `CONTROL_MIGRATIONS`, each in its own transaction. A control schema newer than the app knows
       stops the server (SRV-8).
    3. Refuse to start if the BAK-11 marker file exists or `control.operation.state` is `restore_failed`.
    4. Run the pending `LOG_MIGRATIONS` (LOG-1).
    5. Run the pending app migrations (DATA-4, DATA-11) while holding the shared write lock with `state` `idle`
       (as for any data write, below), so they never run during a backup or restore; if the state is not `idle`,
       release the write lock, wait a second and try again.
    6. Release the migration lock, read `control.operation` and set the local state (**Following**).
  - **Activity lease and admission.** Each process holds the activity lock **shared** on its control connection
    while at least one `/api/` request (except `GET /api/health`) or job is in progress in it, counted with an
    in-flight counter. **Every** new request and job is admitted through the process's control-connection queue
    (calls on it are serialized), before its handler starts:
    1. If the counter is 0, take the lease: `SET lock_timeout = '30s'`, then
       `SELECT pg_advisory_lock_shared(0, hashtext('agt_<app_snake>_activity'))`. While a restore owner is waiting
       for or holding the lock exclusively, this waits behind it; on a timeout the request gets `503 maintenance`
       (a job retries later).
    2. Read `SELECT state, admin_session_hash, admin_session_expires_at FROM control.operation WHERE id = 1`, even
       when the lease is already held, and set the local state from it.
    3. Admit by state:

       | State | Admitted |
       | --- | --- |
       | `idle`, `backup` | Every request and job |
       | `restore` | Nothing new (the restore request itself was admitted before it started the restore) |
       | `restore_failed` | Only `GET /api/admin/session` and `POST /api/admin/restore` from the recovery session (BAK-11): the SHA-256 of the request's session token equals `admin_session_hash` and `now()` is before `admin_session_expires_at`. The restored `sessions` table is never consulted. No job is admitted |

       Anything not admitted gets `503 maintenance` and never reaches its handler.
    4. An admitted request or job increments the counter and decrements it when it ends, including on error. When
       the counter returns to 0, the process runs `pg_advisory_unlock_shared(…activity)`.

    A request admitted from `idle` before an owner's state update commits is in progress, and the owner's exclusive
    request drains it; a request that reads `restore` is refused even while other requests keep the lease open,
    because PostgreSQL grants a session's repeated request for a lock it already holds.

    **Lock holds on one connection.** A backup or restore request is itself admitted under its process's lease, so
    the owner's control connection holds the activity lock shared (the lease) and then, for a restore, exclusive.
    PostgreSQL counts the two separately: `pg_advisory_unlock(…activity)` releases the owner's exclusive hold once,
    at **Finishing**, and the lease's shared hold is released once, by step 4. This is the same for a normal and a
    recovery restore.

    If the control connection fails, the lease is gone: the process aborts every `/api/` request in progress
    (`503 maintenance`, through an `AbortSignal` that handlers and file streams honour), pauses its jobs, and
    answers new ones with `503` until it has reconnected and taken a new lease.
  - **Every data write** (BAK-8: requests and background jobs, through `withDataWrite()`) runs inside the activity
    lease, on one client from the pool, in this order:
    1. `SET lock_timeout = '30s'`, then `SELECT pg_advisory_lock_shared(0, hashtext('agt_<app_snake>_writes'))`. On
       a lock timeout (SQLSTATE `55P03`) return `503 maintenance` with `Retry-After: 10` (a job retries later).
    2. `BEGIN`, then `SELECT state FROM control.operation WHERE id = 1`, and act on it:
       - `idle`: continue.
       - `backup`: a backup has started but its owner does not hold the write lock yet. Roll back, unlock, wait one
         second and go back to step 1, until the state is `idle` or 30 seconds have passed since the write started;
         then return `503 maintenance` with `Retry-After: 10`. This keeps BAK-8's promise that a write during a
         backup waits.
       - `restore` or `restore_failed`: roll back, unlock and return `503 maintenance` at once.

       This check inside the lock is what keeps writes out after an owner fails or before a process has seen the new
       state.
    3. Write new upload files, change the database, `COMMIT`, then delete the files of removed uploads.
    4. In a `finally`: `SELECT pg_advisory_unlock_shared(…)`, `RESET lock_timeout`, and release the client
       (`client.release(err)` destroys it after an error).

    The shared lock is session-level, so it covers the file work after `COMMIT` too. If the client's connection
    fails at any point, its lock is gone: the write MUST stop at once and touch no more upload files. Writes MUST
    NOT write the main database or `uploads/` any other way.
  - **Starting an operation.** The owner, on its control connection:
    1. `pg_try_advisory_lock` on the operation lock; if it fails, return `409 conflict` (BAK-8).
    2. In one transaction, `UPDATE control.operation SET state = <'backup' or 'restore'>, generation = generation +
       1, owner = <this process>, started_at = now() WHERE id = 1 AND state = 'idle'` (a recovery restore: `WHERE
       id = 1 AND state = 'restore_failed' AND admin_session_hash = <caller's hash>`, BAK-11). A restore also stores
       the recovery session (BAK-11) in `admin_session_hash`, `admin_username` and `admin_session_expires_at`, so it
       exists even if the owner dies (a recovery restore keeps the stored one). If no row was updated, return
       `409 conflict`.
    3. A restore takes the activity lock exclusively: `SET lock_timeout = '30s'`, `pg_advisory_lock(…activity)`.
       Once it has it, no request or job runs in any other process.
    4. Both take the write lock exclusively, with the same timeout. Once the owner has it, no write runs in any
       process.

    On a timeout in step 3 or 4, set `state` back to what it was (`idle`, or `restore_failed` for a recovery
    restore) and return `409 conflict` ("The server is busy. Try again."). **Every** exit after step 1, including
    each `409` and every error, releases the locks this owner took, in reverse order, in a `finally`.
  - **Finishing.** The owner sets `state` to `idle` and clears `pre_restore_backup` and the three recovery session
    columns (or sets `state` to `restore_failed` and keeps them, BAK-11), then releases the write lock, the activity
    lock if it holds it, and the operation lock. Requests and writes waiting for a lock then read the state: on
    `idle` they proceed; on `restore_failed` they get `503 maintenance`.
  - **Owner connection loss.** The owner listens for `error` and `end` on its control connection. Either one during
    an operation fails it **at once**, because PostgreSQL has released its locks: kill the `pg_dump` or
    `pg_restore` child (`SIGTERM`, then `SIGKILL` after 5 seconds), stop all file work (check an abort flag before
    every file operation), and answer the request with `500 internal`. A backup leaves the data unchanged; a restore
    enters `restore_failed` in that process and writes the BAK-11 marker. The owner never continues an operation on
    a new connection.
  - **Following.** Every process reads `control.operation` at least once a second on its control connection (it
    MAY also `LISTEN` for a `NOTIFY` from the owner) and sets its local state to match, which decides the
    `503 maintenance` answers of BAK-8 and the health status (SRV-11). A process MUST read it and set its local
    state **before** it starts listening or running jobs (**Startup**, step 6). After a restore, each process closes and recreates its
    `pg.Pool` before it serves `/api/` requests again, so no connection keeps state from the replaced schema. Polling
    only decides the answers: the activity lock, not the poll, keeps every request out of a restore.
  - **Owner failure.** If a process sees `state` `backup` or `restore` while no session holds the operation lock,
    the owner died. Check with `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND database =
    (SELECT oid FROM pg_database WHERE datname = current_database()) AND classid = 0 AND objid =
    hashtext('agt_<app_snake>_operation')::oid AND objsubid = 2` (no row: not held). Then:
    - `backup`: nothing has changed; it sets `state` to `idle`.
    - `restore`: the data may be half replaced; it sets `state` to `restore_failed`, writes the BAK-11 marker naming
      `pre_restore_backup` (or `null` if step 3 had not finished), and writes a server log `error` (source `backup`).
    Use a conditional `UPDATE … WHERE generation = <seen generation>` so only one process acts. Until then, writes
    stay out because the state is not `idle` (step 2 above).
  - Sessions are rows in the shared database, so ending all sessions (BAK-4 step 6) ends them in every process.

### 12.3 Restore

- **BAK-3** Restore MUST first run a **preview** that validates without changing anything: manifest format
  and checksums (BAK-2, BAK-7), only expected paths, size and entry limits, database integrity
  (SQLite: `PRAGMA integrity_check` on the extracted file; Postgres: the steps below), schema version (older → will
  be migrated; newer → refused),
  required tables, every upload through the image checks, and the admin row's password hash, if there is one,
  through the AUTH-2 check (a hash that fails it is rejected with `422 archive_rejected`, because it could never
  sign in). The preview reports counts, warnings and how the
  backup's `config.yaml` differs from the current one.

  **Postgres preview.** A Postgres dump can only be checked by restoring it, so the preview does that in the
  preview database `database.previewName` (default `agt_<app_snake>_preview`), which installation creates, owned
  by the app role (DEP-3, DEP-6). Previews run one at a time: take
  `pg_try_advisory_lock(0, hashtext('agt_<app_snake>_preview'))` on a pool client, else `409 conflict`.
  1. **Allowlist.** Read the table of contents with `pg_restore --list`. Every entry MUST be one of these, or the
     archive is rejected with `422 archive_rejected` naming the first entry that is not:

     | Entry type | Allowed when |
     | --- | --- |
     | `SCHEMA - public`, `COMMENT - SCHEMA public` | Always; removed from the list, never restored |
     | `TABLE`, `TABLE DATA` | Schema `public`, name in `EXPECTED_TABLES` or `schema_migrations` |
     | `SEQUENCE`, `SEQUENCE OWNED BY`, `SEQUENCE SET`, `DEFAULT`, `CONSTRAINT`, `FK CONSTRAINT`, `INDEX` | Schema `public` |
     | Any entry in schema `logs` or `control`, and `SCHEMA - logs` / `SCHEMA - control` | Dumps made before 6.0.0 (`logs` before 5.1.0); removed from the list with the warning that log tables are ignored |

     Everything else, including `FUNCTION`, `PROCEDURE`, `TRIGGER`, `EVENT TRIGGER`, `VIEW`, `MATERIALIZED VIEW`,
     `EXTENSION`, `ACL`, `RULE`, `POLICY`, `TYPE`, any other schema and any `OWNER` change, is rejected. Write the
     remaining entries to a list file; restore and BAK-4 both use exactly that list.
  2. **Empty the preview database:** `DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;` as the app role.
  3. **Restore** with `pg_restore --dbname=<preview> --no-owner --no-privileges --exit-on-error
     --single-transaction --use-list=<list>`, under the same size limits as the archive, and a 10-minute timeout
     (`SIGTERM`, then `SIGKILL`).
  4. **Check** there: `schema_migrations` gives the schema version; every table in `EXPECTED_TABLES` exists; the
     admin row's hash passes AUTH-2; foreign keys hold (the restore re-created them); every upload the data
     references is in the archive.
  5. **Clean up** in a `finally` (step 2's statements) and release the lock. A process also empties the preview
     database at startup, after a preview cut short by a crash, but only while holding the same preview lock: it
     calls `pg_try_advisory_lock` on it and, if another process holds it, skips the cleanup (that preview empties
     the database in its own `finally`). It never drops the preview schema without the lock.

  The app role is not a superuser (DATA-11), so even a dump that passes the allowlist can only create and fill
  tables in the two databases that role owns.

  `action=restore` re-uploads the archive and MUST run the full preview validation on that upload again before it
  changes anything. It never relies on an earlier preview, so there is no preview token or server-side state
  between the two requests.
- **BAK-4** Restore then runs these steps in order:
  1. Validate the upload (BAK-3). On any rejection, stop: nothing has changed.
  2. Take the `restore` lock and drain (BAK-8; Postgres apps: in every process, BAK-12). If the drain does not
     finish within 30 seconds, return `409 conflict` ("The server is busy. Try again.") without changing anything.
  3. Write an automatic pre-restore backup to `<backupsDir>/pre-restore-backup-<timestamp>.zip` and keep it
     (Postgres apps: then store its file name in `control.operation.pre_restore_backup`, BAK-12). Postgres apps
     also write the **rollback list**: `pg_restore --list` of that backup's own dump, run through the BAK-3
     allowlist, saved as `<backupsDir>/pre-restore-backup-<timestamp>.list` and deleted together with the backup.
     A table of contents is specific to its archive (each line starts with that archive's dump IDs), so the
     incoming archive's list can never be used for the pre-restore dump. If the pre-restore dump fails the
     allowlist, stop with `500 internal` before step 4: nothing has changed.
  4. Replace the database and the uploads:
     - SQLite: prepare the new files beside the live ones, checkpoint and close `context.db`, rename the live files
       aside, rename the new ones into place, and reopen `context.db`.
     - Set-aside paths are the live names plus `.restore-old-<timestamp>` (same timestamp format as BAK-2), for
       example `agt-calendar.sqlite.restore-old-2026-11-10T06-30-59-123Z` and `uploads.restore-old-…`, so they never
       collide with a path an earlier restore left behind.
     - Postgres: close the `pg.Pool` (`await pool.end()`), run `pg_restore --clean --if-exists --single-transaction
       --no-owner --no-privileges --exit-on-error --use-list=<list>` with the list the preview wrote from the
       allowlist (BAK-3), and create a new pool. Then rename the uploads directories
       as for SQLite.
  5. Run pending migrations, then a **health check** on the restored data: `PRAGMA integrity_check` returns `ok`
     and `PRAGMA foreign_key_check` returns no rows (Postgres: the restore committed, and `SELECT 1` works on the new
     pool); the schema version is the app's (DATA-4); every table in `EXPECTED_TABLES` exists; every upload the
     database references exists in `uploads/`.
  6. Finish, in this order:
     1. **Commit** (part of the restore): in one database transaction on the restored data, delete the dashboard
        settings whose keys `config.yaml` now locks (CFG-7) and every row of `sessions` (a backup has none, so this
        only makes sure). If this transaction fails, the restore has failed: roll back (BAK-10).
     2. **Clean up** (warnings only): delete the paths set aside in step 4. The restored data is live and checked by
        now, so a failure here does not roll back: the restore still succeeds, its report lists each path left
        behind as a warning, and a server log `warn` (source `backup`) names them. The operator deletes them by hand
        (README Troubleshooting); an app MUST NOT delete them automatically later, because after a failed rollback
        they may hold the only copy of the data.
     3. **Release the lock** (BAK-8; Postgres apps: set `control.operation` to `idle` and release the advisory
        lock, BAK-12) in a `finally`, so a failure in step 6.2 never leaves it held.
     4. **Respond** `200` with the report (counts, the dropped locked settings, warnings) and clear the caller's
        session cookie: the restored admin account replaces the current one, so the caller signs in again.

     A restore reports success only after step 6.1 has committed. Nothing in step 6.2 or 6.3 changes that outcome.

  The log store is left untouched, and the restore itself is audited (LOG-17).

  Postgres apps MUST NOT restore anything except what BAK-3's allowlist keeps: never the `logs` or `control`
  schemas, and never the `SCHEMA - public` entry (restoring it fails with "schema public already exists"). Exclusion
  flags are not a substitute: `--exclude-schema=logs` skips the objects in the schema but still runs
  `DROP SCHEMA IF EXISTS logs`, which fails the restore.
- **BAK-10** **Rollback.** If step 4, 5 or 6.1 of BAK-4 fails, the app rolls back before releasing the lock: SQLite renames
  the set-aside files back and reopens them; Postgres restores the pre-restore backup's dump with
  `pg_restore --clean --if-exists --single-transaction --no-owner --no-privileges --exit-on-error
  --use-list=<rollback list>` (BAK-4 step 3), never with the incoming archive's list; both rename the uploads back. It then runs the step 5 health check again. If that passes,
  the restore request returns `500 internal` with the message "The restore failed and was rolled back. Nothing was
  changed.", the lock returns to `idle`, and a server log `error` (source `backup`) records the cause. Sessions are
  ended only by a successful restore.
- **BAK-11** **Failed rollback.** If the rollback itself fails, or the owner of a restore fails (BAK-12), the app
  MUST NOT serve the data:
  - It moves to the `restore_failed` state (BAK-8; every `/api/` request gets `503 maintenance` as in `restore`), writes a server log `error`
    (source `backup`) naming the pre-restore backup file, and writes the marker file `<dataDir>/restore-failed.json`
    (`{ "preRestoreBackup": "<file name or null>", "failedAt": "<ISO 8601>" }`). Postgres apps also set
    `control.operation.state` to `restore_failed`, so every process moves to that state (BAK-12).
  - **Recovery session.** When a restore starts, the app records the restoring admin's session: the SHA-256 of its
    token, the username and the session's expiry (AUTH-8). SQLite apps keep it in memory; Postgres apps store it in
    `control.operation` in the same transaction that sets `restore` (BAK-12), so it survives the owner. While the
    restore is failed, that session, and only that one, is accepted despite the maintenance state, for
    `GET /api/admin/session` (which returns the recorded username) and `POST /api/admin/restore` only, and only
    until the recorded expiry; the session table restored by the failed attempt is never consulted. After the expiry,
    recovery is by hand (README). A successful restore deletes the marker file, clears the recovery session and
    `pre_restore_backup`, and returns to `idle`; so does every other normal end of a restore.
  - **Recovery restore.** A `POST /api/admin/restore` from the recovery session while the state is
    `restore_failed` (Postgres: with the marker file present) is the only operation that starts from that state
    (BAK-8). Its preview (`action=preview`) works as usual. With `action=restore` it moves `restore_failed` to
    `restore` (BAK-12 **Starting an operation**, step 2, with the recovery condition) and takes the locks like any
    restore, so normal traffic never resumes in between, and then runs BAK-4 with these differences:
    - Step 3 is skipped: the live data is the half-restored data, and the original pre-restore backup stays named in
      `pre_restore_backup` and the marker file.
    - There is nothing to roll back to, so a failure in step 4, 5 or 6.1 skips BAK-10: the state returns to
      `restore_failed` with the marker file, the recovery session and its expiry unchanged, and the request gets
      `500 internal` ("The restore failed. The app stays in maintenance.").
    - On success, step 6 ends as for any restore: marker file deleted, recovery session and `pre_restore_backup`
      cleared, state `idle`, all sessions ended and the caller signed out.
    Any other session, or the recovery session after its expiry, gets `503 maintenance` as before. Postgres apps
    admit the recovery session's requests through the activity lease by this same rule (BAK-12, **Activity lease and
    admission**).
  - **Startup.** A process refuses to start (SRV-8) while the marker file exists **or** (Postgres)
    `control.operation.state` is `restore_failed`, with a message naming the pre-restore backup and the README
    section that explains how to restore it by hand. If only one of the two is present, it also refuses, and the
    message names the one that is missing: the app never clears `restore_failed` because a file is absent (the
    shared data directory may be missing or not yet mounted). Once the data is restored, the operator clears both
    explicitly: deletes the marker file and (Postgres) runs `UPDATE control.operation SET state = 'idle',
    pre_restore_backup = NULL, admin_session_hash = NULL, admin_username = NULL, admin_session_expires_at = NULL
    WHERE id = 1 AND state = 'restore_failed'`, as the README's Troubleshooting section shows.

- **BAK-5** Restore MUST NEVER write `config.yaml`. If the backup contains one, the preview shows a line diff
  and offers it for download; the README explains how to put it in place by hand.
- **BAK-6** Postgres apps run `pg_dump`/`pg_restore` as child processes, as the app role (never a superuser,
  DATA-11), with the password in the `PGPASSWORD` environment variable of the child (never on the command line), and
  the client version MUST be ≥ the server major version.

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
- **FE-5** Every load and mutation has visible loading, success and error states. Errors show the translated text of the
  `error` code and of each field `code`, next to their fields (I18N-6); the server's English `message` is only the
  fallback for unknown codes. Long operations (import, restore) show a preview
  first and require an explicit confirm. `503 maintenance` is shown as a non-blocking notice and retried once
  after `Retry-After` (BAK-8).
- **FE-6** Forms validate with the same `src/lib/validation.ts` functions the server uses, so field codes and
  messages match (I18N-6). The server remains the authority.
- **FE-7** Icons are inline React SVG components in `src/components/Icons.tsx` (`aria-hidden="true"`), never
  an icon font or external sprite.
- **FE-8** Framework-free logic (date math, filtering, parsing, validation, settings) lives in `src/lib/`
  with unit tests; components stay thin.

## 15. Visual design system

The AGT look is dark, high-contrast, orange-on-black with red accents, matching the AGT brand.
All AGT apps MUST look like one family.

### 15.1 Tokens

- **UI-1** These tokens are defined by the AGT base stylesheet (UI-16), which apps import unchanged; the block
  below is a copy of its `:root` rule for reference. The admin entry imports `src/styles.css` (and with it the base
  stylesheet) before `src/admin/admin.css`. Use tokens (`var(--…)`) instead of raw colours in component CSS; add new tokens to this spec first.

  ```css
  :root {
    color-scheme: dark;
    font-family: 'NMS Futura', Inter, ui-sans-serif, system-ui, sans-serif;
    color: #ffb451;
    background: #0a0a0a;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
    --agt-orange: #ffb451;      /* primary text accent, links, focus ring */
    --agt-red-orange: #cb4c2b;  /* primary buttons, scrollbar; white text on it is 4.56:1 */
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
  The community `NMS Alphabet` font (Expedition alphabet, FontStruct) is not an AGT asset: its licence prohibits
  hosting it as a web font, so apps do not bundle it.
- **UI-14** Portal codes MUST be displayed as No Man's Sky portal glyphs using the bundled **NMS Glyphs Mono**
  typeface, copied from the spec repository's `assets/fonts/` (UI-15) to `public/NMS-Glyphs-Mono-fixed2026.ttf` (internal
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
  (decorative: `alt=""` and `aria-hidden="true"` next to visible brand text). Copy brand assets from the spec
  repository's `assets/` (UI-15); never hotlink them.
- **UI-15** **Asset sources and licences.** The logo and fonts named in UI-3, UI-5 and UI-14, and the base stylesheet (UI-16), come from
  [`assets/`](https://github.com/agtdarkshadow04/agt_webapp_specification/blob/v6.0.0/assets/README.md) in the spec's source repository, at the tag of the spec version the app follows.
  Copy them unmodified, under the same file names, and check each file against the SHA-256 in `assets/README.md`.
  The fonts' licences make the next two points conditions of redistribution, so they are requirements:
  - **Licence files.** Apps MUST ship, unmodified, `public/fonts/NMSFuturaProBook-OFL.txt` (OFL 1.1 requires the
    licence to travel with the font) and, if they bundle the flag font, `public/fonts/TwemojiCountryFlags-LICENSE.md`
    (MIT notice and CC BY 4.0 attribution), copied from `assets/licenses/` and checked against their SHA-256. They
    are served and included in the Docker image like every other file in `public/`.
  - **Credits.** The README MUST have a **Credits** section (DOC-1) with one entry per bundled font, giving its
    name, everyone in its **Credit** column in `assets/README.md` (for the two No Man's Sky fonts, NMS Futura and NMS
    Glyphs Mono, their embedded authors and Hello Games), its licence with a link to the licence (or to the shipped
    licence file), and its source link. For NMS Glyphs Mono (CC BY-NC-SA 4.0), the entry also states that the font
    is used unmodified and only non-commercially. The base stylesheet and the logo need no entry.

  No modification notice is needed, because apps MUST NOT modify the assets. The licences themselves apply whatever
  this spec says:
  the AGT logo is © Alliance of Galactic Travellers with all rights reserved and is used only in AGT apps, and
  NMS Glyphs Mono is CC BY-NC-SA 4.0, so an app that shows portal glyphs is non-commercial.

### 15.3 Page chrome

- **UI-6** `html, body { min-width: 300px }`. The body background is `--bg` with two subtle radial gradients
  and a faint 40 px grid overlay (`body::before`, fading out towards the bottom), as defined in the base stylesheet
  (UI-16).
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

- **UI-9** Use these classes from the base stylesheet (UI-16); don't restyle or reinvent them:

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
- **UI-11** Transitions are 0.15 s ease on colour, background, border, transform and shadow. The base stylesheet
  (UI-16) disables all animation and transitions under `@media (prefers-reduced-motion: reduce)`; app CSS keeps
  its own animations within that override.
- **UI-16** **Base stylesheet.** The normative CSS is the file `assets/css/agt-base.css` in the spec's source
  repository, at the tag of the spec version the app follows. It contains the UI-1 tokens, the UI-3 and UI-14
  `@font-face` rules, the UI-6 page background, the UI-9 components, the UI-10 focus, selection and scrollbar
  styles, the UI-11 reduced-motion override and the `.portal-glyphs` class. Apps MUST:
  - copy it unmodified to `src/agt-base.css` (its SHA-256 is listed in `assets/README.md`, UI-15);
  - import it first, with `@import './agt-base.css';` as the first rule of `src/styles.css`;
  - put app-specific rules after it, never edit it, never redefine its tokens, and never override its rules for
    the UI-9 classes (add a modifier class for a variant instead).

  A change to the base stylesheet is a spec change (SPEC-4); apps pick it up when they move to the new spec
  version.
- **UI-12** Responsive breakpoints: `1180px`, `760px`, `520px` (public) and `640px` (forms/admin). Layouts
  MUST work from 300 px wide without horizontal page scrolling; wide tables scroll inside their container.
- **UI-13** Media and sound never auto-play with sound. Any ambient audio (like the AGT anthem) is off until
  the user turns it on, and the choice is stored in user settings.

## 16. Accessibility

- **A11Y-1** Target WCAG 2.2 AA. Text contrast ≥ 4.5:1. Use only these token pairs for text, and check any new
  pair with the WCAG 2.x formula before using it (UI controls and borders need ≥ 3:1):

  | Text | on `--bg` | on `--surface` | on `--surface-raised` | on `--surface-soft` |
  | --- | --- | --- | --- | --- |
  | `#fff` (headings) | 19.80 | 18.88 | 18.10 | 17.40 |
  | `--text` | 17.92 | 17.09 | 16.38 | 15.75 |
  | `--agt-orange` | 11.22 | 10.70 | 10.25 | 9.86 |
  | `--muted` | 7.29 | 6.95 | 6.66 | 6.41 |
  | `--agt-red` | 4.97 | 4.74 | 4.54 | 4.37: **not for text** |

  White text on `--agt-red-orange` (`.button-primary`) is 4.56:1. Never put `--agt-red` text on `--surface-soft`
  (hover and nested surfaces); use `--text` with a red border or icon there instead.
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

  `Code` is the value stored in preferences and used as a key; it is a BCP 47 language tag. Where the region
  matters, use the full BCP 47 tag for `<html lang>`, `Intl` formatters and the `hreflang` of links: `pt-BR` for
  `pt`. Every other code is its own tag. Changing a stored code would reset visitors' saved preferences, so codes
  are never renamed. Adding a locale means adding it to this table first, then to every app.
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
  `message`s are English (API-6); the client translates them (I18N-6).
- **I18N-6** **Translated errors.** The client MUST show every error in the user's language:
  - `src/translations.ts` (and `src/admin/i18n.ts` for admin-only codes) has one string for every standard `error`
    code, every standard field `code` (API-6) and every app-specific code, in all locales, with `{{param}}` placeholders
    (I18N-2) filled from `params` by `formatTranslation()`. Field strings also get the translated field label as
    `{{field}}`. Example: `too_long` → `"{{field}} must be at most {{max}} characters."`.
  - `src/lib/errors.ts` exports `errorText(error, translations)` and `fieldErrorText(fieldError, label,
    translations)`; FE-5 uses only these. They fall back to the server's English `message` only for a code the
    client does not know (e.g. an older client talking to a newer server).
  - The shared validators (FE-6) return `FieldError`s with `code` and `params`, so a form shows the same translated
    text whether the client or the server found the problem.

## 18. Deployment

Installation instructions assume Ubuntu 24.04 LTS or Debian 12/13. Both methods MUST be documented in
`README.md` and kept working.

### 18.1 Docker Compose

- **DEP-1** `Dockerfile` (two stages; adjust `<APP>`):

  ```dockerfile
  # syntax=docker/dockerfile:1
  FROM node:26-bookworm-slim AS build
  RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY . .
  RUN npm run build && npm prune --omit=dev

  FROM node:26-bookworm-slim AS runtime
  # Postgres apps: install postgresql-client-<server major> from the PGDG apt repository here (BAK-6).
  ENV NODE_ENV=production \
      AGT_<APP>_CONFIG_FILE=/app/config.yaml \
      AGT_<APP>_SERVER_HOST=0.0.0.0
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
      # Plain HTTP only, so the port is published on this host's loopback interface only (SEC-4).
      # Put a TLS-terminating reverse proxy in front (README: TLS and reverse proxies) and set
      # server.trustProxy. Publish on another interface only if that proxy runs on another machine.
      ports:
        - "127.0.0.1:<port>:<port>"
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
- **DEP-3** Postgres apps add a database service and wire it up. Do not publish the database port. The image's
  bootstrap superuser (`postgres`) is used only by the init script on first start; the app connects as the
  non-superuser `agt_<app_snake>` (DATA-11) and never receives the superuser password, which lives in `.env.db`, a
  file only the `db` service reads.

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
      env_file: .env.db                      # POSTGRES_PASSWORD (the bootstrap superuser's) only
      environment:
        AGT_<APP>_DB_PASSWORD: ${AGT_<APP>_DB_PASSWORD:?Set AGT_<APP>_DB_PASSWORD in .env}
      volumes:
        - <app>-db:/var/lib/postgresql
        - ./deploy/postgres-init:/docker-entrypoint-initdb.d:ro
      security_opt:
        - no-new-privileges:true
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U postgres -d agt_<app_snake>"]
        interval: 10s
        timeout: 5s
        retries: 5

  volumes:
    <app>-data:
    <app>-db:
  ```

  `deploy/postgres-init/10-app-role.sh` (run once, when the volume is empty):

  ```sh
  #!/bin/sh
  set -eu
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v app_password="$AGT_<APP>_DB_PASSWORD" <<'SQL'
  CREATE ROLE agt_<app_snake> LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
  CREATE DATABASE agt_<app_snake> OWNER agt_<app_snake>;
  CREATE DATABASE agt_<app_snake>_preview OWNER agt_<app_snake>;
  SQL
  ```

  `.env.db.example` holds one line, `POSTGRES_PASSWORD=`, with a comment that it is the database superuser's
  password, needed only by the `db` container and for maintenance with `docker compose exec db psql -U postgres`.
  `.env.db` is covered by REPO-2's `.env.*` rule and never included in backups.

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
  # 1. Node.js 26 from NodeSource, and build tools for native modules
  curl -fsSL https://deb.nodesource.com/setup_26.x -o /tmp/nodesource_setup.sh
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
  (`sudo -u postgres createuser --pwprompt --no-superuser --no-createdb --no-createrole agt_<app_snake>`,
  `sudo -u postgres createdb --owner agt_<app_snake> agt_<app_snake>` and
  `sudo -u postgres createdb --owner agt_<app_snake> agt_<app_snake>_preview`), put the password in `.env` as
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

  With a proxy, set `server.trustProxy` to the address the app sees the proxy connect from: `127.0.0.1` for a
  local installation, or the Docker network's gateway or the proxy container's address/CIDR for Docker. Keep
  `session.secureCookie: auto`. The defaults (SEC-4) already suit a proxy on the same host. Only if the proxy
  runs on another machine, set `server.host` (local) or the published address in `docker-compose.yml` (Docker)
  to an interface that proxy can reach, and restrict that port to the proxy's address with a firewall.

## 19. Testing and tooling

- **TEST-1** `package.json` scripts MUST be:

  | Script | Command |
  | --- | --- |
  | `dev` | `vite` (proxies `/api` to the server port) |
  | `dev:server` | `npm run build:server && node dist-server/index.mjs` |
  | `build` | `npm run build:client && npm run build:server` |
  | `build:client` | `tsc -b && vite build` |
  | `build:server` | `esbuild server/index.ts --bundle --platform=node --target=node26 --format=esm --packages=external --loader:.sql=text --outfile=dist-server/index.mjs` |
  | `start` | `node dist-server/index.mjs` |
  | `lint` | `tsc -b --pretty false` |
  | `test` | `npm run test:client && npm run test:server` |
  | `test:client` | esbuild `src/lib/*.test.ts` → `.test-build/client`, then `node --test` |
  | `test:server` | esbuild `server/test/*.test.ts` → `.test-build/server`, then `node --test --test-concurrency=1` |
  | `check` | `npm run lint && npm test && npm run build` |

  Every app also has `test:e2e` (`npm run build && playwright test`, TEST-6). It is not part of `check`,
  because it needs a browser, which `npm ci` does not install (TEST-6).
- **TEST-2** `npm run check` MUST pass before every commit and in CI. CI MUST also run `npm run test:e2e` (TEST-6).
- **TEST-3** Client tests run in plain Node without a DOM; stub `globalThis.window` / `localStorage` where
  needed. Server tests use `createTestServer()` from `server/test/helpers.ts`, which creates a temp data dir,
  a cheap ALTCHA cost, and returns `{ app, context, close() }`; tests call `app.inject()` and close servers in
  `after()`. Postgres apps create a unique database per test server, and its preview database, through the server given by
  `AGT_<APP>_TEST_DATABASE_URL` (a role with `CREATEDB`, used only by tests), and drop both on close; the app
  inside the test connects as a non-superuser role, as in production.
- **TEST-4** Required test coverage, at minimum:
  - first-run setup: a setup password longer than 1024 characters stops startup while no admin exists (AUTH-5);
    a username that is empty after trimming, or 65 characters long, is rejected with `400` (AUTH-3);
    unset password (503), wrong password (401), reuse of setup password (400), missing CSRF
    header (403), success (201 + session), disabled after setup (410) even while the variable is set;
  - password hashing: hash a password and verify it with the exact production options (AUTH-2), and a wrong
    password fails verification; stored hashes with hostile or unsupported parameters (for example `N = 2^30`,
    `r = 1024`, `p = 0`, `N = 16384`), a wrong field count, a non-numeric or leading-zero parameter, and a salt or
    hash of the wrong length are rejected with `401 invalid_credentials` without calling scrypt (spy on it); a
    backup whose admin hash fails the check is rejected by the preview;
  - login, logout, session expiry, password change ends other sessions;
  - every admin route rejects requests without a session (401) and mutations without CSRF (403);
  - config: unknown key and invalid value rejected; precedence; `409 defined_in_config`;
  - OpenAPI completeness (API-13);
  - security headers and CSP present on HTML and API responses;
  - uploads: magic-byte detection, SVG rejected, mismatched type rejected, size limit;
  - ALTCHA (if present): valid, replayed, expired;
  - backup round trip; restore preview; tampered checksum rejected; newer schema refused; locked settings
    skipped; `config.yaml` never written; pre-restore backup created;
  - backup format: the manifest has exactly the BAK-2 fields, lists every entry but itself, and uses safe relative
    paths; an archive with an unlisted entry, a missing listed entry, a `..` path or a newer `formatVersion` is
    rejected (BAK-2, BAK-7);
  - data writes (BAK-8): every registered `/api/` route declares `config.writesData` (iterate the routes as in
    API-13); calling a writing repository or upload function outside `withDataWrite()` throws; the whole server test
    suite runs with that check on, so any route or job that writes without declaring it fails; `GET` routes,
    including `GET /api/altcha/challenge` on a fresh database, write nothing to the main database;
  - concurrency (BAK-8, BAK-9): a write started during a backup waits and then succeeds, and the backup holds either
    none or all of that write (database row and upload); a write **already in progress** when the backup starts
    (held open by a test hook) finishes before the snapshot and is all in the backup; a write still running after
    the 30-second drain makes the backup return `409 conflict` and change nothing (use an injectable clock or a
    shorter test limit); a second backup or restore gets `409 conflict`; during a restore every `/api/` route except
    health returns `503 maintenance` with `Retry-After`, and health returns `{ "status": "maintenance" }`;
  - Postgres apps, two processes (BAK-12): run a second app instance against the same database and data directory
    (a second `buildApp()` with its own pool and control connection, or a second process):
    - a backup started on one makes writes on the other wait and includes a write the other had in progress (held
      open by a test hook); a write held open past 30 seconds makes the backup return `409 conflict`;
    - a follower paused (test hook) for longer than its poll interval with a write in progress cannot write into a
      snapshot: the backup waits for it or gives up with `409`;
    - a backup or restore on one gets `409 conflict` while the other runs one;
    - a restore started on one waits for, or gives up with `409` and nothing changed on, each of these in the other
      (activity lock): a deliberately held read, a job that does not write, an upload download held open, and a new
      request arriving before the other process has polled the new state; during a backup, reads in the other
      process keep working;
    - closing a follower's control connection aborts its requests in progress with `503` and it serves `/api/`
      again only after taking a new lease;
    - admission: with one long request holding process B's lease, commit `restore` from process A and send B a
      second request before B polls: its handler never starts and it gets `503`; the first request finishes or the
      restore gives up with `409` after 30 seconds;
    - recovery admission: enter `restore_failed` with no lease held anywhere, then with the recovery session call
      `GET /api/admin/session`, preview and restore successfully, each through the activity lease; another session
      gets `503` throughout; afterwards no advisory lock is held (`pg_locks`);
    - backup start: a test hook pauses the owner between setting `backup` and taking the write lock; a write issued
      in that gap waits and succeeds after the backup, which contains all of it or none;
    - during a restore on one, the other returns `503 maintenance` and health `maintenance`, and afterwards serves
      the restored data with a new pool and no sessions;
    - a process started while a backup or restore runs serves no writes until it finishes, and runs no app
      migration until it finishes;
    - two processes started at the same moment on an empty database both start, and `CONTROL_MIGRATIONS`,
      `LOG_MIGRATIONS` and the app migrations each ran once; a control schema newer than the app stops startup;
    - closing the owner's control connection mid-backup or mid-restore stops the owner's own work (no file written
      after the close, the child process killed), returns the other process to `idle` (backup) or puts it in
      `restore_failed` with the marker file written (restore), and no write runs in between;
    - the same advisory key held in another database of the same server is ignored;
  - recovery restore (BAK-11): force a rollback failure, then with the recovery session preview and restore a known
    good archive: the app returns to `idle`, and the marker file and (Postgres) the recovery state are cleared only
    after success; a recovery restore that fails leaves `restore_failed`, the marker and the recovery session as
    they were; another session cannot start one; a normal backup or restore during `restore_failed` gets `409`;
    Postgres: after a `409` because the state was not `idle`, the operation lock is free again, and a recovery
    restore started from a different process than the one that failed works;
  - recovery (BAK-11): after a failed rollback the restoring admin's session works for `GET /api/admin/session`
    (returning their username) and `POST /api/admin/restore` only, and stops working at its expiry; any other session
    gets `503`; Postgres apps: when the owner dies mid-restore, the other process accepts the recovery session it
    stored at the start; startup refuses with the marker file and the state, with only the marker file, and with
    only `restore_failed` in the state;
  - failure (BAK-10, BAK-11): a failure injected after the swap, and one injected into the step 6.1 transaction,
    each roll back and leave the data, the settings and the sessions as they were; a failure injected into deleting
    the set-aside paths still returns `200`, lists the paths as warnings and releases the lock; a failure injected into the rollback leaves the app in maintenance with `restore-failed.json`
    written, and a restart then refuses to start;
  - Postgres apps: a backup's dump has entries only in `public`, and a restore, including one from a dump that does
    contain the `logs` schema, leaves the log rows and `log_meta` unchanged (BAK-2, BAK-4, LOG-17);
  - Postgres preview (BAK-3): dumps that contain a function, a trigger, a view, an extension, an event trigger, an
    unexpected schema, an unknown table or an ACL entry are each rejected with `422` before anything is restored; a
    dump with a newer schema version, a missing table or a bad admin hash is rejected after the preview restore; the
    preview database is empty after every preview, including a failed or timed-out one; a second preview at the same
    time gets `409`; the live data is unchanged by any preview; a process started while a preview is paused (test
    hook) leaves the preview database alone, the preview completes, and the database is empty afterwards;
  - Postgres rollback (BAK-10): with an incoming archive whose dump IDs and schema version differ from the live
    database, a failure injected after the live restore rolls back to exactly the original rows and uploads, using
    the rollback list written in BAK-4 step 3; the list is deleted with its pre-restore backup;
  - Postgres role (DATA-11): the app refuses to start when connected as a superuser;
  - migrations from an empty database and from each released schema version;
  - translation completeness for public and admin strings, including a string in every locale for every standard
    and app-specific `error` code and field `code` (I18N-6);
  - error bodies: every `400 validation_failed` response has a `code` on each field error, and `rate_limited`,
    `maintenance`, `file_too_large`, `field_too_large` and `defined_in_config` carry their `params` (API-6);
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

### 19.1 Acceptance tests

`npm run check` tests the server and shared logic. The rules below cover what it cannot: the UI in a real browser,
accessibility, the two installation methods, and upgrades. Each MUST pass before every release; the release PR
records the results (VER-12).

- **TEST-6** **Browser tests.** Apps MUST have a Playwright suite in `tests/e2e/*.spec.ts`, run by
  `npm run test:e2e` in CI and before every release. Playwright's `webServer` starts the built server
  (`node dist-server/index.mjs`) with a temporary data directory, a test `config.yaml` and a setup password, so
  each run starts from first run. Chromium is enough.
  - **Browser install.** `npm ci` installs `@playwright/test` but no browser. CI MUST install Chromium and its
    system libraries before `npm run test:e2e`, with the Playwright version from `package-lock.json`: either run
    `npx playwright install --with-deps chromium` (it uses the project's Playwright; `--with-deps` installs the
    Linux libraries with `apt` and needs root or `sudo`), or run the job in the official image
    `mcr.microsoft.com/playwright:v<version>-noble` whose `<version>` equals the locked `@playwright/test` version.
    The README's Development section gives the same `npx playwright install --with-deps chromium` command for local
    runs.
  - **One worker.** The suite shares one server and one data directory, and its tests change that state (first-run
    setup, created content). `playwright.config.ts` MUST set `workers: 1` and `fullyParallel: false`, unless the app
    gives every worker its own server, port and data directory. The first-run setup runs once, as a Playwright setup
    project that the other projects list in `dependencies`, and saves the signed-in state with `storageState`; no
    other test relies on the order of files.
  - **Config.** `playwright.config.ts` sets `webServer` to `{ command: 'node dist-server/index.mjs', url:
    'http://127.0.0.1:<port>/api/health', reuseExistingServer: false }` with the test environment, uses
    `forbidOnly: !!process.env.CI`, and keeps traces off by default (`trace: 'retain-on-failure'` at most).

  The suite covers at least:
  - both entries (`/` and `/admin`) load with no console errors and no CSP violations (listen for `console` and
    `securitypolicyviolation`);
  - first-run setup and admin sign-in through the UI (AUTH-5);
  - every dialog: it opens from the keyboard, Tab stays inside it, Escape closes it, and focus returns to the opener
    (A11Y-2);
  - accessible names: every button and input is found by role and name (`getByRole(…, { name })`), and an automated
    check such as `@axe-core/playwright` with the WCAG 2.2 AA rules reports no violations on each page (A11Y-1,
    A11Y-3, A11Y-5);
  - no horizontal page scroll (`scrollWidth <= innerWidth`) at 300, 520, 640, 760 and 1180 px wide, and at 300 px
    with the 2× font scale (UI-12, A11Y-6);
  - status messages appear in a `role="status"` or `aria-live` region (A11Y-4).
- **TEST-7** **Manual accessibility check.** Before every release, a person MUST check what automated tests
  miss, and tick this list in the release PR:
  - every public and admin flow works with the keyboard alone, with a visible focus indicator;
  - a screen reader (NVDA with Firefox, or VoiceOver with Safari) announces the main flows, dialogs and status
    messages sensibly;
  - any colour pair added since the last release meets the A11Y-1 contrast ratios;
  - the UI works at 200 % browser zoom and at the 2× font scale, and with `prefers-reduced-motion` on (UI-11);
  - every locale renders, including Thai, Chinese, Hindi and Japanese in the fallback fonts (UI-3).
- **TEST-8** **Installation smoke tests.** Before every release, both installation methods MUST be run from a
  clean checkout of the release commit, following the README exactly:
  - **Docker Compose** (DEP-1, DEP-2): create `config.yaml` and `.env` with a setup password,
    `docker compose up -d --build`, wait until `docker compose ps` reports the service `healthy`, then check that
    `curl -fsS http://127.0.0.1:<port>/api/health` succeeds, that `/api/setup/status` reports
    `{ adminExists: false, setupPasswordConfigured: true }`, and that the port is published on `127.0.0.1` only
    (SEC-4). Finish with `docker compose down -v`.
  - **Local installation** (DEP-6 to DEP-8): on Ubuntu 24.04 or Debian 12/13 (a VM, or a container that runs
    systemd), follow the README's steps; `systemctl is-active agt-<app>` reports `active`, the same `curl`
    checks pass, and `journalctl -u agt-<app>` shows no errors.
  - **Behind a proxy** (AUTH-8, DEP-10): a server test (part of TEST-4) MUST check that with `server.trustProxy` set, a request
    from the proxy address with `X-Forwarded-Proto: https` gets a session cookie with `Secure`, and that without
    `trustProxy` the header is ignored.
- **TEST-9** **Upgrade and rollback test.** Before every release except an app's first, the upgrade from the
  previous release tag MUST be tested with at least the Docker method, following the README (VER-13): install the previous tag,
  complete setup, create sample data (at least one of each resource and one upload) and download a backup; upgrade
  to the release commit as *Upgrading* says (and as the upgrade notes say, for a major version); check that the data
  is intact, the migrations ran (server log) and the dashboard shows the new version (VER-2); then roll back as
  *Rolling back* says and check that the previous version runs with the restored data.

Backups under concurrent writes and failures during a restore are covered by server tests (TEST-4, BAK-8 to BAK-11).

## 20. Documentation

### 20.1 README.md (for operators)

- **DOC-1** `README.md` MUST start with the title, the AI disclosure line, verbatim
  (`> **AI Disclosure:** This software was created using generative AI.`), with nothing added that claims human review
  or any other verification,
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
  11. **Troubleshooting** (refuses to start, setup password missing, locked out, rate limits, proxy/HTTPS,
      "maintenance in progress", recovering from a failed restore by hand with the pre-restore backup, then
      clearing the `restore-failed.json` marker and (Postgres) the `restore_failed` state (BAK-11), and deleting `*.restore-old-*` paths a restore could not remove
      (BAK-4); pointing to the Server log tab first)
  12. **Credits** (every bundled font with its authors, licence and source, UI-15)

### 20.2 AGENTS.md (for agents)

- **DOC-2** `AGENTS.md` is the agent entry point; `CLAUDE.md` contains only `@AGENTS.md`. It MUST contain, in
  order: a two-paragraph overview (stack, database engine and why, deployment), a link to the pinned spec copy
  `docs/agt-webapp-spec.md` with the spec version and source tag it follows (SPEC-2), **Branches**, **Commands** (including how to run a single test file),
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
  version's CHANGELOG heading from `Unreleased` to the release date; its description SHOULD carry the dependency
  review (STACK-6) and MUST carry the results of the acceptance tests (TEST-6 to TEST-9): a passing CI run of
  `npm run test:e2e` on the release commit, the ticked TEST-7 list, and what TEST-8 and TEST-9 checked. A release
  MUST NOT be tagged while any of them fails; fix it in a new PR first. Agents create the tag and the GitHub Release
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
  need, stop and propose a spec change (a PR to the spec repository, SPEC-4).
- **WF-5** Before you finish: `npm run check` passes; new strings are translated into all locales; new
  routes have full schemas and appear in `/api/openapi.json`; new config keys are in the schema,
  `config.example.yaml` and the README tables; new tables have a migration; the version is bumped as §21 requires
  and `CHANGELOG.md` has the entries (VER-8, VER-9); the compliance checklist below still holds.

## 23. Compliance checklist

Use this list to review a new app or a large change. Every item must be true or listed as a deviation.

- [ ] Slug registered; names follow NAME-2; unique default port.
- [ ] Stack and layout match §3–§4; lockfile committed; `npm run check` passes.
- [ ] `npm run test:e2e` passes in CI; every release PR records the TEST-6 to TEST-9 results (§19.1, VER-12).
- [ ] Engine chosen per DATA-1/2 and documented; numbered migrations; UUIDv4 IDs; UTC times.
- [ ] Every `/api/` route has full TypeBox schemas, `operationId`, tags, security; `/api/openapi.json` is
      complete (API-13 test); error bodies follow API-6.
- [ ] `config.yaml` validated, read-only, documented; `.env` holds only secrets; env vars limited to CFG-2.
- [ ] Settings tab with config-file-wins precedence enforced on the server (CFG-6..9).
- [ ] Single admin; first-run setup with `AGT_<APP>_SETUP_PASSWORD`; operator told to remove it (AUTH-6).
- [ ] Sessions, CSRF header, no CORS, rate limits, CSP and headers (SEC-1..7).
- [ ] Uploads checked by magic bytes, no SVG; ZIPs read safely; Markdown rendered safely; no outbound requests.
- [ ] ALTCHA + rate limit + moderation on every anonymous write (§11), or no anonymous writes.
- [ ] Backup & restore with the BAK-2 manifest, preview re-run on restore, operation lock with draining (shared through `control.operation` for Postgres) and `503 maintenance`, consistent snapshot, pre-restore backup, atomic swap with health check and rollback, never writes `config.yaml` (§12).
- [ ] Server log and audit log in a separate log store, shown in the admin dashboard with filters, export and the
      error badge; audit via one hook, coalesced, IP-pseudonymized, append-only; retention settings; not in
      backups (§13).
- [ ] Two Vite entries; `apiRequest()`; no client caching of server data.
- [ ] Design tokens verbatim; AGT fonts and logo bundled, with their licence files and a README Credits section (UI-15); portal codes shown in NMS Glyphs Mono with hex
      text (UI-14); reference component classes; responsive to 300 px.
- [ ] WCAG 2.2 AA: dialogs via `useDialog`, labelled icon buttons, live regions, font scale.
- [ ] All 10 locales complete for public and admin strings; no hard-coded UI text.
- [ ] Docker Compose and systemd installs documented and working; healthcheck; non-root; hardened.
- [ ] README sections per DOC-1; AGENTS.md per DOC-2 with deviations.
- [ ] `docs/agt-webapp-spec.md` is an unmodified copy of a tagged spec release, and `AGENTS.md` names its version
      and tag (SPEC-2).
- [ ] SemVer version in `package.json`, bumped in each PR (§21); `CHANGELOG.md` with upgrade notes for majors;
      deprecations before removals; releases tagged `vX.Y.Z` with GitHub Releases; installs check out tags.
