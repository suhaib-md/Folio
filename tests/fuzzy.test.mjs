import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budget, bestOf } from './perf-budget.mjs';
import { fuzzyMatch, rankFiles, createRanker, flattenTree, displayParts } from '../src/desktop/fuzzy.js';

const f = (rel, path = '/r/' + rel) => ({ path, rel, name: rel.split(/[\\/]/).pop() });

test('subsequence required', () => {
  assert.equal(fuzzyMatch('xyz', 'abc'), null);
  assert.equal(fuzzyMatch('ba', 'ab'), null);
  assert.equal(fuzzyMatch('abcd', 'abc'), null);
});

test('empty query matches with score 0', () => {
  assert.deepEqual(fuzzyMatch('', 'abc'), { score: 0, positions: [] });
});

test('case-insensitive', () => {
  assert.ok(fuzzyMatch('README', 'readme.md'));
  assert.ok(fuzzyMatch('readme', 'README.MD'));
});

test('word-start beats mid-word', () => {
  const r = rankFiles('gd', [f('bigdata.md'), f('guide.md')], []);
  assert.deepEqual(r.map((x) => x.file.name), ['guide.md', 'bigdata.md']);
});

test('camelCase and separators count as word starts', () => {
  const a = fuzzyMatch('mn', 'myNotes.md');
  const b = fuzzyMatch('mn', 'amnesia.md');
  assert.ok(a.score > b.score);
  assert.ok(fuzzyMatch('tl', 'todo-list.md').score > fuzzyMatch('tl', 'atlas.md').score);
});

test('consecutive run beats scattered', () => {
  assert.ok(fuzzyMatch('note', 'notes.md').score > fuzzyMatch('note', 'nxoxtxe.md').score);
});

test('name beats path-only', () => {
  const r = rankFiles('notes', [f('notes/todo.md'), f('notes.md')], []);
  assert.deepEqual(r.map((x) => x.file.rel), ['notes.md', 'notes/todo.md']);
  assert.deepEqual(r.map((x) => x.inName), [true, false]);
});

test('positions point at matched chars', () => {
  const m = fuzzyMatch('gd', 'guide.md');
  assert.deepEqual(m.positions, [0, 3]);
  const [hit] = rankFiles('gd', [f('docs/guide.md')], []);
  assert.deepEqual(hit.positions, [0, 3]); // inName: indices into name
  const [p] = rankFiles('dgu', [f('docs/guide.md')], []);
  assert.equal(p.inName, false);
  assert.deepEqual(p.positions, [0, 5, 6]); // indices into rel
});

test('empty query lists recent first, then alphabetical', () => {
  const files = [f('b.md'), f('a.md'), f('c.md'), f('Z.md')];
  const r = rankFiles('', files, ['/r/c.md', '/r/b.md', '/elsewhere/x.md']);
  assert.deepEqual(r.map((x) => x.file.name), ['c.md', 'b.md', 'a.md', 'Z.md']);
  assert.ok(r.every((x) => x.positions.length === 0));
});

test('recent paths match regardless of separators and case', () => {
  const files = [f('a.md', 'C:\\Notes\\a.md'), f('b.md', 'C:\\Notes\\b.md')];
  const r = rankFiles('', files, ['c:/notes/B.md']);
  assert.equal(r[0].file.name, 'b.md');
});

test('limit 50 by default, adjustable', () => {
  const files = Array.from({ length: 200 }, (_, i) => f(`file${i}.md`));
  assert.equal(rankFiles('', files, []).length, 50);
  assert.equal(rankFiles('file', files, []).length, 50);
  assert.equal(rankFiles('file', files, [], 5).length, 5);
});

