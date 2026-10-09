// Quick-open ranking. Pure, no DOM.
//
// fuzzyMatch(query, candidate): case-insensitive subsequence match. Instead
// of taking the first occurrence of each letter (which makes "gd" prefer
// "bigdata" over "guide"), a small dynamic programme finds the alignment with
// the best score. Candidates are file names / relative paths, so the cost
// (query x candidate x 1) is tiny.
//
// Score = sum over matched characters of
//   MATCH            1     every matched character
//   WORD_START       +10   it follows / \ - _ . or a space, starts the text, or
//                          is an upper-case letter after a lower-case one
//   CONSECUTIVE      +5    it directly follows the previous matched character
// minus
//   GAP              1 per skipped character between two matches
//   LEADING          0.1 per character before the first match (earlier wins)
// Higher is better.
//
// rankFiles adds on top of that:
//   NAME_BONUS       1000  a match inside the file name outranks any
//                          path-only match (scores never reach this)
//   RECENT_BONUS     2 for the most recent file, 0.1 less per step, floor 0:
//                          a tie-break, not enough to beat a better match
// Ties: shorter file name first, then rel alphabetically (plain code-unit
// order, so the result is the same on every machine).
import { normalizePath } from './tabs.js';

export const MATCH = 1;
export const WORD_START = 10;
export const CONSECUTIVE = 5;
export const GAP = 1;
export const LEADING = 0.1;
export const NAME_BONUS = 1000;
export const RECENT_BONUS = 2;
export const RECENT_STEP = 0.1;

const SEPARATORS = '/\\-_. ';

// toLowerCase() on the whole string when it keeps the length (nearly always);
// otherwise per character so indices stay aligned.
function lowerStr(s) {
  const l = s.toLowerCase();
  // Word-final sigma lower-cases to U+03C2 in a whole string, U+03C3 alone.
  if (l.length === s.length) return l.replace(/\u03c2/g, '\u03c3');
  let out = '';
  for (const ch of s) {
    const c = ch.toLowerCase();
    out += c.length === ch.length ? c : ch;
  }
  return out.replace(/\u03c2/g, '\u03c3');
}
const isLowerCh = (ch) => ch.toLowerCase() === ch && ch.toUpperCase() !== ch;
const isUpperCh = (ch) => ch.toUpperCase() === ch && ch.toLowerCase() !== ch;

function isWordStart(text, j) {
  if (j === 0) return true;
  const prev = text[j - 1];
  return SEPARATORS.includes(prev) || (isLowerCh(prev) && isUpperCh(text[j]));
}

// A candidate prepared once: lower-cased text and a per-character bonus.
// Cached per file object by rankFiles, so typing doesn't redo it.
function prepare(text) {
  const n = text.length;
  const bonus = new Float64Array(n);
  for (let j = 0; j < n; j++) bonus[j] = MATCH + (isWordStart(text, j) ? WORD_START : 0);
  return { lower: lowerStr(text), bonus };
}

// A space in the query matches any separator, so "todo list" finds
// "todo-list.md" and "Todo List.md".
const same = (qc, tc) => qc === tc || (qc === ' ' && SEPARATORS.includes(tc));

// Prepared candidates, per file object (so a warm file list ranks fast).
const prepared = new WeakMap();

let scoreBuf = new Float64Array(0);
let fromBuf = new Int32Array(0);

// q: lower-cased query; prep: prepare() result.
function align(q, prep) {
  const t = prep.lower;
  const bonus = prep.bonus;
  const m = q.length;
  const n = t.length;
  if (m > n) return null;

  // Cheap rejection: is it a subsequence at all?
  let k = 0;
  for (let j = 0; j < n && k < m; j++) if (same(q[k], t[j])) k++;
  if (k < m) return null;

  const NEG = -Infinity;
  if (scoreBuf.length < m * n) {
    scoreBuf = new Float64Array(m * n);
    fromBuf = new Int32Array(m * n);
  }
  const score = scoreBuf;
  const from = fromBuf;
  score.fill(NEG, 0, m * n);
  for (let i = 0; i < m; i++) {
    const row = i * n;
    const prev = row - n;
    // Best earlier-row cell k <= j-2 as dp[k] + k (gap cost is linear).
    let runBest = NEG;
    let runAt = -1;
    for (let j = 0; j < n; j++) {
      if (i > 0 && j >= 2 && score[prev + j - 2] > NEG) {
        const v = score[prev + j - 2] + (j - 2);
        if (v > runBest) { runBest = v; runAt = j - 2; }
      }
      if (!same(q[i], t[j])) continue;
      if (i === 0) {
        score[row + j] = bonus[j] - LEADING * j;
        continue;
      }
      let best = NEG;
      let at = -1;
      if (runAt >= 0) {
        best = runBest - GAP * (j - 1);
        at = runAt;
      }
      if (j >= 1 && score[prev + j - 1] > NEG) {
        const v = score[prev + j - 1] + CONSECUTIVE;
        if (v >= best) { best = v; at = j - 1; }
      }
      if (at >= 0) {
        score[row + j] = best + bonus[j];
        from[row + j] = at;
      }
    }
  }

  let end = -1;
  let top = NEG;
  const last = (m - 1) * n;
  for (let j = 0; j < n; j++) {
    if (score[last + j] > top) { top = score[last + j]; end = j; }
  }
  if (end < 0) return null;
  const positions = new Array(m);
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j;
    j = from[i * n + j];
  }
  return { score: top, positions };
}

