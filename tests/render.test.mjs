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
