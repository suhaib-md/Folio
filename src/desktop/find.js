// Find in Read mode: plain-text search over the rendered document, shown with
// the CSS Custom Highlight API so the document's DOM is never touched.

export const FIND_LIMIT = 10000;

// Lower-casing that never changes the string's length (so offsets found in
// the lowered copy are valid in the original): characters whose lower case is
// not exactly one UTF-16 unit are kept as they are.
function fold(s) {
  const l = s.toLowerCase();
  // Word-final sigma folds to \u03c2 in a whole-string lower case but to \u03c3
  // per character: make both \u03c3 (same length).
  if (l.length === s.length) return l.replace(/\u03c2/g, '\u03c3');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toLowerCase();
    out += c.length === 1 ? c : s[i];
  }
  return out.replace(/\u03c2/g, '\u03c3');
}

// All non-overlapping occurrences of `query` in `text`, in order, at most
// `limit`. Empty query -> [].
// `foldedText` (optional): fold(text) computed earlier, to skip redoing it.
export function findInText(text, query, matchCase, limit = FIND_LIMIT, foldedText) {
  const out = [];
  if (!query) return out;
  const hay = matchCase ? text : foldedText ?? fold(text);
  const needle = matchCase ? query : fold(query);
  let from = 0;
  while (out.length < limit) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    out.push({ start: at, end: at + needle.length });
    from = at + needle.length;
  }
  return out;
}

const el = (doc, tag, attrs = {}, text) => {
  const e = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};

