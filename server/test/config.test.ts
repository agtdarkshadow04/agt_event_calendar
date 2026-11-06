import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ConfigError, EDITABLE_SETTINGS, MAX_IMAGE_BYTES, loadConfig, parseConfigText } from '../config';

describe('config.yaml validation', () => {
  it('names the bad key for unknown keys and invalid values', () => {
    assert.throws(() => parseConfigText('server:\n  prot: 80\n'), (error: Error) =>
      error instanceof ConfigError && /server\.prot/.test(error.message));
    assert.throws(() => parseConfigText('submissions:\n  enabled: "yes please"\n'), /submissions\.enabled/);
    assert.throws(() => parseConfigText('site:\n  supportUrl: javascript:alert(1)\n'), /site\.supportUrl/);
    assert.throws(() => parseConfigText('uploads:\n  maxImageBytes: 10485761\n'), /uploads\.maxImageBytes/);
    assert.throws(() => parseConfigText('a: [\n'), /not valid YAML/);
    assert.throws(() => parseConfigText('- 1\n'), /mapping/);
  });

  it('uses defaults when the file is missing or empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'agt-config-'));
    const missing = loadConfig(path.join(dir, 'missing.yaml'));
    assert.equal(missing.rawText, null);
    assert.equal(missing.port, 8080);
    writeFileSync(path.join(dir, 'config.yaml'), '# only comments\n');
    assert.deepEqual(loadConfig(path.join(dir, 'config.yaml')).file, {});
  });

  it('ships an example config that parses and documents every dashboard setting', () => {
    const text = readFileSync('config.example.yaml', 'utf8');
    const uncommented = text.split('\n').map((line) => line.replace(/^(\s*)# ?(?=[a-zA-Z]+:)/, '$1')).join('\n');
    parseConfigText(uncommented);
    for (const key of Object.keys(EDITABLE_SETTINGS)) {
      assert.ok(text.includes(`${key.split('.').pop()}:`), `${key} is documented`);
    }
    assert.equal(EDITABLE_SETTINGS['uploads.maxImageBytes'].default, MAX_IMAGE_BYTES);
  });
});
