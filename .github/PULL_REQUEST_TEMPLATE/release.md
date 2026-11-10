<!--
Release PR checklist (AGT web app spec VER-12, TEST-6 to TEST-9). Open it with
https://github.com/agtdarkshadow04/agt_event_calendar/compare/main...<branch>?template=release.md
The release PR only dates the version's CHANGELOG heading. Do not tag while any item below fails: fix it in a new PR first.
-->

# Release vX.Y.Z

Changes the `## [X.Y.Z] - Unreleased` heading in `CHANGELOG.md` to today's date, nothing else.

## Dependency review (STACK-6)

- `package-lock.json` changes since the previous release (new packages, major version changes):
- `npm audit --omit=dev`:

## Browser tests (TEST-6)

- [ ] `npm run test:e2e` passes in CI on the release commit: <link to the run>

## Manual accessibility check (TEST-7)

- [ ] Every public and admin flow works with the keyboard alone, with a visible focus indicator.
- [ ] A screen reader (NVDA with Firefox, or VoiceOver with Safari) announces the main flows, dialogs and status messages sensibly.
- [ ] Every colour pair added since the last release meets the A11Y-1 contrast ratios.
- [ ] The UI works at 200 % browser zoom, at the 2× font scale, and with `prefers-reduced-motion` on.
- [ ] Every locale renders, including Thai, Chinese, Hindi and Japanese in the fallback fonts.

Checked by, with browser and screen reader versions:

## Installation smoke tests (TEST-8), from a clean checkout of the release commit, following the README

- [ ] **Docker Compose:** `config.yaml` and `.env` with a setup password, `docker compose up -d --build`, and `docker compose ps` reports `healthy`.
  `curl -fsS http://127.0.0.1:8080/api/health` succeeds, `/api/setup/status` reports `{ "adminExists": false, "setupPasswordConfigured": true }`,
  and the port is published on `127.0.0.1` only. Finished with `docker compose down -v`.
- [ ] **Local installation** on Ubuntu 24.04 or Debian 12/13: `systemctl is-active agt-event-calendar` reports `active`,
  the same `curl` checks pass, and `journalctl -u agt-event-calendar` shows no errors.
- [ ] **Behind a proxy:** the server test for the `Secure` cookie with `server.trustProxy` passes (part of `npm run check`).

Results (OS, Docker and Node versions, anything unexpected):

## Upgrade and rollback test (TEST-9), from 3.0.0 on

- [ ] Installed the previous release tag with Docker, completed setup, created at least one event, holiday, change-log entry and image, and downloaded a backup.
- [ ] Upgraded to the release commit as the README's *Upgrading* section and this version's upgrade notes say.
- [ ] The data is intact, the server log shows the migrations, and the dashboard header shows the new version.
- [ ] Rolled back as *Rolling back* says: the previous version runs with the restored data.

Results:
