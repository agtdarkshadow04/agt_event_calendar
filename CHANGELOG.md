# Changelog

All notable changes to AGT Event Calendar are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html), as described in §21 of the
[AGT Web Application Specification](docs/agt-webapp-spec.md).

## [3.0.0] - Unreleased

### Upgrade notes

- **Local installations need Node.js 26 and npm 11.20 or newer (npm 11).** Before checking out this release, install
  Node.js 26 from NodeSource (`curl -fsSL https://deb.nodesource.com/setup_26.x -o /tmp/nodesource_setup.sh`, then
  `sudo -E bash /tmp/nodesource_setup.sh && sudo apt-get install -y nodejs`), and check with `node -v` and `npm -v`.
  `npm ci` now stops with an engine error on older versions. Docker Compose installations need no action: the image
  is now built from `node:26-bookworm-slim`
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- **The app is now reachable only from the host it runs on.** It serves plain HTTP, so a local installation now
  listens on `127.0.0.1` by default (`server.host`), and `docker-compose.yml` publishes `127.0.0.1:8080:8080` instead
  of `8080:8080`. If visitors reach the calendar directly on port 8080 from other machines, put a TLS-terminating
  reverse proxy on the same host (README: *TLS and reverse proxies*, `deploy/Caddyfile.example`) and set
  `server.trustProxy`. Docker installations with their own `docker-compose.yml` should change the published port the
  same way. Only if the proxy runs on another machine, set `server.host` (local) or the published address (Docker) to
  an interface it can reach, and firewall that port to the proxy
  ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).
