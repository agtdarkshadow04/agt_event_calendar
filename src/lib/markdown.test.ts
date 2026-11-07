import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../components/Markdown';

const FIXTURE = 'server/test/fixtures/amplify-migration/markdown';

function render(markdown: string): string {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://calendar.example' } },
  });
  try {
    return renderToStaticMarkup(createElement(Markdown, { children: markdown }));
  } finally {
    Reflect.deleteProperty(globalThis, 'window');
  }
}

/** Asserts that the markup contains no live elements that could run or load scripts. */
function assertInert(markup: string) {
  const html = markup.replace(/^<div class="markdown-body">/, '').replace(/<\/div>$/, '');
  for (const tag of ['script', 'iframe', 'object', 'embed', 'style', 'svg', 'form', 'div', 'b']) {
    assert.equal(new RegExp(`<${tag}[\\s>]`, 'i').test(html), false, `no <${tag}> element in ${html}`);
  }
  assert.equal(/<[^>]+\son[a-z]+=/i.test(html), false, 'no event-handler attributes');
  assert.equal(/(href|src)="(javascript|data|vbscript):/i.test(html), false, 'no script URLs');
}

describe('Markdown rendering', () => {
  it('shows raw HTML payloads as inert text', () => {
    const html = render([
      '<script>alert("xss")</script>',
      '',
      'Inline <img src=x onerror="alert(1)"> and <b>bold</b> tags.',
      '',
      '<iframe src="https://evil.example"></iframe>',
      '<object data="x.swf"></object><embed src="x.swf">',
      '<svg onload="alert(1)"></svg>',
      '<div onclick="alert(1)">MDX-like <Component prop={1} /></div>',
    ].join('\n'));
    assertInert(html);
    assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.match(html, /&lt;Component prop=\{1\} \/&gt;/);
  });

  it('neutralises javascript: and data: URLs in links and images', () => {
    const html = render('[click](javascript:alert(1)) [data](data:text/html,hi) ![x](javascript:alert(1)) [ok](https://example.com)');
    assertInert(html);
    assert.match(html, /<span>click<\/span>/);
    assert.match(html, /<a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  });

  it('renders external HTTP(S) Markdown images without a referrer', () => {
    const html = render('![Route map](https://images.example.com/map.png) ![plain](http://images.example.com/a.gif)');
    assert.match(html, /<img class="markdown-image" src="https:\/\/images\.example\.com\/map\.png" alt="Route map" loading="lazy" decoding="async" referrerPolicy="no-referrer"\/?>/i);
    assert.match(html, /src="http:\/\/images\.example\.com\/a\.gif"/);
  });

  it('renders the legacy fixtures: angle-bracket links, GFM tables, and HTML examples as text', () => {
    const intro = render(readFileSync(`${FIXTURE}/0000.md`, 'utf8'));
    assert.match(intro, /<a href="https:\/\/www\.nms-agt\.com\/"[^>]*>AGT website<\/a>/);
    const table = render(readFileSync(`${FIXTURE}/0001.md`, 'utf8'));
    assert.match(table, /<table>/);
    assert.match(table, /<img[^>]+src="https:\/\/example\.com\/hyades-route\.png"/);
    const guide = render(readFileSync(`${FIXTURE}/TEST.md`, 'utf8'));
    assertInert(guide);
    assert.match(guide, /&lt;iframe src=&quot;https:\/\/example\.com&quot;&gt;/);
    assert.match(guide, /<code>&lt;b&gt;inline code&lt;\/b&gt;<\/code>/);
    assert.match(guide, /<span>Bad link<\/span>/);
  });
});
