import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRenderer } from '../src/render.js';
import { extractHeadings, buildOutline, currentIndex, headingIndexForLine } from '../src/desktop/outline.js';

test('atx and setext with levels and lines', () => {
  const h = extractHeadings('# One\n\ntext\n\nTwo\n===\n\nThree\n---\n\n###### Six\n');
  assert.deepEqual(
    h.map((x) => [x.level, x.text, x.line]),
    [[1, 'One', 1], [1, 'Two', 5], [2, 'Three', 8], [6, 'Six', 11]],
  );
});

test('ids match rendered html', () => {
  const src = '# A\n\n# A\n\n## Ünïcode & Co\n\n### `code` here\n';
  const html = createRenderer(new JSDOM('').window)(src);
  const dom = new JSDOM(html).window.document;
  const ids = [...dom.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((e) => e.id.replace(/^user-content-/, ''));
  assert.deepEqual(extractHeadings(src).map((x) => x.id), ids);
  assert.deepEqual(ids.slice(0, 2), ['a', 'a-1']);
  assert.equal(extractHeadings(src)[3].text, 'code here');
});

test('headings in fenced code and raw html are ignored', () => {
  const h = extractHeadings('```\n# no\n```\n\n<h1>raw</h1>\n\n    # indented\n\n# yes\n');
  assert.deepEqual(h.map((x) => [x.text, x.line]), [['yes', 9]]);
});

test('nested in blockquote and list item are found', () => {
  const h = extractHeadings('> # Quoted\n\n- # Item\n- text\n\n  ## Deep\n\n# End\n');
  assert.deepEqual(
    h.map((x) => [x.text, x.line]),
    [['Quoted', 1], ['Item', 3], ['Deep', 6], ['End', 8]],
  );
});

test('buildOutline nests h1>h3 and siblings', () => {
  const t = buildOutline(extractHeadings('# A\n\n### B\n\n## C\n\n# D\n'));
  assert.equal(t.length, 2);
  assert.deepEqual(t[0].children.map((c) => c.text), ['B', 'C']);
  assert.equal(t[0].children[1].index, 2);
  assert.equal(t[1].text, 'D');
});

test('currentIndex boundaries', () => {
  const tops = [0, 100, 300];
  assert.equal(currentIndex(tops, 0), 0);
  assert.equal(currentIndex(tops, 95), 0);
  assert.equal(currentIndex(tops, 96), 1); // 100 <= 96 + 4
  assert.equal(currentIndex(tops, 100), 1);
  assert.equal(currentIndex(tops, 1000), 2);
  assert.equal(currentIndex([50], 0), -1);
});

test('headingIndexForLine', () => {
  const h = [{ line: 3 }, { line: 10 }];
  assert.equal(headingIndexForLine(h, 1), -1);
  assert.equal(headingIndexForLine(h, 3), 0);
  assert.equal(headingIndexForLine(h, 9), 0);
  assert.equal(headingIndexForLine(h, 99), 1);
});

test('5 MB doc extracts under 1500 ms', () => {
  const chunk = '# Heading\n\nSome paragraph text with *emphasis* and `code`.\n\n- item\n- item\n\n';
  const src = chunk.repeat(Math.ceil((5 * 1024 * 1024) / chunk.length));
  // Best of three: the suite runs test files in parallel, so one run can be starved.
  let ms = Infinity;
  let h;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    h = extractHeadings(src);
    ms = Math.min(ms, performance.now() - t);
  }
  assert.ok(h.length > 1000);
  assert.ok(ms < 1500, `took ${ms} ms`);
});
