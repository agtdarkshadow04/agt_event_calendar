# AGT Event Calendar

> **AI Disclosure:** This software was created using generative AI. Its functionality has been verified by human review.

AGT Event Calendar is a self-hosted calendar for events hosted by the Alliance of Galactic Travellers and related No Man's Sky communities. It runs completely locally, with **Docker Compose** or as a **systemd service** on Ubuntu/Debian: a Fastify server with a SQLite database serves the React calendar, an in-app event submission form with a moderation queue, and an admin dashboard.

- No cloud services, no third-party CDNs, and no outbound requests from the server.
- The visitor's browser loads only files served by the app. The one exception is external images that authors reference in event descriptions (see [Content safety](#content-safety)).
- All data (events, national holidays, change log, uploaded images) lives in one data directory: a Docker volume, or `/var/lib/agt-event-calendar` for a local installation.

## Contents

- [Installation](#installation)
- [First run](#first-run)
- [Configuration reference](#configuration-reference)
- [Admin dashboard](#admin-dashboard)
- [Logs](#logs)
- [Migrating from Amplify](#migrating-from-amplify)
- [Backup & restore](#backup--restore)
- [Content safety](#content-safety)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

## Installation

Choose one method: [Docker Compose](#docker-compose) (recommended) or a [local installation](#local-installation-ubuntudebian) on Ubuntu 24.04 LTS or Debian 12/13.

### Docker Compose

Requirements: Docker with the Compose plugin.

Installations run released versions. Replace `vX.Y.Z` below with the latest release from the [releases page](https://github.com/agtdarkshadow04/agt_event_calendar/releases); never run `main` in production.

```bash
git clone https://github.com/agtdarkshadow04/agt_event_calendar.git
cd agt_event_calendar
git checkout vX.Y.Z
cp config.example.yaml config.yaml
cp .env.example .env
```

Edit `.env` and set a temporary `AGT_SETUP_PASSWORD` (see [First run](#first-run)). Edit `config.yaml` if you need anything other than the defaults; every key is optional.

```bash
docker compose up -d --build
```

The calendar is served over plain HTTP on port 8080: `http://localhost:8080/`. The admin dashboard is at `http://localhost:8080/admin`.

What `docker-compose.yml` sets up:

| Item | Details |
| --- | --- |
| Volume `calendar-data` → `/app/data` | SQLite database, uploaded images and automatic pre-restore backups. Survives restarts and image upgrades. |
| `./config.yaml` → `/app/config.yaml` | Mounted **read-only**. |
| `env_file: .env` | Secrets and bootstrap values only (`AGT_SETUP_PASSWORD`). |
| Port `8080` | One HTTP port. |
| Healthcheck | `GET /api/health`. |
| User | The container runs as the non-root `node` user with a read-only root filesystem. |

### Local installation (Ubuntu/Debian)

The app runs as a hardened systemd service under its own system user. Paths:

| Path | Contents |
| --- | --- |
| `/opt/agt-event-calendar` | The code and the built app |
| `/etc/agt-event-calendar/config.yaml` | Configuration |
| `/etc/agt-event-calendar/.env` | Secrets and bootstrap values (`AGT_SETUP_PASSWORD`), readable only by root |
| `/var/lib/agt-event-calendar` | Database, uploaded images and automatic pre-restore backups (created by systemd) |

1. Install Node.js 24 from NodeSource, plus Git and the build tools for the SQLite driver:

   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh
   sudo -E bash /tmp/nodesource_setup.sh
   sudo apt-get install -y nodejs git build-essential python3
   ```

2. Create the system user, then download the latest release and build it. Replace `vX.Y.Z` with the latest release from the [releases page](https://github.com/agtdarkshadow04/agt_event_calendar/releases):

   ```bash
   sudo useradd --system --home-dir /var/lib/agt-event-calendar --shell /usr/sbin/nologin agt-event-calendar
   sudo git clone https://github.com/agtdarkshadow04/agt_event_calendar.git /opt/agt-event-calendar
   sudo git -C /opt/agt-event-calendar checkout vX.Y.Z
   cd /opt/agt-event-calendar
   sudo npm ci
   sudo npm run build
   sudo npm prune --omit=dev
   ```

3. Create the configuration:

   ```bash
   sudo mkdir -p /etc/agt-event-calendar
   sudo cp config.example.yaml /etc/agt-event-calendar/config.yaml
   sudo cp .env.example /etc/agt-event-calendar/.env
   sudo chmod 600 /etc/agt-event-calendar/.env
   ```

   Edit `/etc/agt-event-calendar/config.yaml` and set the data directory (the service can only write there):

   ```yaml
   storage:
     dataDir: /var/lib/agt-event-calendar
   ```

   Edit `/etc/agt-event-calendar/.env` and set a temporary `AGT_SETUP_PASSWORD` (see [First run](#first-run)).

4. Install and start the service:

   ```bash
   sudo cp deploy/agt-event-calendar.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now agt-event-calendar
   ```

The calendar is served over plain HTTP on port 8080: `http://localhost:8080/`, and the admin dashboard at `http://localhost:8080/admin`. Logs: `journalctl -u agt-event-calendar`.

### TLS and reverse proxies

The app serves **plain HTTP only**; TLS is up to you. Put it behind your own TLS-terminating reverse proxy (Caddy, nginx, Traefik, …) and set `server.trustProxy` in `config.yaml` (to `true`, or to your proxy's address) so client IPs and HTTPS are detected. With `session.secureCookie: auto` (the default), the admin session cookie is then marked `Secure` automatically for HTTPS requests.

[`deploy/Caddyfile.example`](deploy/Caddyfile.example) is a complete Caddy configuration, including automatic certificates. When the proxy runs on the same host as a local installation, also set `server.host: 127.0.0.1` so the app is reachable only through the proxy. With Docker, publish the port on the loopback interface instead (`"127.0.0.1:8080:8080"` in `docker-compose.yml`).

### Upgrading

Every release is a `vX.Y.Z` tag; [`CHANGELOG.md`](CHANGELOG.md) lists what changed. A new major version (the first number) may need action from you; minor and patch versions never do.

1. Read the **Upgrade notes** in [`CHANGELOG.md`](CHANGELOG.md) for every version between yours and the new one. The dashboard header shows the version you run.
2. Download a backup (see [Backup & restore](#backup--restore)) and keep it until the new version works. You need it to roll back.
3. Check out the new release tag and rebuild. Database migrations run automatically at startup.

Docker Compose:

```bash
git fetch --tags
git checkout vX.Y.Z
docker compose up -d --build
```

Local installation:

```bash
cd /opt/agt-event-calendar
sudo git fetch --tags
sudo git checkout vX.Y.Z
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo systemctl restart agt-event-calendar
```

### Rolling back

Downgrading in place is not supported: when the newer version has migrated the database, the previous version refuses to start (`Database schema version N is newer than this application supports`). To go back, run the previous release on a fresh database and restore the backup you took before the upgrade:

1. Stop the app, check out the previous release tag and move the database aside. The files are kept in `rollback/` in the data directory, so nothing is deleted.

   Docker Compose:

   ```bash
   docker compose down
   git checkout vX.Y.Z
   docker compose run --rm --no-deps --entrypoint sh calendar -c 'mkdir -p /app/data/rollback && mv /app/data/agt-calendar.sqlite* /app/data/rollback/'
   ```

   Local installation:

   ```bash
   sudo systemctl stop agt-event-calendar
   cd /opt/agt-event-calendar
   sudo git checkout vX.Y.Z
   sudo -u agt-event-calendar sh -c 'mkdir -p /var/lib/agt-event-calendar/rollback && mv /var/lib/agt-event-calendar/agt-calendar.sqlite* /var/lib/agt-event-calendar/rollback/'
   ```

   If the error names the log store (`Log store schema version …`), move `logs.sqlite*` aside the same way.

2. Set `AGT_SETUP_PASSWORD` in `.env` again and rebuild and start the previous version: `docker compose up -d --build`, or `sudo npm ci && sudo npm run build && sudo npm prune --omit=dev && sudo systemctl start agt-event-calendar`.
3. Create a temporary admin account at `/admin` (see [First run](#first-run)), then restore the backup under **Backup & restore → Restore** (see [Restore](#restore)). The restore brings back your events, images, settings and admin account.
4. Remove `AGT_SETUP_PASSWORD` from `.env` again and restart.

## First run

1. Set a temporary setup password in `.env` (`/etc/agt-event-calendar/.env` for a local installation):

   ```dotenv
   AGT_SETUP_PASSWORD=some-long-random-value
   ```

2. Start the app and open `/admin`. Because no admin account exists yet, the dashboard shows a setup screen.
3. Enter the setup password, then choose the admin **username** and a **new** admin password (at least 12 characters). The setup password does not become the admin password and cannot be reused as it.
4. **Remove `AGT_SETUP_PASSWORD` from `.env` and restart**: `docker compose up -d` with Docker, or `sudo systemctl restart agt-event-calendar` for a local installation.

The setup password is used **only on first run**. Once the admin account exists it is ignored permanently and the setup endpoint is disabled, even if the variable is still set. While it is still set, the server logs a warning at every startup and the dashboard shows a reminder to remove it. If no admin exists and the variable is unset or empty, setup is refused with a message telling you to set it and restart.

There is exactly one admin account. Its password is stored only as a salted one-way scrypt hash; the plaintext is never stored or logged. The admin can change it under **Account**.

## Configuration reference

Configuration comes from two places:

- **`config.yaml`** (mounted read-only with Docker; `/etc/agt-event-calendar/config.yaml` for a local installation) for everything that is not secret. It is validated at startup against a schema: an invalid value or an unknown key stops the server with an error naming the bad key. A missing file means "all defaults".
- **`.env`** for secrets and bootstrap values only: `AGT_SETUP_PASSWORD`. `.env` is git-ignored and never included in backups.

The variable names (`AGT_SETUP_PASSWORD`, `AGT_CONFIG_FILE`) predate the AGT web app naming scheme (`AGT_<APP>_…`) and are kept so that existing installations keep working.

`config.example.yaml` documents every key with its default.

### Precedence: the config file always wins

Settings in the second table can also be changed in the dashboard (**Settings**). When `config.yaml` defines one of them:

- the dashboard shows it as read-only, marked "Set in the configuration file", and
- the API rejects any attempt to change it with `409`, for example: *"`submissions.enabled` is defined in the configuration file and cannot be changed from the dashboard."*

This is enforced on the server. No API path, migration, backup restore or bulk update can override a key defined in the config file.

### Config-file-only keys

| Key | Default | Description |
| --- | --- | --- |
| `server.host` | `0.0.0.0` | Listen address. |
| `server.port` | `8080` | Listen port. |
| `server.trustProxy` | `false` | `true`, or the proxy's IP/CIDR (string or list), when behind a reverse proxy. |
| `server.logLevel` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. |
| `storage.dataDir` | `data` | Data directory, relative to the working directory (`/app` in Docker). |
| `storage.databaseFile` | `agt-calendar.sqlite` | SQLite file, relative to `dataDir`. |
| `storage.uploadsDir` | `uploads` | Uploaded images, relative to `dataDir`. |
| `storage.backupsDir` | `backups` | Automatic pre-restore backups and temporary files, relative to `dataDir`. |
| `storage.logDatabaseFile` | `logs.sqlite` | Log store (server log and audit log), relative to `dataDir`. Never part of a backup. |
| `session.ttlHours` | `12` | Admin session lifetime. |
| `session.secureCookie` | `auto` | `auto` marks the cookie `Secure` for HTTPS requests; `true`/`false` force it. |
| `rateLimits.login` | `max: 10`, `windowMinutes: 15` | Admin login attempts per client. |
| `rateLimits.setup` | `max: 10`, `windowMinutes: 15` | First-run setup attempts per client. |
| `rateLimits.adminUploads` | `max: 120`, `windowMinutes: 15` | Admin image uploads per client. |
| `altcha.hmacKey` | *(generated)* | HMAC key for the captcha (≥ 32 characters). When unset, a random key is generated once and stored in the database. |
| `altcha.cost` | `5000` | Proof-of-work cost. |
| `altcha.challengeTtlSeconds` | `600` | Challenges expire after this time. |

### Keys that can also be set in the dashboard

| Key | Default | Description |
| --- | --- | --- |
| `site.title` | `AGT Event Calendar` | Browser tab title. |
| `site.supportUrl` | `https://www.nms-agt.com/support` | Bug report / support link in the header. |
| `site.glyphToolUrl` | `https://glyph.nms-agt.com/` | Base URL of the portal glyph tool. |
| `submissions.enabled` | `true` | Accept public event submissions. When `false` the server rejects them (`403`). |
| `submissions.rateLimit.max` | `5` | Submissions per client per window. |
| `submissions.rateLimit.windowMinutes` | `60` | Submission rate-limit window. |
| `uploads.maxImageBytes` | `10485760` | Maximum image size; capped at 10 MB. |
| `migration.maxZipBytes` | `209715200` | Maximum migration/backup ZIP upload (200 MB). |
| `migration.maxUncompressedBytes` | `1073741824` | Maximum total uncompressed ZIP size (zip-bomb protection). |
| `migration.maxEntries` | `10000` | Maximum number of ZIP entries. |
| `logs.serverRetentionDays` | `30` | Days server log entries are kept (1–3650). |
| `logs.serverMaxEntries` | `100000` | Maximum number of server log entries (1000–10000000); the oldest are deleted first. |
| `logs.auditRetentionDays` | `365` | Days audit log entries are kept (30–3650). The minimum of 30 stops anyone from erasing recent history by shortening it. |
| `logs.auditMaxEntries` | `1000000` | Maximum number of audit log entries (10000–10000000); failed, denied and rate-limited entries are deleted before successful ones. |

## Admin dashboard

Open `/admin` and sign in. The dashboard has these tabs:

- **Events**: create, edit, delete, publish and unpublish events. Times are entered in your chosen time zone (calendar settings) and stored in UTC. Pick a cover from uploaded images or upload a new one.
- **Moderation queue**: public submissions (`pending`) with the submitter's AGT username. **Approve** publishes the event, **Reject** marks it `rejected`, **Edit** opens it in the editor.
- **National holidays** and **Change log**: create, edit, delete, publish and unpublish. A change-log entry has a date (`YYYY-MM-DD`) and changes (comma- or line-separated; each item is shown as a bullet).
- **Images**: view, replace and delete uploads, and remove images no event uses.
- **Settings**: the dashboard-editable keys above. Keys defined in `config.yaml` are read-only.
- **Server log**: warnings, errors and other events the server recorded by itself. A badge on the tab (red when there are errors) and a link in the header show new warnings and errors; opening the tab marks them as seen. See [Logs](#logs).
- **Audit log**: what users did, read-only. See [Logs](#logs).
- **Migrate from Amplify**: see below.
- **Backup & restore**: see below.
- **Account**: change the admin password (other sessions are signed out).

### Event submissions

Anyone can submit an event with **Add an Event** (`+` in the header). Submissions are anonymous: the form asks for an **AGT username** (shown only to the admin) and never for an email address. Each submission must pass a self-hosted [ALTCHA](https://altcha.org/) proof-of-work captcha (every solution is accepted once; challenges expire) and is rate limited. Submissions are stored as `pending` and appear on the calendar only after approval. When submissions are turned off, the button explains that submissions are closed and the server rejects submissions.

### Event IDs and old links

Every event gets an RFC 9562 version 4 UUID. Events imported by **Migrate from Amplify** also keep their old 4-hex ID only to resolve old links: `?event_id=0001` opens the migrated event and the address bar is rewritten to its UUID, and bookmarks saved with old IDs are converted to UUIDs once, the next time the calendar loads. Bookmark import accepts both kinds of IDs; share links and bookmark exports always use UUIDs.

## Logs

The app keeps two logs in their own SQLite file, `logs.sqlite` in the data directory (`storage.logDatabaseFile`), next to the main database. Both are shown in the admin dashboard with filters, paging and an entry detail view, and both can be exported as JSON Lines or CSV (**Export**; CSV cells that would start a spreadsheet formula are prefixed with `'`). Times are stored in UTC and shown in your chosen time zone.

| | Server log | Audit log |
| --- | --- | --- |
| Contains | What the server did by itself: startup (version, schema versions, listen address, configuration file or defaults), configuration warnings such as the `AGT_SETUP_PASSWORD` reminders, database migrations, log retention runs, unexpected errors (with the error message and stack) and shutdown | What users did: every change, sign-in and sign-out, first-run setup, password change, submission, backup download, restore, migration, log export, and every denied (401/403), rate-limited (429) or failed attempt |
| Levels / outcomes | `info`, `warn`, `error`, `fatal` (debug and trace lines go to stdout only) | `success`, `denied`, `rate_limited`, `failure` |
| Retention | `logs.serverRetentionDays` (30 days), `logs.serverMaxEntries` (100 000) | `logs.auditRetentionDays` (365 days, at least 30), `logs.auditMaxEntries` (1 000 000) |
| Admin can | Filter, search, export and **Clear log** | Filter, search and export. It cannot be edited or cleared |

Retention runs at startup and then hourly: it deletes entries older than the retention period, then the oldest entries above the cap. Each run that deletes something is recorded in the server log. The retention settings are in **Settings** (or `logs.*` in `config.yaml`), and changing them is itself audited.

Each audit entry records the actor (`admin` with the username, or `anonymous`), the action (the API's `operationId`, for example `createAdminEvent`, `login` or `submitEvent`), the route, the affected resource, the outcome, the HTTP status, a request ID and a short summary of the change: names and changed field names, the old and new value of changed settings, file sizes and report counts. Passwords, Markdown descriptions, file contents and the values of fields that failed validation are never logged. Repeated failed attempts from the same client within a minute are merged into one entry with a count. When a request fails with an unexpected error, the audit entry and the server log entry share the same request ID. Access logs ("request completed") are not stored; the stdout log follows `server.logLevel` as before.

**Privacy.** The audit log never stores IP addresses. It stores a pseudonymous network identifier: a keyed hash (HMAC-SHA256, 16 hex characters) of the client address, with IPv6 addresses cut to their /64 network, and a key generated once and kept in the log store. The identifier lets you see that attempts came from the same network without revealing the address. Behind a reverse proxy, set `server.trustProxy` so the hash is of the visitor's address rather than the proxy's. The audit log also holds the admin username and, for public submissions, the submitter's AGT username, for `logs.auditRetentionDays`. The submission form tells visitors that submissions are logged with a pseudonymous network identifier for abuse prevention.

Logs are **not** part of backups, and a restore leaves both logs untouched; the restore itself is recorded in the audit log.

## Migrating from Amplify

**Migrate from Amplify** imports the old Amplify-era data (the published Google Sheets tabs plus the `agt_event_calendar_files` repository) from **one ZIP file** that you assemble. The server makes no network requests during migration.

### Operator steps

1. In Google Sheets, download the **`publishedEventDB`** and **`publishedHolidayDB`** tabs as CSV (*File → Download → Comma-separated values*, one tab at a time). File names don't matter; the files are recognised by their header rows.
2. Download the ZIP of the [`Folfchie/agt_event_calendar_files`](https://github.com/Folfchie/agt_event_calendar_files) repository from GitHub (*Code → Download ZIP*) and extract it. GitHub wraps the contents in a folder such as `agt_event_calendar_files-main/`; you need the `markdown/` and `covers/` folders inside it.
3. Put the two CSVs in a folder named `csv/`, next to `markdown/` and `covers/`.
4. **Select the three folders themselves (`csv/`, `markdown/`, `covers/`) and compress them into a ZIP.** Do **not** compress the folder that contains them.
5. In the dashboard, open **Migrate from Amplify**, upload the ZIP, review the **preview**, choose what to do with events that were already migrated (**Skip**, the default, or **Overwrite**), and click **Import**. Download the report if you want to keep it.

### Required ZIP layout

`csv/`, `markdown/` and `covers/` must be **at the root of the ZIP**:

```
migration.zip
├── csv/
│   ├── publishedEventDB.csv
│   └── publishedHolidayDB.csv
├── markdown/
│   ├── 0000.md
│   └── ...
└── covers/
    ├── 0001.jpg
    └── ...
```

✅ Correct: `csv/publishedEventDB.csv`
❌ Rejected: `my-folder/csv/publishedEventDB.csv` (wrapper folder)

A ZIP with the folders inside a wrapper folder is rejected with an error naming the folder; it is never unwrapped automatically. `markdown/` and `covers/` are optional.

### Compressing the three folders directly

- **Windows:** open the folder that contains `csv`, `markdown` and `covers`, select those three folders, right-click → *Send to → Compressed (zipped) folder* (Windows 11: *Compress to ZIP file*).
- **macOS:** in Finder, select the three folders, right-click → *Compress 3 Items*. The `__MACOSX/` and `.DS_Store` entries this adds are ignored.
- **Linux:** from the folder that contains them, run:

  ```bash
  zip -r migration.zip csv markdown covers
  ```

### What is imported

- Every event gets a **new UUID** and keeps its old 4-hex ID only for old links. All imported events and holidays are published.
- `EVENT_MD_URI` and `EVENT_COVER_IMG_URI` are matched **by file name** to `markdown/<name>` and `covers/<name>` in the ZIP. A missing or invalid description or cover is reported as a warning and the event is imported without it. Covers must pass the image checks below.
- `EVENT_LINKS` is split on commas; non-HTTP(S) links are dropped with a warning.
- Placeholder values such as `TBA` and `000000000000` are imported as they are. Invalid rows are skipped and reported with their source row numbers.
- Files in `markdown/` and `covers/` that no event references are listed in the report and not imported.
- Everything is written in one transaction. Running the migration again is safe: events whose old ID already exists are skipped (or overwritten if you choose so), and identical holidays are not duplicated.

### What is not migrated

- **Unpublished rows** (`PUBLISH = No` in the `eventDB`/`holidayDB` master tabs): only the published tabs are inputs. Re-create those events in the dashboard if you still need them.
- **The change log**: manage it in the dashboard.
- **Form responses** (`formResponses*` tabs): never imported, because they contain submitters' email addresses. A CSV whose headers don't match one of the two published formats is rejected.

ZIPs with absolute paths, `..` segments or symbolic links, and ZIPs that exceed the size or entry limits, are rejected.

## Backup & restore

### Backup

**Backup & restore → Download backup** produces `agt-event-calendar-backup-<timestamp>.zip` containing:

- `database.sqlite`: a consistent snapshot made with SQLite's online backup (sessions are removed),
- `uploads/`: all uploaded images,
- `config.yaml`: the current file exactly as mounted,
- `manifest.json`: app version, database schema version, creation time and a SHA-256 checksum for every file.

`.env` and the logs (`logs.sqlite`) are **never** included. The backup **does** contain sensitive data (the admin password hash and, if generated, the captcha key), so store it securely. External images referenced in descriptions are not included, because the app does not host them.

### Restore

Upload a backup under **Backup & restore → Restore** and review the preview. Before anything is replaced, the server checks the manifest checksums, that the archive contains only expected paths and is within the size limits, that the database passes `PRAGMA integrity_check` and has the expected schema (older schema versions are upgraded; newer ones are refused), and that every image passes the image checks.

Restoring replaces the database, uploads and dashboard settings, **including the admin account**, and signs you out. An automatic backup of the current state is saved first to `backups/pre-restore-backup-<timestamp>.zip` in the data directory (`/app/data` with Docker, `/var/lib/agt-event-calendar` for a local installation), and files are swapped so that a failed restore leaves the instance unchanged. Dashboard settings in the backup for keys that `config.yaml` now defines are ignored and listed in the report. The server log and audit log are not changed by a restore, and the restore is recorded in the audit log.

### Restoring `config.yaml` by hand

The app **never restores `config.yaml`**: it is mounted read-only, and restoring it would let a backup override the config-file-wins rule. When a backup contains one, the preview says so, shows how it differs from the current file, and offers it for download. To use it:

```bash
unzip -p agt-event-calendar-backup-<timestamp>.zip config.yaml > config.yaml
docker compose up -d --force-recreate
```

For a local installation:

```bash
sudo sh -c 'unzip -p agt-event-calendar-backup-<timestamp>.zip config.yaml > /etc/agt-event-calendar/config.yaml'
sudo systemctl restart agt-event-calendar
```

## Content safety

The goal: content from submissions, dashboard edits, migrated files or restored backups can never load or run scripts.

- **Markdown is stored exactly as written and rendered safely.** HTML-like text is accepted, never rejected, but raw HTML is **shown as plain text** and never rendered as elements, so tags such as `<script>`, `<iframe>`, `<object>` or `<img onerror=…>` are inert. Only `http:` and `https:` URLs are kept in links and images, so `javascript:` and `data:` links are neutralised.
- **External images** written with Markdown image syntax (`![alt](https://…)`) are rendered. The **visitor's browser loads them directly** from the image host, which can therefore see visitors' IP addresses; they are requested without a referrer and lazily, and a broken image does not break the description. The server never fetches, proxies or caches them, and they are not included in backups. Use `https://` image URLs: pages served over HTTPS block or upgrade `http://` images.
- **Uploaded images** must be PNG, JPEG, WebP or GIF, checked by their actual contents (magic bytes); a declared type or file extension that doesn't match the contents is rejected. **SVG uploads are not supported**, because SVG can contain scripts. The limit is **10 MB** per image, enforced while the upload streams. Files are stored under random server-generated names and served with the detected `Content-Type` and `X-Content-Type-Options: nosniff`.
- **Content-Security-Policy:** every response carries a CSP that allows scripts only from the app itself (`script-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`). Images may come from anywhere. The captcha's proof-of-work runs in a bundled same-origin worker.
- **Bundled assets:** all fonts and scripts are served by the app. The country-flag font is bundled from Twemoji (CC BY 4.0, see `public/fonts/TwemojiCountryFlags-LICENSE.md`). Portal codes are drawn as portal glyphs with the bundled NMS Glyphs Mono font, next to the hexadecimal code.

## Development

Requirements: Node.js 24.

```bash
npm ci
npm run check        # lint + all tests + build
npm run dev:server   # API + built UI on http://localhost:8080 (uses ./config.yaml if present)
npm run dev          # Vite dev server with hot reload; proxies /api to port 8080
```

For local development, start the API with a setup password, for example `AGT_SETUP_PASSWORD=dev-setup-password npm run dev:server`.

The app follows the [AGT Web Application Specification](docs/agt-webapp-spec.md) v4.0.0, a pinned copy from [`agtdarkshadow04/agt_webapp_specification`](https://github.com/agtdarkshadow04/agt_webapp_specification); [`AGENTS.md`](AGENTS.md) is the guide for AI coding agents and lists where the app deviates from the spec.

**API:** the REST API is described by an OpenAPI 3.1 document generated from the route schemas and served at `/api/openapi.json`. Admin routes need the session cookie from `POST /api/admin/login`; state-changing admin, setup and login requests also need the header `x-agt-request: 1`.

| Command | Purpose |
| --- | --- |
| `npm run lint` | Strict TypeScript check of the client, server and tests. |
| `npm test` | Client tests (`src/lib/*.test.ts`) and server tests (`server/test/*.test.ts`, Fastify `inject()` with `node:test`). |
| `npm run build` | Builds the SPA (`dist/`) and the server bundle (`dist-server/`). |
| `npm start` | Runs the built server. |

Project layout:

| Path | Purpose |
| --- | --- |
| `server/` | Fastify server: config, SQLite migrations (`server/migrations/*.sql`), auth, routes, OpenAPI (`openapi.ts`, `schemas.ts`), Migrate from Amplify, backup & restore |
| `deploy/` | systemd unit and Caddy example for local installations |
| `docs/agt-webapp-spec.md` | Pinned copy of the AGT Web Application Specification (don't edit; changes go to the spec repository) |
| `server/test/` | Server tests and the reference migration fixture (`fixtures/amplify-migration/`) |
| `src/` | Public calendar (React) |
| `src/admin/` | Admin dashboard (separate Vite entry, `admin.html`) |
| `src/lib/validation.ts` | Validation rules shared by the server and the browser |
| `src/translations.ts`, `src/admin/i18n.ts` | UI strings for all 10 locales |

## Troubleshooting

Start with the **Server log** tab in the admin dashboard: warnings and errors show there with their details, and the **Audit log** tab shows which requests failed or were denied (filter by outcome). If the app does not start at all, use the stdout log below.

### The server refuses to start

Read the log: `docker compose logs calendar` with Docker, or `journalctl -u agt-event-calendar` for a local installation. An invalid `config.yaml` is reported with the offending key, for example `Invalid config.yaml: server.prot: Unexpected property`.

### Setup says AGT_SETUP_PASSWORD is not set

Set it in `.env` and restart so the app picks it up: `docker compose up -d` with Docker, or `sudo systemctl restart agt-event-calendar` for a local installation.

### I am locked out of the admin account

Restore a backup that contains a known admin account. Otherwise stop the app, open the database (in the `calendar-data` volume with Docker, or `/var/lib/agt-event-calendar/agt-calendar.sqlite` for a local installation) with the `sqlite3` command-line tool and run `DELETE FROM admin; DELETE FROM sessions;`, then set `AGT_SETUP_PASSWORD` and start the app again to run first-run setup.

### Submissions are rejected

Check whether submissions are turned off (**Settings → `submissions.enabled`**, or in `config.yaml`), whether the rate limit was reached, and whether the captcha completed.

### Requests are rejected with "Too many requests"

Logins, setup attempts, admin uploads and submissions are rate limited per client. Wait for the time given in the message, or raise the limits under `rateLimits` (or `submissions.rateLimit`) in `config.yaml`. Behind a reverse proxy, set `server.trustProxy`; otherwise every visitor appears to come from the proxy's address and shares one limit.

### HTTPS, the admin cookie or client IPs behave wrongly behind a proxy

Set `server.trustProxy` to `true` or to the proxy's address, so the app sees the real client IP and that the request used HTTPS. With `session.secureCookie: auto`, the admin cookie is then marked `Secure` for HTTPS requests. If you can't sign in over plain HTTP, check that `session.secureCookie` is not forced to `true`.

### An external image in a description does not appear

The image host must be reachable from the visitor's browser and should use `https://`. A broken image does not affect the rest of the event details.
