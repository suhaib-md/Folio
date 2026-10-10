// Search panel: renders a searchFolder() result into a container. Like
// renderTree/renderOutline it takes data + callbacks, builds the DOM and
// reports clicks; the caller owns the state and re-renders. File content only
// ever reaches the DOM as text nodes.
//
// The query box, Aa and refresh buttons are built once per container and
// kept across renders (typing must not lose focus); the status line and
// results list are rebuilt. Result rows (file rows and match rows) are
// buttons in one roving-tabindex list: Up/Down move, Enter/click opens,
// Left/Right collapse/expand a file.
import { findInText } from './find.js';
import { basename } from './paths.js';

export const NO_FOLDER = 'Open a folder to search it.';

// How many characters before the match a snippet keeps (the rest is elided
// with a leading ellipsis so the match stays visible in a narrow sidebar).
const LEAD = 24;

const roots = new WeakMap(); // container -> { input, caseBtn, status, notice, list, h, s }

// Matches of `query` in `source` that start on lines before `line` (1-based):
// the Read-mode find bar's index of the first match on `line`.
export function matchOrdinal(source, line, query, matchCase) {
  if (!query || line <= 1) return 0;
  const text = source.replace(/\r\n?/g, '\n');
  let at = 0;
  for (let i = 1; i < line; i++) {
    const nl = text.indexOf('\n', at);
    if (nl < 0) return findInText(text, query, matchCase).length;
    at = nl + 1;
  }
  return findInText(text.slice(0, at), query, matchCase).length;
}

