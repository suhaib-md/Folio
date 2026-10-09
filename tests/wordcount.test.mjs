import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget, bestOf } from './perf-budget.mjs';
import { countWords, formatCount } from '../src/desktop/wordcount.js';

test('plain words', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n\n'), 0);
  assert.equal(countWords('one two  three\n\nfour'), 4);
  assert.equal(countWords("don't well-known 3.14"), 4);
  assert.equal(countWords('# Title\n\n- a\n- b\n\n> quote here\n\n| h | i |\n|--|--|\n| c1 | c2 |\n'), 9);
  assert.equal(countWords('use `npm install` now'), 4);
  assert.equal(countWords('1. one\n2. two\n   - nested\n'), 3);
});

test('excludes fenced and indented code and front matter', () => {
  assert.equal(countWords('---\ntitle: a b c\n---\nreal words'), 2);
  assert.equal(countWords('﻿---\r\ntitle: x\r\n---\r\nreal'), 1);
  assert.equal(countWords('a\n\n---\n\nb'), 2); // not at the very start: a rule
  assert.equal(countWords('---\nnever closed words'), 3);
  assert.equal(countWords('before\n\n```js\nconst a = 1;\n```\n\nafter'), 2);
  assert.equal(countWords('~~~\nx y z\n~~~\n\nok'), 1);
  assert.equal(countWords('para\n\n    indented code here\n\nend'), 2);
  assert.equal(countWords('<div>\nraw html block\n</div>\n\ntext'), 1);
});

test('link text counted, url not', () => {
  assert.equal(countWords('see [the docs](https://example.com/some/long/path) now'), 4);
  assert.equal(countWords('[ref]: https://example.com/x\n\ntext'), 1);
  assert.equal(countWords('<https://example.com>'), 0);
});

test('image alt counted, target not', () => {
  assert.equal(countWords('![a cat photo](cat.png "A title here")'), 3);
});

test('formatting markers not words', () => {
  assert.equal(countWords('**bold** _x_'), 2);
  assert.equal(countWords('~~gone~~ \\* *em*'), 2);
  assert.equal(countWords('a &amp; b'), 2);
});

test('cjk-free unicode words', () => {
  assert.equal(countWords('naïve café'), 2);
  assert.equal(countWords('näive'), 1);
  assert.equal(countWords('Привет мир'), 2);
});

test('formatCount thresholds', () => {
  assert.equal(formatCount(0), '');
  assert.equal(formatCount(1), '1 word · 1 min read');
  assert.equal(formatCount(2), '2 words · 1 min read');
  assert.equal(formatCount(230), '230 words · 1 min read');
  assert.equal(formatCount(231), '231 words · 2 min read');
  assert.equal(formatCount(1234), '1,234 words · 6 min read');
  assert.equal(formatCount(1234567), '1,234,567 words · 5368 min read');
});

test('5 MB under 500 ms', () => {
  const para = 'The *quick* brown [fox](https://example.com/a/b) jumps over the `lazy` dog, don\'t you think? ![alt](x.png)\n\n';
  const block = '# Heading\n\n' + para.repeat(8) + '- item one\n- item two\n\n```\ncode block\n```\n\n';
  const text = block.repeat(Math.ceil((5 * 1024 * 1024) / block.length));
  const ms = bestOf(3, () => countWords(text));
  assert.ok(ms < budget(500), `took ${ms.toFixed(0)} ms`);
});
