import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

// Brand assets and the base stylesheet are copied unmodified from the spec's assets/ (UI-15, UI-16).

/** SHA-256 of each file in the spec's assets/README.md at v6.0.0. */
const SPEC_ASSETS: Record<string, string> = {
  'public/AgtOfficialLogo.webp': '8bed1e5481a7ca2fc47728d67cebaa7a0e86412499b886d5755ed99bc9456674',
  'public/NMSFuturaProBook_Kerned.ttf': '08ad168f7fe58780fcb11c9369c9762ab83f30356fe4192ed60050a216a9798b',
  'public/NMS-Glyphs-Mono-fixed2026.ttf': 'bd996c81bd0c4660adf10087335ab9fd1ce420c2036ed2346676c68e8ce387fc',
  'public/fonts/TwemojiCountryFlags.woff2': '9f04f14429bb6a9f415c7a4dd902a918d7e81a4f7526c415496fdb063954e3b8',
  'public/fonts/NMSFuturaProBook-OFL.txt': 'e77bd97ea16773878878adbf0ac357fe1b355bdf50ca2042580240e0e0eba68c',
  'public/fonts/TwemojiCountryFlags-LICENSE.md': 'f12e4dfd8d656f0134ae2d54ff9683a0fdb15dd9e7814352ff3cad80d1e28c3d',
  'src/agt-base.css': 'eded1c5ac13280c1d752b05291766e5de1fbd8918ef6731a2b8e69d0a19cabf8',
};

describe('brand assets (UI-15, UI-16)', () => {
  it('ships every spec asset and licence file unmodified', () => {
    for (const [file, sha256] of Object.entries(SPEC_ASSETS)) {
      assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), sha256, `${file} differs from the spec's copy`);
    }
  });

  it('imports the base stylesheet first and never redefines its tokens or fonts', () => {
    const styles = readFileSync('src/styles.css', 'utf8');
    assert.match(styles, /^@import '\.\/agt-base\.css';\n/);
    for (const file of ['src/styles.css', 'src/admin/admin.css']) {
      const css = readFileSync(file, 'utf8');
      assert.doesNotMatch(css, /@font-face/, `${file} declares a font`);
      assert.doesNotMatch(css, /^\s*--(agt-[\w-]+|bg|surface[\w-]*|text|muted|line[\w-]*|radius[\w-]*|shadow)\s*:/m, `${file} redefines a token`);
    }
  });

  it('does not bundle NMS Alphabet, whose licence forbids web-font hosting (UI-3)', () => {
    assert.equal(existsSync('public/nms-alphabet.ttf'), false);
  });

  it('credits every bundled font in the README (DOC-1)', () => {
    const readme = readFileSync('README.md', 'utf8');
    const credits = readme.slice(readme.indexOf('\n## Credits'));
    assert.ok(readme.indexOf('\n## Credits') > readme.indexOf('\n## Troubleshooting'), 'Credits follows Troubleshooting');
    for (const text of ['NMS Futura', 'NMSCD', 'Blend3rman', 'NMS Glyphs Mono', 'Stephan van der Feest', 'Hello Games',
      'Twemoji Country Flags', 'SIL Open Font License 1.1', 'CC BY-NC-SA 4.0', 'CC BY 4.0', 'non-commercially']) {
      assert.ok(credits.includes(text), `Credits mentions ${text}`);
    }
  });
});
