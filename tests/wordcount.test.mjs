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

test('review fixes: www, underscore, titles, escapes, code spans, tags', () => {
  assert.equal(countWords('see www.example.com today'), 2);
  assert.equal(countWords('snake_case_name here'), 2);
  assert.equal(countWords('![alt](u.png (paren title))'), 1);
  assert.equal(countWords('![alt](u.png "t t")'), 1);
  assert.equal(countWords('\\[not a link\\](foo) bar'), 5);
  assert.equal(countWords('`x](y)` z'), 3);
  // `<b and c>` is not a tag (attributes must look like attributes).
  assert.equal(countWords('if a<b and c>d then'), 7);
  assert.equal(countWords('a <b>bold</b> <a href="http://x.y/z">link</a> <br/> c'), 4);
});

test('reference links, autolinks, bare urls, nested brackets', () => {
  assert.equal(countWords('see [the thing][ref] now'), 4);
  assert.equal(countWords('see [the thing][] now'), 4);
  assert.equal(countWords('mail <mailto:a@b.co> and <https://x.y/z> ok'), 3);
  assert.equal(countWords('go to https://example.com/a?b=c and http://x.y now'), 4);
  assert.equal(countWords('[outer [inner] text](http://u.v/w) end'), 4);
  assert.equal(countWords('[a](http://u.v/(x)) b'), 2);
});

test('adversarial inputs stay linear', () => {
  const five = 5 * 1024 * 1024;
  const rep = (u) => u.repeat(Math.ceil(five / u.length));
  for (const unit of ['<a ', '<a:', 'if a<b then ', '](a ', '](a "', '][', '[x](', '<a b=', '`', '\\[', 'http://', '<a b="c" ', 'a`b``c```d ', '` ', '`` x ']) {
    const text = rep(unit);
    const ms = bestOf(3, () => countWords(text));
    assert.ok(ms < budget(500), `${JSON.stringify(unit)} took ${ms.toFixed(0)} ms`);
  }
});

test('backtick runs stay inline and linear', () => {
  // 'x ' + backticks is one paragraph (a bare backtick line would be a fence).
  const mk = (n) => 'x ' + '`'.repeat(n);
  assert.equal(countWords(mk(10)), 1);
  const N = 10000;
  const small = mk(N);
  const big = mk(4 * N);
  const t1 = bestOf(3, () => countWords(small));
  const t4 = bestOf(3, () => countWords(big));
  assert.ok(t4 < 8 * Math.max(t1, 1), `N: ${t1.toFixed(1)} ms, 4N: ${t4.toFixed(1)} ms`);
  const huge = bestOf(2, () => countWords(mk(5 * 1024 * 1024)));
  assert.ok(huge < budget(500), `5 MB took ${huge.toFixed(0)} ms`);
  // runs of every length, none matching
  let ramp = 'x ';
  for (let i = 1; ramp.length < 2 * 1024 * 1024; i++) ramp += '`'.repeat(i) + ' w ';
  assert.ok(bestOf(2, () => countWords(ramp)) < budget(500));
  // semantics
  assert.equal(countWords('a `` b ` c `` d'), 4);
  assert.equal(countWords('`one two` and ``three four``'), 5);
  assert.equal(countWords('``a ` b`` c'), 3);
  assert.equal(countWords('`unclosed words'), 2);
});