export function fuzzyMatch(query, candidate) {
  const q = lowerStr(String(query));
  if (q.length === 0) return { score: 0, positions: [] };
  const text = String(candidate);
  return align(q, prepare(text));
}

// files: { path, rel, name }[]; recentPaths: most recent first.
// Result items: { file, positions, inName }. When inName, positions index
// into file.name; otherwise into file.rel. Empty query: recent files in
// recent order, then the rest alphabetically by rel (case-insensitive).
//
// createRanker(files, recentPaths) -> rank(query, limit = 50). It prepares
// each file once (lower-cased text and word-start bonuses, lazily) and, when
// a query extends the previous one, only re-examines the files that matched
// the previous one (a match for "abc" is always a match for "ab").
export function createRanker(files, recentPaths = []) {
  const recentIndex = new Map();
  recentPaths.forEach((p, i) => {
    const key = normalizePath(p);
    if (!recentIndex.has(key)) recentIndex.set(key, i);
  });
  const recentRank = (file) => recentIndex.get(normalizePath(file.path));
  const prep = (file) => {
    let p = prepared.get(file);
    if (!p) {
      p = { name: prepare(file.name), rel: prepare(file.rel) };
      prepared.set(file, p);
    }
    return p;
  };
  for (const file of files) prep(file); // once, when the palette opens
  let lastQ = '';
  let pool = files; // files that matched lastQ (all of them when lastQ is '')

  return function rank(query, limit = 50) {
    const q = lowerStr(String(query).trim());
    if (!q) {
      lastQ = '';
      pool = files;
      const order = (file) => {
        const r = recentRank(file);
        return r === undefined ? Infinity : r;
      };
      return files
        .map((file) => ({ file, r: order(file) }))
        .sort((a, b) => {
          if (a.r !== b.r) return a.r < b.r ? -1 : 1;
          return compareText(a.file.rel.toLowerCase(), b.file.rel.toLowerCase()) || compareText(a.file.rel, b.file.rel);
        })
        .slice(0, limit)
        .map(({ file }) => ({ file, positions: [], inName: true }));
    }
    const source = lastQ && q.startsWith(lastQ) ? pool : files;
    const hits = [];
    for (const file of source) {
      const pf = prep(file);
      let inName = true;
      let match = align(q, pf.name);
      if (match) {
        match.score += NAME_BONUS;
      } else {
        inName = false;
        match = align(q, pf.rel);
      }
      if (!match) continue;
      const r = recentRank(file);
      const score = match.score + (r === undefined ? 0 : Math.max(0, RECENT_BONUS - RECENT_STEP * r));
      hits.push({ file, positions: match.positions, inName, score });
    }
    lastQ = q;
    pool = hits.map((h) => h.file);
    hits.sort((a, b) =>
      b.score - a.score ||
      a.file.name.length - b.file.name.length ||
      compareText(a.file.rel, b.file.rel));
    return hits.slice(0, limit).map(({ file, positions, inName }) => ({ file, positions, inName }));
  };
}

export function rankFiles(query, files, recentPaths = [], limit = 50) {
  return createRanker(files, recentPaths)(query, limit);
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Flatten a list_tree root (TreeNode: { name, path, kind: 'dir'|'file',
// children }) to files with `rel` = path under the root, in the root's own
// separator style, no leading separator.
export function flattenTree(root) {
  const sep = /\\/.test(root.path) || /^[A-Za-z]:/.test(root.path) ? '\\' : '/';
  const out = [];
  const walk = (node, prefix) => {
    for (const child of node.children || []) {
      const rel = prefix + child.name;
      if (child.kind === 'dir') walk(child, rel + sep);
      else out.push({ path: child.path, rel, name: child.name });
    }
  };
  walk(root, '');
  return out;
}

// What the palette shows for a ranked item: the dimmed folder text, the
// positions to bold in it, and the positions to bold in the name.
// rel normally ends with the file name (folder mode); with no folder open it
// is just the parent folder (recent mode).
export function displayParts(file, positions, inName) {
  const { rel, name } = file;
  if (inName) return { folder: relFolder(file), folderPositions: [], namePositions: positions };
  const hasName = endsWithName(file);
  const folder = relFolder(file);
  const nameStart = hasName ? rel.length - name.length : Infinity;
  const folderPositions = [];
  const namePositions = [];
  for (const p of positions) {
    if (p < folder.length) folderPositions.push(p);
    else if (p >= nameStart) namePositions.push(p - nameStart);
  }
  return { folder, folderPositions, namePositions };
}

function endsWithName({ rel, name }) {
  if (!rel.endsWith(name)) return false;
  const before = rel.length - name.length - 1;
  return before < 0 ? rel === name : rel[before] === '/' || rel[before] === '\\';
}

function relFolder(file) {
  if (!endsWithName(file)) return file.rel;
  return file.rel.slice(0, Math.max(0, file.rel.length - file.name.length - 1));
}
