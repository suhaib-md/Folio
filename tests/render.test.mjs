import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/render.js';

const render = createRenderer(new JSDOM('').window);

test('renders GFM', () => {
  assert.match(render('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>/);
  const tasks = render('- [x] done');
  assert.match(tasks, /type="checkbox"/);
  assert.match(tasks, /checked/);
  assert.match(render('~~s~~'), /<del>s<\/del>/);
});

test('highlights code', () => {
  const html = render('```js\nconst a = 1\n```');
  assert.match(html, /class="hljs language-js"/);
  assert.match(html, /hljs-keyword/);
});

test('heading ids', () => {
  assert.match(render('# Hello World'), /id="user-content-hello-world"/);
});

test('clashing heading keeps id', () => {
  assert.match(render('# Images'), /id="user-content-images"/);
});

test('duplicate headings unique', () => {
  const html = render('# Intro\n# Intro');
  assert.match(html, /id="user-content-intro"/);
  assert.match(html, /id="user-content-intro-1"/);
  assert.match(render('# Intro'), /id="user-content-intro"/);
});

test('BOM and CRLF', () => {
  assert.match(render('﻿# Title\r\n\r\ntext'), /^<h1/);
});

test('sanitises', () => {
  const html = render([
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '[x](javascript:alert(1))',
    '<iframe src="https://e.com"></iframe>',
  ].join('\n\n'));
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<iframe/i);
});

test('external links open in new tab', () => {
  const ext = render('[a](https://example.com)');
  assert.match(ext, /target="_blank"/);
  assert.match(ext, /rel="noopener noreferrer"/);
  assert.doesNotMatch(render('[b](#intro)'), /target=/);
});

test('empty input', () => {
  assert.equal(render(''), '');
});

test('relative links open in new tab', () => {
  assert.match(render('[o](other.md)'), /target="_blank"/);
  assert.doesNotMatch(render('[m](mailto:a@b.co)'), /target=/);
});

test('unlabelled code is not auto-highlighted', () => {
  const bare = render('```\nconst a = 1\n```');
  assert.match(bare, /const a = 1/);
  assert.doesNotMatch(bare, /hljs-/);
  assert.doesNotMatch(render('```mermaid\ngraph TD\n```'), /<span/);
});

test('strips style and forms', () => {
  const html = render([
    '<style>body{display:none}</style>',
    '<form action="https://e.com"><input name="pw"></form>',
    '<div style="position:fixed;inset:0">x</div>',
  ].join('\n\n'));
  assert.doesNotMatch(html, /<style/i);
  assert.doesNotMatch(html, /<form/i);
  assert.doesNotMatch(html, /style=/i);
});

test('render time grows linearly with document size', () => {
  const doc = (n) => Array.from({ length: n }, (_, i) =>
    `## S${i}\n\nText *em* \`c\`.\n\n- a\n- b\n\n\`\`\`js\nlet x = ${i};\n\`\`\`\n`).join('\n');
  const time = (s) => {
    const t = performance.now();
    render(s);
    return performance.now() - t;
  };
  const small = doc(1000);
  const big = doc(4000);
  render(small); // warm up
  const a = Math.min(time(small), time(small));
  const b = time(big);
  // 4x the input: linear is ~4x the time, the old walkTokens path was ~16x.
  assert.ok(b < a * 8, `4x input took ${(b / a).toFixed(1)}x the time (${a.toFixed(0)} -> ${b.toFixed(0)} ms)`);
});