function relativeDir(folder, path) {
  const f = String(folder).replace(/\\/g, '/').replace(/\/+$/, '');
  const p = String(path).replace(/\\/g, '/');
  const rel = p.toLowerCase().startsWith(f.toLowerCase() + '/') ? p.slice(f.length + 1) : p;
  const i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function build(d, container) {
  const root = d.createElement('div');
  root.className = 'search-root';
  const box = d.createElement('div');
  box.className = 'search-box';
  const input = d.createElement('input');
  input.type = 'text';
  input.className = 'search-input';
  input.placeholder = 'Search';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Search folder');
  const caseBtn = d.createElement('button');
  caseBtn.type = 'button';
  caseBtn.className = 'search-btn search-case';
  caseBtn.title = 'Match case';
  caseBtn.textContent = 'Aa';
  const refresh = d.createElement('button');
  refresh.type = 'button';
  refresh.className = 'search-btn search-refresh';
  refresh.title = 'Search again';
  refresh.setAttribute('aria-label', 'Search again');
  refresh.textContent = '↻';
  box.append(input, caseBtn, refresh);
  const status = d.createElement('div');
  status.className = 'search-status';
  status.setAttribute('role', 'status');
  const notice = d.createElement('div');
  notice.className = 'search-notice';
  const list = d.createElement('div');
  list.className = 'search-results';
  list.setAttribute('role', 'tree');
  list.setAttribute('aria-label', 'Search results');
  root.append(box, status, notice, list);
  container.replaceChildren(root);

  const r = { root, input, caseBtn, status, notice, list, h: null, s: null };
  input.addEventListener('input', () => r.h.onQuery(input.value, false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      r.h.onQuery(input.value, true);
    } else if (e.key === 'ArrowDown') {
      const first = list.querySelector('.search-row');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  caseBtn.addEventListener('click', () => r.h.onToggleCase());
  refresh.addEventListener('click', () => r.h.onRefresh());
  // One tab stop that follows focus, so Shift+Tab returns to the row left.
  list.addEventListener('focusin', (e) => {
    const row = e.target.closest?.('.search-row');
    if (!row) return;
    for (const x of list.querySelectorAll('.search-row')) x.tabIndex = x === row ? 0 : -1;
  });
  list.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('.search-row');
    if (!row || e.ctrlKey || e.altKey || e.metaKey) return;
    const rows = [...list.querySelectorAll('.search-row')];
    const i = rows.indexOf(row);
    const isFile = row.classList.contains('search-file');
    const open = row.getAttribute('aria-expanded') === 'true';
    let next = null;
    if (e.key === 'ArrowDown') next = rows[i + 1];
    else if (e.key === 'ArrowUp') next = i === 0 ? input : rows[i - 1];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    else if (e.key === 'ArrowRight' && isFile && !open) r.h.onToggleFile?.(row.dataset.path);
    else if (e.key === 'ArrowLeft' && isFile && open) r.h.onToggleFile?.(row.dataset.path);
    else return;
    e.preventDefault();
    next?.focus();
  });
  roots.set(container, r);
  return r;
}

// state: { folder, query, matchCase, results|null, truncated, running,
// collapsed?: Set of file paths }
// handlers: { onQuery(q, now), onToggleCase(), onRefresh(), onPick(path, line,
// match, indexInLine), onToggleFile?(path) }
export function renderSearch(container, state, handlers) {
  const d = container.ownerDocument;
  if (!state.folder) {
    roots.delete(container);
    const p = d.createElement('p');
    p.className = 'sidebar-empty-text';
    p.textContent = NO_FOLDER;
    container.replaceChildren(p);
    return;
  }
  const r = roots.get(container) && container.contains(roots.get(container).root)
    ? roots.get(container)
    : build(d, container);
  r.h = handlers;
  r.s = state;
  const { input, caseBtn, status, notice, list } = r;

  if (input.value !== state.query) input.value = state.query;
  caseBtn.setAttribute('aria-pressed', String(!!state.matchCase));

  const files = state.results || [];
  const total = files.reduce((n, f) => n + f.matches.length, 0);
  if (state.running) status.textContent = 'Searching…';
  else if (!state.results || !state.query) status.textContent = '';
  else if (!files.length) status.textContent = 'No results';
  else status.textContent = `${total} ${total === 1 ? 'result' : 'results'} in ${files.length} ${files.length === 1 ? 'file' : 'files'}`;
  notice.textContent = state.truncated && !state.running ? `Showing the first ${total} matches` : '';
  notice.hidden = !notice.textContent;

  const scrollTop = list.scrollTop;
  const focused = list.contains(d.activeElement) ? d.activeElement.dataset.key : undefined;
  const collapsed = state.collapsed || new Set();
  const frag = d.createDocumentFragment();
  for (const file of files) {
    const open = !collapsed.has(file.path);
    const row = d.createElement('button');
    row.type = 'button';
    row.className = 'search-row search-file';
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', String(open));
    row.dataset.path = file.path;
    row.dataset.key = `f|${file.path}`;
    row.title = file.path;
    const tw = d.createElement('span');
    tw.className = 'search-twisty';
    tw.setAttribute('aria-hidden', 'true');
    const name = d.createElement('span');
    name.className = 'search-name';
    name.textContent = basename(file.path);
    const dir = d.createElement('span');
    dir.className = 'search-dir';
    dir.textContent = relativeDir(state.folder, file.path);
    const count = d.createElement('span');
    count.className = 'search-count';
    count.textContent = String(file.matches.length);
    row.append(tw, name, dir, count);
    row.addEventListener('click', () => r.h.onToggleFile?.(file.path));
    frag.append(row);
    if (!open) continue;
    const perLine = new Map();
    for (const m of file.matches) {
      const idx = perLine.get(m.line) || 0;
      perLine.set(m.line, idx + 1);
      const mr = d.createElement('button');
      mr.type = 'button';
      mr.className = 'search-row search-match';
      mr.setAttribute('role', 'treeitem');
      mr.dataset.key = `m|${file.path}|${m.line}|${m.col}`;
      mr.title = `${basename(file.path)}:${m.line}`;
      const num = d.createElement('span');
      num.className = 'search-line';
      num.textContent = `${m.line}: `;
      const snip = d.createElement('span');
      snip.className = 'search-snippet';
      snip.append(...snippet(d, m));
      mr.append(num, snip);
      mr.addEventListener('click', () => r.h.onPick(file.path, m.line, m, idx));
      frag.append(mr);
    }
  }
  list.replaceChildren(frag);
  list.scrollTop = scrollTop;

  const rows = [...list.querySelectorAll('.search-row')];
  const stop = rows.find((x) => x.dataset.key === focused) || rows[0];
  for (const x of rows) x.tabIndex = x === stop ? 0 : -1;
  if (focused !== undefined && stop && stop.dataset.key === focused) stop.focus({ preventScroll: true });
}

// [ '…'?, before, <mark>match</mark>, after, '…'? ] as DOM nodes.
function snippet(d, m) {
  const text = m.text || '';
  let from = 0;
  let lead = m.col > m.start; // the window did not begin at the line start
  if (m.start > LEAD) {
    from = m.start - LEAD;
    lead = true;
  }
  const out = [];
  if (lead) out.push(d.createTextNode('…'));
  out.push(d.createTextNode(text.slice(from, m.start)));
  const mark = d.createElement('mark');
  mark.textContent = text.slice(m.start, m.end);
  out.push(mark);
  out.push(d.createTextNode(text.slice(m.end)));
  if (text.length >= 200) out.push(d.createTextNode('…'));
  return out;
}