- **API clients: error bodies changed.** Every field error (and every `notices` entry) now has a `code` and, where
  needed, `params`, besides `field` and `message`. A request body that fails its schema now gets `400
  validation_failed` with `fields` (was `400 invalid_request` without them). An image over the size limit gets `413
  file_too_large` with `params.maxBytes` (was `413 image_rejected`). `rate_limited`, `file_too_large`,
  `field_too_large` and `defined_in_config` carry `params`. Clients that show `message` keep working
  ([#63](https://github.com/agtdarkshadow04/agt_event_calendar/issues/63)).
- **`altcha.hmacKey` is ignored.** The captcha key is now always generated and stored in the database. If
  `config.yaml` sets it, remove the line: the server log warns at every startup until you do, and 4.0.0 will
  reject it as an unknown key. Captcha challenges issued before the upgrade fail once, and visitors verify again
  ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).
- **Backups and restores are stricter.** Backups made by AGT Event Calendar 2.x restore unchanged. An archive whose
  `manifest.json` has extra or missing fields, lists a file that is missing or misses one that is present, uses an
  unsafe path, or has a newer `formatVersion` is now rejected with `422 archive_rejected`, and so is a backup whose
  admin password hash is malformed. A backup or restore now waits up to 30 seconds for changes in progress and answers
  `409 conflict` if the server is still busy; during a restore the app answers `503` "Maintenance in progress". If a
  restore and its rollback both fail, the server refuses to start until `restore-failed.json` is removed (README:
  *A restore failed and the app stays in maintenance*) ([#61](https://github.com/agtdarkshadow04/agt_event_calendar/issues/61),
  [#62](https://github.com/agtdarkshadow04/agt_event_calendar/issues/62)).
- **API clients: `POST /api/admin/logout` needs a valid session**, like every admin route except login (AUTH-9);
  without one it now answers `401 unauthorized` instead of `200`
  ([#66](https://github.com/agtdarkshadow04/agt_event_calendar/issues/66)).

### Added

- A GitHub Actions workflow runs `npm ci`, checks that every dependency install script is approved or denied, and runs
  `npm run check` on every pull request and push to `main`
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- A `security` server-log warning, once per process, when a login or setup request arrives over plain HTTP from
  another host ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).
- The `AGT_SERVER_HOST` environment variable sets the listen address when `server.host` is not in `config.yaml`;
  the Docker image sets `0.0.0.0` ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).
- An operation lock for backups and restores. A backup waits for the changes in progress and holds new ones until
  its snapshot of the database and uploads is done; a restore waits for every request in progress. Either gives
  `409 conflict` if one is already running, or if the server is still busy after 30 seconds
  ([#61](https://github.com/agtdarkshadow04/agt_event_calendar/issues/61)).
- `503 maintenance` with `Retry-After: 10` and `params.retryAfterSeconds`: for every API request during a restore, and
  for a change that waited more than 30 seconds for a backup. `GET /api/health` returns `{ "status": "maintenance" }`
  during a restore. The calendar and the dashboard show a non-blocking "Maintenance in progress" notice and retry the
  request once ([#61](https://github.com/agtdarkshadow04/agt_event_calendar/issues/61)).
- Errors are shown in the user's language everywhere: the calendar and the dashboard translate every error code and
  field code (all 10 languages) instead of showing the server's English message, which remains the fallback for a code
  they don't know ([#63](https://github.com/agtdarkshadow04/agt_event_calendar/issues/63)).
- A failed restore rolls back: the previous database and uploads, set aside as `<name>.restore-old-<timestamp>`, are put
  back, and the request gets `500` "The restore failed and was rolled back. Nothing was changed." If the rollback
  fails too, the app stays in maintenance, writes `restore-failed.json` in the data directory and refuses to start
  until it is removed. Until then, the admin who started the restore can recover from the same session with a new
  restore. The README's Troubleshooting section explains both, and the manual recovery
  ([#62](https://github.com/agtdarkshadow04/agt_event_calendar/issues/62)).
- The NMS Futura licence (`public/fonts/NMSFuturaProBook-OFL.txt`) is shipped with the font, and the README credits
  every bundled font ([#64](https://github.com/agtdarkshadow04/agt_event_calendar/issues/64)).
- Playwright browser tests (`npm run test:e2e`, `tests/e2e/`), run in CI: first-run setup and sign-in, every dialog with
  the keyboard, axe WCAG 2.2 AA checks, no horizontal scroll at 300 to 1180 px and at the 2× font scale, live
  regions, and no console errors or CSP violations. A release PR template lists the manual acceptance checks
  ([#65](https://github.com/agtdarkshadow04/agt_event_calendar/issues/65)).
- `package.json` approves the install scripts of `better-sqlite3` and `esbuild` in `allowScripts`, so `npm ci` behaves
  the same with npm 11.20 and newer ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).

### Changed

- Node.js 26 LTS and npm 11.20+ are required (`engines` `node >=26.0.0 <27`, `npm >=11.20.0 <12`, enforced by
  `engine-strict=true` in `.npmrc`); the Docker image and the server bundle target Node.js 26
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- Build tools: TypeScript 7.0, Vite 8.3, `@vitejs/plugin-react` 6.3 and esbuild 0.28
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- Restore checks the backup manifest exactly: the six fields and their types, a format version from 1 up to this
  app's, safe relative paths, no duplicates, and every archive entry listed. The preview, and the restore itself,
  also reject a backup whose admin password hash fails the password-hash check
  ([#61](https://github.com/agtdarkshadow04/agt_event_calendar/issues/61)).
- A restore now follows the spec's steps: after the swap it migrates and checks the restored data (integrity,
  references, schema version, tables and referenced images) and then commits, removing locked settings and sessions
  in one transaction. Set-aside paths that cannot be deleted no longer fail the restore; they are listed as
  `warnings` in its result and in the server log ([#62](https://github.com/agtdarkshadow04/agt_event_calendar/issues/62)).
- Accessibility fixes found by the browser tests: the calendar grid has rows, day cells and event buttons are named by
  their visible text (plus the full date for screen readers), the settings import field has a name and no tab stop of
  its own, every dialog uses the shared dialog behaviour, and the header and month picker no longer overflow at 300 px
  with the 2× font scale ([#65](https://github.com/agtdarkshadow04/agt_event_calendar/issues/65)).
- The app follows the AGT Web Application Specification 6.0.0 (`docs/agt-webapp-spec.md`, pinned to tag `v6.0.0`);
  the README's disclosure line, section order and spec references follow it
  ([#66](https://github.com/agtdarkshadow04/agt_event_calendar/issues/66)).
- The OpenAPI document gives logout the session-and-CSRF `security` of every other admin write, and path parameters
  reject unknown properties ([#66](https://github.com/agtdarkshadow04/agt_event_calendar/issues/66)).
- The calendar and dashboard use the AGT base stylesheet (`src/agt-base.css`, copied unmodified from the spec), which
  also brings the darker primary-button colour `--agt-red-orange: #cb4c2b` for contrast
  ([#64](https://github.com/agtdarkshadow04/agt_event_calendar/issues/64)).
- The captcha key is generated at startup, and after a restore whose data has none, instead of by the first captcha
  request ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).
- While no admin exists, an `AGT_SETUP_PASSWORD` longer than 1024 characters stops the server with a clear message
  ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).

### Deprecated

- `altcha.hmacKey` in `config.yaml`: accepted but ignored, with a startup warning. There is no replacement: the key is
  generated. It will be removed in 4.0.0, when a leftover key stops the server as an unknown key
  ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).

### Removed

- The unused NMS Alphabet font (`public/nms-alphabet.ttf`): its licence does not allow hosting it as a web font
  ([#64](https://github.com/agtdarkshadow04/agt_event_calendar/issues/64)).

### Security

- Stored password hashes are checked before scrypt runs: anything but six fields with the `32768/8/1` profile, a
  16-byte salt and a 64-byte key is rejected like a wrong password, with a server-log error. scrypt always runs with
  fixed parameters, so a crafted hash in the database or a backup can no longer make a login use unbounded CPU or
  memory ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60),
  [#38](https://github.com/agtdarkshadow04/agt_event_calendar/issues/38)).
- The default listen address is `127.0.0.1`, and Compose publishes the port on `127.0.0.1` only (see Upgrade notes)
  ([#60](https://github.com/agtdarkshadow04/agt_event_calendar/issues/60)).

## [2.2.0] - 2026-11-10

### Added

- The admin dashboard header shows the app version, and `GET /api/admin/session` returns it as `version`
  ([#55](https://github.com/agtdarkshadow04/agt_event_calendar/issues/55)).
- This changelog, with the history back to 1.0.0
  ([#55](https://github.com/agtdarkshadow04/agt_event_calendar/issues/55)).

### Changed

- The README installs and upgrades from release tags instead of `main`, and documents rolling back
  ([#55](https://github.com/agtdarkshadow04/agt_event_calendar/issues/55)).

## [2.1.0] - 2026-11-09

### Added

- A server log and an audit log, stored in their own database file (`logs.sqlite` in the data directory,
  `storage.logDatabaseFile`). Both are shown in new admin dashboard tabs with filters, paging, entry details and
  JSON Lines / CSV export, and the dashboard header flags unseen warnings and errors
  ([#52](https://github.com/agtdarkshadow04/agt_event_calendar/pull/52)).
- Every state-changing admin and public request, every download or export, and every denied or rate-limited request
  is recorded in the audit log, with hashed client IP addresses
  ([#52](https://github.com/agtdarkshadow04/agt_event_calendar/pull/52)).
- New `logs.*` config keys set the retention of both logs; old entries are removed hourly
  ([#52](https://github.com/agtdarkshadow04/agt_event_calendar/pull/52)).

### Changed

- Backup downloads from the dashboard show errors in the Backup tab instead of opening an error page
  ([#52](https://github.com/agtdarkshadow04/agt_event_calendar/pull/52)).

## [2.0.0] - 2026-11-09

### Upgrade notes

- Download a backup before upgrading (*Backup & restore* in the README). Database migration `0002` runs
  automatically at the first start and adds created/updated timestamps to existing images, settings and secrets.
- API clients of the admin API must be updated; the web dashboard shipped with this version already is:
  - creating an event, holiday or change log entry returns `201` with the full record and `notices`
    (`{ event, notices }`, `{ holiday, notices }`, `{ changeLogEntry, notices }`) instead of `{ id }`;
  - replacing a record returns `200` with the full record and `notices` instead of `{ ok: true }`;
  - deleting an event, image, holiday or change log entry returns `204` with no body instead of `{ ok: true }`.

### Added

- An OpenAPI 3.1 document of the whole API at `/api/openapi.json`, generated from the route schemas
  ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).
- Portal codes are shown as portal glyphs next to the hex text in event details and the event form
  ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).
- Local installation on Ubuntu/Debian as a hardened systemd service (`deploy/agt-event-calendar.service`), and a
  Caddy reverse proxy example ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).

### Changed

- Admin create, replace and delete responses follow the API conventions described in the upgrade notes
  ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).
- Every API route declares its request and response schemas, which the OpenAPI document publishes
  ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).
- Backups are named `agt-event-calendar-backup-<timestamp>.zip`
  ([#49](https://github.com/agtdarkshadow04/agt_event_calendar/pull/49)).

## [1.0.0] - 2026-11-06

### Added

- Self-hosted calendar: a Fastify server with a SQLite database serves the React calendar and an admin dashboard,
  with Docker Compose deployment and no cloud services, CDNs or outbound requests
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- `config.yaml` configuration, where the config file always wins over dashboard settings
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- First-run setup of the single admin account with a temporary `AGT_SETUP_PASSWORD`
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- Admin dashboard: events, moderation, national holidays, change log, images, settings, Migrate from Amplify, and
  backup & restore ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- In-app event submissions protected by a bundled ALTCHA captcha, with a moderation queue
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- Uploaded images checked by their content (PNG, JPEG, WebP, GIF; no SVG)
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).
- UUID event IDs; old links with legacy event IDs keep working
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).

### Removed

- The Google Sheets data source, the Google Form and the AWS Amplify hosting files
  ([#46](https://github.com/agtdarkshadow04/agt_event_calendar/pull/46)).