// root: an empty container (the bar is built into it); getDocEl: the element
// holding the rendered document (may be replaced between calls).
export function createFindBar(root, getDocEl) {
  const document = root.ownerDocument;
  const win = document.defaultView;

  const input = el(document, 'input', {
    type: 'text', class: 'find-input', 'aria-label': 'Find', placeholder: 'Find',
    spellcheck: 'false', autocomplete: 'off',
  });
  const count = el(document, 'span', { class: 'find-count', 'aria-live': 'polite' });
  const prev = el(document, 'button', { type: 'button', class: 'find-btn', 'aria-label': 'Previous match', title: 'Previous match (Shift+Enter)' }, '↑');
  const next = el(document, 'button', { type: 'button', class: 'find-btn', 'aria-label': 'Next match', title: 'Next match (Enter)' }, '↓');
  const caseBtn = el(document, 'button', { type: 'button', class: 'find-btn find-case', 'aria-pressed': 'false', title: 'Match case' }, 'Aa');
  const closeBtn = el(document, 'button', { type: 'button', class: 'find-btn', 'aria-label': 'Close find', title: 'Close (Esc)' }, '✕');
  root.replaceChildren(input, count, prev, next, caseBtn, closeBtn);
  root.hidden = true;

  let open = false;
  let matchCase = false;
  let ranges = []; // Range per match
  let starts = []; // text offset of each match start
  let capped = false;
  let current = -1;
  let timer = null;

  const canHighlight = () => !!(win.CSS && win.CSS.highlights && win.Highlight);

  // All matches in `folio-find`; the current one is painted over them.
  function setHighlights() {
    if (!canHighlight()) return;
    const h = win.CSS.highlights;
    if (!ranges.length) {
      h.delete('folio-find');
      h.delete('folio-find-current');
      return;
    }
    h.set('folio-find', new win.Highlight(...ranges));
    setCurrentHighlight();
  }

  function setCurrentHighlight() {
    if (!canHighlight()) return;
    const h = win.CSS.highlights;
    if (current < 0) {
      h.delete('folio-find-current');
      return;
    }
    const cur = new win.Highlight(ranges[current]);
    cur.priority = 1;
    h.set('folio-find-current', cur);
  }

  function clearHighlights() {
    if (!canHighlight()) return;
    win.CSS.highlights.delete('folio-find');
    win.CSS.highlights.delete('folio-find-current');
  }

  function updateCount() {
    if (!input.value) count.textContent = '';
    else if (!ranges.length) count.textContent = 'No results';
    else count.textContent = `${current + 1} of ${ranges.length}${capped ? '+' : ''}`;
    root.classList.toggle('find-none', !!input.value && !ranges.length);
  }

  // Text nodes in order -> one string, plus where each node starts in it.
  function collect(docEl) {
    const info = new Map(); // element -> { hidden, block }
    const infoOf = (e) => {
      let i = info.get(e);
      if (i) return i;
      const display = win.getComputedStyle(e).display;
      const parent = e === docEl ? null : e.parentElement;
      const pi = parent ? infoOf(parent) : null;
      const hidden = display === 'none' || !!(pi && pi.hidden);
      const ws = win.getComputedStyle(e).whiteSpace;
      const collapse = !/^(pre|break-spaces)/.test(ws) && ws !== 'pre-line';
      const inline = display.startsWith('inline') || display === 'contents' || display === '';
      i = { hidden, collapse, block: inline && pi ? pi.block : e };
      info.set(e, i);
      return i;
    };
    const segs = [];
    let text = '';
    let lastBlock = null;
    const walker = document.createTreeWalker(docEl, 4 /* SHOW_TEXT */);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.parentElement) continue;
      const i = infoOf(n.parentElement);
      if (i.hidden) continue;
      if (lastBlock && i.block !== lastBlock) text += '\n';
      lastBlock = i.block;
      segs.push({ node: n, start: text.length });
      // Soft line breaks and tabs show as one space: same length, same offsets.
      text += i.collapse ? n.nodeValue.replace(/[\n\r\t]/g, ' ') : n.nodeValue;
    }
    return { text, segs, folded: null };
  }

  // The searchable text of the current render; rebuilt only after a refresh
  // or open, not on every keystroke in the query box.
  let cache = null;
  function snapshot(docEl) {
    if (!cache || cache.docEl !== docEl) cache = { docEl, ...collect(docEl) };
    return cache;
  }

  // Position `offset` of the joined text -> { node, offset }; `end` picks the
  // segment that ends at the offset instead of the one that starts there.
  function locate(segs, offset, end) {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= offset) lo = mid;
      else hi = mid - 1;
    }
    const s = segs[lo];
    return { node: s.node, offset: offset - s.start + (end ? 1 : 0) };
  }

  // Re-run the query. `wanted`: index to land on, or null to keep the place
  // (first match at/after the previous current match). `scroll`: reveal it.
  function search(wanted, scroll) {
    clearTimeout(timer);
    timer = null;
    const prevStart = current >= 0 ? starts[current] : 0;
    ranges = [];
    starts = [];
    capped = false;
    current = -1;
    const docEl = getDocEl();
    const query = input.value;
    if (docEl && query) {
      const snap = snapshot(docEl);
      const { text, segs } = snap;
      if (!matchCase && snap.folded == null) snap.folded = fold(text);
      const found = findInText(text, query, matchCase, FIND_LIMIT, matchCase ? undefined : snap.folded);
      capped = found.length >= FIND_LIMIT;
      for (const m of found) {
        const a = locate(segs, m.start, false);
        const b = locate(segs, m.end - 1, true);
        const r = document.createRange();
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
        ranges.push(r);
        starts.push(m.start);
      }
      if (ranges.length) {
        if (wanted != null) current = wanted >= 0 && wanted < ranges.length ? wanted : 0;
        else {
          const at = starts.findIndex((s) => s >= prevStart);
          current = at < 0 ? 0 : at;
        }
      }
    }
    setHighlights();
    updateCount();
    if (scroll) reveal();
  }

  function scroller() {
    for (let e = getDocEl()?.parentElement; e; e = e.parentElement) {
      const o = win.getComputedStyle(e).overflowY;
      if (o === 'auto' || o === 'scroll') return e;
    }
    return null;
  }

  function reveal() {
    const r = ranges[current];
    const sc = scroller();
    if (!r || !sc || !r.getBoundingClientRect) return;
    const rect = r.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const box = sc.getBoundingClientRect();
    const delta = rect.top + rect.height / 2 - (box.top + box.height / 2);
    sc.scrollTop += delta;
  }

  function step(dir) {
    if (timer) search(null, false);
    if (!ranges.length) return;
    current = (current + dir + ranges.length) % ranges.length;
    setCurrentHighlight();
    updateCount();
    reveal();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(null, true), 100);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if ((e.key === 'Enter' && e.target === input) || e.key === 'F3') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    }
  });
  prev.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));
  caseBtn.addEventListener('click', () => {
    matchCase = !matchCase;
    caseBtn.setAttribute('aria-pressed', String(matchCase));
    search(null, true);
    input.focus();
  });
  closeBtn.addEventListener('click', () => close());

  // Show the bar. `query` (when given) replaces the text; `nth` (0-based)
  // picks the match to land on.
  function show(query, nth) {
    open = true;
    root.hidden = false;
    if (query !== undefined) input.value = query;
    input.focus();
    input.select();
    cache = null;
    search(nth ?? null, true);
  }

  function close() {
    if (!open) return;
    open = false;
    clearTimeout(timer);
    timer = null;
    const hadFocus = root.contains(document.activeElement);
    root.hidden = true;
    ranges = [];
    starts = [];
    current = -1;
    cache = null;
    clearHighlights();
    if (hadFocus) scroller()?.focus({ preventScroll: true });
  }

  // The document was re-rendered: find the matches again (no scrolling).
  function refresh() {
    cache = null;
    if (open) search(null, false);
  }

  return { open: show, close, refresh, step, isOpen: () => open };
}
