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

### Added

- A GitHub Actions workflow runs `npm ci`, checks that every dependency install script is approved or denied, and runs
  `npm run check` on every pull request and push to `main`
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- `package.json` approves the install scripts of `better-sqlite3` and `esbuild` in `allowScripts`, so `npm ci` behaves
  the same with npm 11.20 and newer ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).

### Changed

- Node.js 26 LTS and npm 11.20+ are required (`engines` `node >=26.0.0 <27`, `npm >=11.20.0 <12`, enforced by
  `engine-strict=true` in `.npmrc`); the Docker image and the server bundle target Node.js 26
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).
- Build tools: TypeScript 7.0, Vite 8.3, `@vitejs/plugin-react` 6.3 and esbuild 0.28
  ([#59](https://github.com/agtdarkshadow04/agt_event_calendar/issues/59)).

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