test('windows paths and spaces', () => {
  const file = {
    path: 'C:\\Users\\Muhammed suhaib\\Notes\\Todo List.md',
    rel: 'Notes\\Todo List.md',
    name: 'Todo List.md',
  };
  const [hit] = rankFiles('todo li', [file, f('other.md')], []);
  assert.equal(hit.file, file);
  assert.equal(hit.inName, true);
  assert.deepEqual(hit.positions, [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(fuzzyMatch('notes\\todo', file.rel));
});

test('ties: shorter name, then alphabetical rel', () => {
  const r = rankFiles('a', [f('x/ab.md'), f('a.md'), f('w/ab.md')], []);
  assert.deepEqual(r.map((x) => x.file.rel), ['a.md', 'w/ab.md', 'x/ab.md']);
});

test('recent is only a small tie-break', () => {
  const files = [f('guide.md'), f('guide2.md')];
  // equal-ish: recent one wins even though its name is longer
  assert.equal(rankFiles('gu', files, ['/r/guide2.md'])[0].file.name, 'guide2.md');
  // but a clearly better match is not overturned
  const r = rankFiles('gd', [f('bigdata.md'), f('guide.md')], ['/r/bigdata.md']);
  assert.equal(r[0].file.name, 'guide.md');
});

test('flattenTree: relative paths in the root separator style', () => {
  const root = {
    name: 'N', path: 'C:\\Users\\me\\N', kind: 'dir', children: [
      { name: 'sub', path: 'C:\\Users\\me\\N\\sub', kind: 'dir', children: [
        { name: 'x.md', path: 'C:\\Users\\me\\N\\sub\\x.md', kind: 'file' } ] },
      { name: 'a.md', path: 'C:\\Users\\me\\N\\a.md', kind: 'file' },
    ],
  };
  assert.deepEqual(flattenTree(root).map((x) => x.rel), ['sub\\x.md', 'a.md']);
  const posix = { name: 'd', path: '/demo', kind: 'dir', children: [
    { name: 's', path: '/demo/s', kind: 'dir', children: [{ name: 'y.md', path: '/demo/s/y.md', kind: 'file' }] } ] };
  assert.deepEqual(flattenTree(posix), [{ path: '/demo/s/y.md', rel: 's/y.md', name: 'y.md' }]);
});

test('displayParts splits folder and name highlights', () => {
  const file = f('docs/guide.md');
  assert.deepEqual(displayParts(file, [0, 3], true), { folder: 'docs', folderPositions: [], namePositions: [0, 3] });
  assert.deepEqual(displayParts(file, [0, 5, 6], false), { folder: 'docs', folderPositions: [0], namePositions: [0, 1] });
  // recent mode: rel is the parent folder
  const r = { path: '/a/b/c.md', rel: '/a/b', name: 'c.md' };
  assert.deepEqual(displayParts(r, [1], false), { folder: '/a/b', folderPositions: [1], namePositions: [] });
});

test('a space in the query matches any separator', () => {
  for (const name of ['todo-list.md', 'todo_list.md', 'todo.list.md', 'Todo List.md']) {
    assert.ok(fuzzyMatch('todo list', name), name);
  }
  assert.ok(fuzzyMatch('notes todo', 'notes/todo.md'));
  assert.ok(fuzzyMatch('notes todo', 'notes\\todo.md'));
  assert.equal(fuzzyMatch('todo list', 'todolist.md'), null);
  assert.equal(rankFiles('todo list', [f('todo-list.md')], [])[0].inName, true);
});

test('extending a query gives the same result as a fresh ranking', () => {
  const files = Array.from({ length: 300 }, (_, i) => f(`dir${i % 7}/note-${i}-${'abc'[i % 3]}.md`));
  const rank = createRanker(files, ['/r/dir1/note-1-b.md']);
  for (const q of ['n', 'no', 'not', 'note', 'note 1', 'note 12', 'no', 'x']) {
    assert.deepEqual(rank(q), rankFiles(q, files, ['/r/dir1/note-1-b.md']), q);
  }
});

test('5000 files rank for "note" in under 15 ms', () => {
  const dirs = ['Projects', 'Notes', 'Archive 2024', 'Work\\Meetings', 'Personal\\Journal', 'Ideas'];
  const files = Array.from({ length: 5000 }, (_, i) => {
    const name = `${['meeting', 'note', 'draft', 'todo List', 'Research', 'plan'][i % 6]}-${i}.md`;
    const rel = `${dirs[i % dirs.length]}\\sub${i % 40}\\${name}`;
    return { path: `C:\\Users\\Muhammed suhaib\\Documents\\${rel}`, rel, name };
  });
  const recent = files.slice(0, 20).map((x) => x.path);
  const best = bestOf(3, () => rankFiles('note', files, recent));
  // Also the typing path: a ranker prepared once, then queries extending.
  // Only the final keystroke is timed, so the closure measures it itself and
  // bestOf's own timing (which includes ranker setup) is ignored.
  let calls = 0;
  let typing = Infinity;
  bestOf(3, () => {
    const r = createRanker(files, recent);
    r('n');
    r('no');
    r('not');
    const t = performance.now();
    r('note');
    const ms = performance.now() - t;
    if (calls++ > 0) typing = Math.min(typing, ms); // call 0 is the warm-up
  });
  assert.ok(typing < budget(15), `incremental keystroke took ${typing.toFixed(1)} ms, budget ${budget(15)} ms`);
  assert.ok(best < budget(15), `rankFiles took ${best.toFixed(1)} ms, budget ${budget(15)} ms`);
});

test('final sigma folds like find.js', async () => {
  const { fuzzyMatch } = await import('../src/desktop/fuzzy.js');
  assert.notEqual(fuzzyMatch('ΟΔΟΣ', 'ΟΔΟΣ.md'), null);
});

test('sigma typed either way matches', () => {
  assert.notEqual(fuzzyMatch('οδοσ', 'ΟΔΟΣ.md'), null);
  assert.notEqual(fuzzyMatch('οδος', 'ΟΔΟΣ.md'), null);
});
