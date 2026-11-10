import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { createTestServer, setupAdmin } from './helpers';
import type { TestServer } from './helpers';

// Versioning (AGT web app spec §21, TEST-4).

/** SemVer 2.0.0 without build metadata, optionally with a release-candidate suffix (VER-1, VER-7). */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.[1-9]\d*)?$/;
const HEADING = /^## \[([^\]]+)\] - (Unreleased|\d{4}-\d{2}-\d{2})$/;
const GROUPS = ['Upgrade notes', 'Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];

const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const lockVersion = (JSON.parse(readFileSync('package-lock.json', 'utf8')) as { version: string }).version;

interface Section { version: string; date: string; groups: string[] }

function changelogSections(): Section[] {
  const sections: Section[] = [];
  for (const line of readFileSync('CHANGELOG.md', 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      const match = HEADING.exec(line);
      assert.ok(match, `Malformed CHANGELOG heading: ${line}`);
      sections.push({ version: match[1], date: match[2], groups: [] });
    } else if (line.startsWith('### ')) {
      assert.ok(sections.length > 0, `Group outside a version section: ${line}`);
      sections[sections.length - 1].groups.push(line.slice(4));
    }
  }
  return sections;
}

const compare = (a: string, b: string) => {
  const [pa, pb] = [a, b].map((version) => version.split('-')[0].split('.').map(Number));
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
};

describe('versioning', () => {
  const servers: TestServer[] = [];
  after(async () => { for (const server of servers) await server.close(); });

  it('package.json holds a valid SemVer version that package-lock.json follows', () => {
    assert.match(packageVersion, SEMVER);
    assert.equal(lockVersion, packageVersion);
  });

  it('the newest CHANGELOG heading is the package.json version', () => {
    const sections = changelogSections();
    assert.ok(sections.length > 0, 'CHANGELOG.md has no version sections');
    assert.equal(sections[0].version, packageVersion);
  });

  it('CHANGELOG sections are valid, newest first, and only the newest may be unreleased', () => {
    const sections = changelogSections();
    sections.forEach((section, index) => {
      assert.match(section.version, SEMVER);
      if (index > 0) {
        assert.ok(compare(sections[index - 1].version, section.version) > 0, `${section.version} is out of order`);
        assert.notEqual(section.date, 'Unreleased', `${section.version} is not the newest but is unreleased`);
      }
      assert.ok(section.groups.length > 0, `${section.version} has no groups`);
      const order = section.groups.map((group) => GROUPS.indexOf(group));
      assert.ok(order.every((position) => position >= 0), `${section.version} has an unknown group: ${section.groups.join(', ')}`);
      assert.deepEqual(order, [...new Set(order)].sort((a, b) => a - b), `${section.version} groups are out of order or repeated`);
    });
  });

  it('every major version has Upgrade notes, and only major versions do', () => {
    for (const section of changelogSections()) {
      const [major, minor, patch] = section.version.split('-')[0].split('.').map(Number);
      const isMajor = major >= 1 && minor === 0 && patch === 0 && section.version !== '1.0.0';
      const hasNotes = section.groups.includes('Upgrade notes');
      if (isMajor) assert.ok(hasNotes, `${section.version} is a major version without Upgrade notes`);
      else assert.ok(!hasNotes, `${section.version} is not a major version but has Upgrade notes`);
    }
  });

  it('/api/openapi.json and GET /api/admin/session report the package.json version', async () => {
    const server = await createTestServer({ version: packageVersion });
    servers.push(server);
    const cookie = await setupAdmin(server);
    const openapi = await server.app.inject({ method: 'GET', url: '/api/openapi.json' });
    assert.equal(openapi.statusCode, 200);
    assert.equal((openapi.json() as { info: { version: string } }).info.version, packageVersion);
    const session = await server.app.inject({ method: 'GET', url: '/api/admin/session', headers: { cookie } });
    assert.equal(session.statusCode, 200);
    assert.equal((session.json() as { version: string }).version, packageVersion);
  });
});
