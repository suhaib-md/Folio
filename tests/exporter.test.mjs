import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { buildExportHtml, mimeFor, rewriteKatexCss } = await import('../src/desktop/exporter.js');

const parse = (html) => new dom.window.DOMParser().parseFromString(html, 'text/html');

test('standalone doc with title and css', () => {
  const html = buildExportHtml({ title: 'Notes', bodyHtml: '<h1 id="a">Hi</h1><p>x</p>', css: 'body{color:red}', theme: 'dark', images: new Map() });
  assert.match(html, /^<!doctype html>/i);
  const d = parse(html);
  assert.equal(d.documentElement.getAttribute('lang'), 'en');
  assert.equal(d.documentElement.dataset.theme, 'dark');
  assert.ok(d.querySelector('meta[charset]'));
  assert.ok(d.querySelector('meta[name=viewport]'));
  assert.equal(d.title, 'Notes');
  assert.ok(d.querySelector('style').textContent.includes('body{color:red}'));
  assert.ok(d.querySelector('main.markdown.export h1#a'));
  assert.equal(parse(buildExportHtml({ title: 't', bodyHtml: '', css: '', theme: 'bogus', images: new Map() })).documentElement.dataset.theme, 'light');
});

test('no scripts or event handlers survive', () => {
  const bodyHtml = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">j</a>'
    + '<img src="x.png" onerror="x()"><base href="http://evil/"><meta http-equiv="refresh" content="0;url=http://evil">'
    + '<iframe src="http://evil"></iframe><svg onload="x()"><script>1</script><path d="M0 0"/></svg>';
  const html = buildExportHtml({ title: 't', bodyHtml, css: '', theme: 'light', images: new Map() });
  const d = parse(html);
  assert.equal(d.querySelectorAll('script, base, iframe, meta[http-equiv]').length, 0);
  assert.doesNotMatch(html, /onclick|onerror|onload|javascript:/i);
  assert.ok(d.querySelector('svg path'));
  assert.ok(d.querySelector('a'));
});

test('images embedded when provided, left as links otherwise', () => {
  const bodyHtml = '<img src="a.png" data-local-path="/x/a.png" data-orig-src="a.png"><img src="b.png"><img src="https://h/c.png">';
  const html = buildExportHtml({ title: 't', bodyHtml, css: '', theme: 'light', images: new Map([['a.png', 'data:image/png;base64,AAAA']]) });
  const imgs = [...parse(html).querySelectorAll('img')].map((i) => i.getAttribute('src'));
  assert.deepEqual(imgs, ['data:image/png;base64,AAAA', 'b.png', 'https://h/c.png']);
  assert.doesNotMatch(html, /data-local-path|data-orig-src|\/x\/a\.png/);
});

test('title is escaped', () => {
  const html = buildExportHtml({ title: '</title><script>alert(1)</script> & "q"', bodyHtml: '', css: '', theme: 'light', images: new Map() });
  const d = parse(html);
  assert.equal(d.title, '</title><script>alert(1)</script> & "q"');
  assert.equal(d.querySelectorAll('script').length, 0);
});

test('css cannot close the style element', () => {
  const html = buildExportHtml({ title: 't', bodyHtml: '', css: 'a{}</style><script>alert(1)</script>', theme: 'light', images: new Map() });
  assert.equal(parse(html).querySelectorAll('script').length, 0);
});

test('svg style kept, html style dropped', () => {
  const html = buildExportHtml({ title: 't', bodyHtml: '<style>p{}</style><div class="diagram"><svg><style>.a{fill:red}</style><rect class="a"/></svg></div>', css: '', theme: 'light', images: new Map() });
  const d = parse(html);
  assert.equal(d.querySelectorAll('main style').length, 1);
  assert.ok(d.querySelector('main svg style'));
});

test('mimeFor and katex css rewriting', () => {
  assert.equal(mimeFor('/a/b.JPG'), 'image/jpeg');
  assert.equal(mimeFor('x.svg'), 'image/svg+xml');
  assert.equal(mimeFor('x.png'), 'image/png');
  const css = '@font-face{src:url(fonts/A.woff2) format("woff2"),url(fonts/A.woff) format("woff"),url(fonts/A.ttf) format("truetype")}';
  const out = rewriteKatexCss(css, new Map([['fonts/A.woff2', 'data:font/woff2;base64,QQ==']]));
  assert.equal(out, '@font-face{src:url(data:font/woff2;base64,QQ==) format("woff2")}');
});
