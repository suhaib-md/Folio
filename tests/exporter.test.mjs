import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { buildExportHtml, mimeFor, rewriteKatexCss, collectImages, CSP } = await import('../src/desktop/exporter.js');

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
  assert.equal(d.querySelectorAll('script, base, iframe, main meta').length, 0);
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

const opts = (bodyHtml) => ({ title: 't', bodyHtml, css: '', theme: 'light', images: new Map() });

test('CSP meta present, before the style, and survives hostile content', () => {
  const html = buildExportHtml(opts('<meta http-equiv="Content-Security-Policy" content="default-src *">'));
  const metas = [...parse(html).querySelectorAll('meta[http-equiv]')];
  assert.equal(metas.length, 1);
  assert.equal(metas[0].getAttribute('content'), CSP);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'));
  assert.match(CSP, /default-src 'none'.*img-src data: https:.*font-src data:/);
});

test('fetching vectors are removed', () => {
  const body = '<img src="https://h/a.png" srcset="http://evil/1.png 1x"><picture><source srcset="http://evil/2.png"><img src="x.png"></picture>'
    + '<video src="http://evil/v" poster="http://evil/p"></video><audio src="http://evil/a"></audio><input type="image" src="http://evil/i.png">'
    + '<table background="http://evil/b.png"><tr><td>x</td></tr></table>'
    + '<svg><image href="http://evil/s.png"/><filter><feImage href="http://evil/f.png"/></filter><rect/></svg>';
  const html = buildExportHtml(opts(body));
  const main = html.slice(html.indexOf('<main'));
  assert.doesNotMatch(main, /evil|srcset|<picture|<source|<video|<audio|background=|poster|<image|feimage/i);
  assert.match(main, /https:\/\/h\/a\.png/);
});

test('collectImages uses the lookup, never attributes in the document', async () => {
  const d = new JSDOM('<body><img id="a" src="asset://a" data-local-path="/secret.png" data-orig-src="s.png"><img id="b" src="asset://b"><img id="c" src="https://x/r.png" data-local-path="/home/u/secret.png"></body>').window.document;
  const read = [];
  const lookup = (img) => (img.id === 'b' ? { orig: 'b.png', path: '/docs/b.png' } : undefined);
  const images = await collectImages(d.body, async (p) => { read.push(p); return 'QQ=='; }, lookup);
  assert.deepEqual(read, ['/docs/b.png']);
  assert.deepEqual([...images.keys()], ['b.png']);
  assert.equal(d.getElementById('b').getAttribute('src'), 'b.png');
  assert.equal(d.getElementById('c').getAttribute('src'), 'https://x/r.png');
  const out = buildExportHtml(opts(d.body.innerHTML));
  assert.doesNotMatch(out, /data-local-path|data-orig-src|secret/);
});

test('embed budget: images past it stay links', async () => {
  const d = new JSDOM('<body><img id="a"><img id="b"><img id="c"></body>').window.document;
  const lookup = (img) => ({ orig: `${img.id}.png`, path: `/${img.id}.png` });
  const reads = [];
  const images = await collectImages(d.body, async (p) => { reads.push(p); return 'A'.repeat(100); }, lookup, 'data:image/png;base64,'.length * 2 + 250);
  assert.deepEqual([...images.keys()], ['a.png', 'b.png']);
  assert.equal(d.getElementById('c').getAttribute('src'), 'c.png');
});
