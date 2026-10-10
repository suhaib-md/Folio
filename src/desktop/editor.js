// CodeMirror 6 wrapper. One EditorView, one EditorState per tab id: switching
// tabs swaps states, so each tab keeps its own undo history and selection.
import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine, lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view';
import {
  indentOnInput, syntaxHighlighting, bracketMatching, foldKeymap, HighlightStyle,
} from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap, openSearchPanel } from '@codemirror/search';
import {
  closeBrackets, autocompletion, closeBracketsKeymap, completionKeymap,
} from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { tags as t, Tag, styleTags } from '@lezer/highlight';
import { toggleWrap, insertLink, cycleHeading, toggleTask } from './format.js';

// Colours come from the theme variables (src/styles.css, plus the forced
// themes in app.css), so light, dark and the manual theme need no
// editor-side switching; font size scales with --doc-zoom.
const mix = (v, pct) => `color-mix(in srgb, var(${v}) ${pct}%, transparent)`;

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--paper)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    fontSize: 'calc(14px * var(--doc-zoom, 1))',
    lineHeight: '1.75',
  },
  '.cm-content': {
    boxSizing: 'border-box',
    padding: '28px 24px 80px 0',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0' },
  '.cm-gutters': {
    width: '56px',
    border: '0',
    backgroundColor: 'transparent',
    color: 'var(--ink-3)',
  },
  '.cm-gutter.cm-lineNumbers': { width: '56px' },
  '.cm-lineNumbers .cm-gutterElement': {
    boxSizing: 'border-box',
    padding: '0 20px 0 0',
    fontSize: 'calc(12px * var(--doc-zoom, 1))',
    textAlign: 'right',
  },
  '.cm-activeLineGutter': { backgroundColor: 'var(--caretline)', color: 'var(--ink-2)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '.cm-selectionBackground': { backgroundColor: mix('--ink-3', 22) },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection': {
    backgroundColor: mix('--accent', 24),
  },
  '.cm-activeLine': { backgroundColor: 'var(--caretline)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-searchMatch': { backgroundColor: 'var(--find)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--find-cur)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
  '&.cm-focused .cm-nonmatchingBracket': { color: 'var(--danger)', backgroundColor: 'transparent' },
  '.cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-panel.cm-search': { padding: '8px 36px 8px 12px', fontFamily: 'var(--font-ui)', fontSize: '13px' },
  '.cm-panel.cm-search label': { fontSize: '12px', color: 'var(--ink-2)' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--ink-3)', fontSize: '18px', top: '6px', right: '10px',
  },
  '.cm-textfield': {
    font: 'inherit',
    fontSize: '13px',
    height: '28px',
    padding: '0 8px',
    color: 'var(--ink)',
    backgroundColor: 'var(--paper)',
    border: '1px solid var(--line)',
    borderRadius: '7px',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' },
  '.cm-button': {
    font: 'inherit',
    fontSize: '12px',
    fontWeight: '500',
    height: '28px',
    padding: '0 10px',
    color: 'var(--ink)',
    backgroundImage: 'none',
    backgroundColor: 'var(--paper)',
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
  },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--hover)' },
  '.cm-tooltip': {
    color: 'var(--ink)',
    backgroundColor: 'var(--raised)',
    border: '1px solid var(--line)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color: 'var(--ink)',
    backgroundColor: 'var(--accent-soft)',
  },
});

// Markdown marks get their own tags (the base language files every mark
// under processingInstruction): fences stay quiet, table rows dim.
const codeMark = Tag.define();
const tableText = Tag.define();
const markdownTags = {
  props: [styleTags({ CodeMark: codeMark, 'Table/...': tableText, 'TableDelimiter': tableText })],
};

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '600', color: 'var(--ink)' },
  // Heading marks, list and task markers, quote marks, link brackets.
  { tag: t.processingInstruction, color: 'var(--accent-text)', fontWeight: '500' },
  { tag: codeMark, color: 'var(--ink-3)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent-text)' },
  { tag: t.url, color: 'var(--accent-text)' },
  { tag: t.monospace, color: 'var(--hl-str)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: tableText, color: 'var(--ink-2)' },
  { tag: [t.contentSeparator, t.meta], color: 'var(--ink-3)' },
  { tag: t.comment, color: 'var(--hl-com)' },
  // Fenced code, via the nested language parsers.
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--hl-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: 'var(--hl-str)' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit, t.constant(t.name)], color: 'var(--hl-fn)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--hl-fn)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--hl-fn)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-fn)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--accent-text)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

// Ctrl+B / Ctrl+I / Ctrl+K: one transaction each, so one undo step.
function formatCommand(fn) {
  return (view) => {
    const { state } = view;
    const r = fn(state.doc.toString(), state.selection.ranges.map((x) => ({ from: x.from, to: x.to })));
    view.dispatch({
      changes: r.changes,
      selection: EditorSelection.create(
        r.ranges.map((x) => EditorSelection.range(x.from, x.to)),
        state.selection.mainIndex,
      ),
      userEvent: 'input.format',
      scrollIntoView: true,
    });
    return true;
  };
}

// The doc header's format buttons, by name (also the palette's commands).
const FORMATS = {
  heading: formatCommand(cycleHeading),
  bold: formatCommand((d, r) => toggleWrap(d, r, '**')),
  italic: formatCommand((d, r) => toggleWrap(d, r, '*')),
  link: formatCommand(insertLink),
  code: formatCommand((d, r) => toggleWrap(d, r, '`')),
  task: formatCommand(toggleTask),
};

const formatKeymap = Prec.highest(keymap.of([
  { key: 'Mod-b', run: FORMATS.bold, preventDefault: true },
  { key: 'Mod-i', run: FORMATS.italic, preventDefault: true },
  { key: 'Mod-k', run: FORMATS.link, preventDefault: true },
]));

// codemirror's basicSetup, minus foldGutter (and lintKeymap: there is no
// linter).
const setup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(highlight),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  formatKeymap,
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
  ]),
];

// Turning the document into a string costs ~1 ms per 100 KB, so for big
// documents onChange is batched: it runs once typing pauses (or at least every
// MAX_WAIT ms) instead of on every keystroke. flush() delivers it right away.
const LAZY_LENGTH = 256 * 1024;
const PAUSE = 250;
const MAX_WAIT = 1000;

// A paste that carries an image and no text (a screenshot) goes to
// onPasteImage(blob) -> Promise<markdown|null>; the markdown replaces the main
// selection, unless the user has switched tabs meanwhile. Pasting text (also
// text together with an image, as copying from a web page gives) is untouched.
export function createEditor(parent, { onChange, onCursor = () => {}, onPasteImage = null }) {
  const states = new Map(); // tab id -> EditorState (tabs not on screen)
  const scrolls = new Map(); // tab id -> scroll snapshot effect
  let current = null; // tab id whose state is in the view
  let pending = null; // { timer, since } while a batched onChange is due
  let cursorAt = 0; // line the cursor was last seen on (0: unknown)
  let colAt = 0; // its 1-based column
  let cursorFrame = 0; // requestAnimationFrame id while an onCursor is due

  function flush() {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
    if (current != null) onChange(view.state.doc.toString());
  }

  function changed(doc) {
    if (doc.length <= LAZY_LENGTH && !pending) {
      onChange(doc.toString());
      return;
    }
    const since = pending ? pending.since : Date.now();
    if (pending) clearTimeout(pending.timer);
    const wait = Math.max(0, Math.min(PAUSE, since + MAX_WAIT - Date.now()));
    pending = { since, timer: setTimeout(flush, wait) };
  }

  function dropPending() {
    if (pending) clearTimeout(pending.timer);
    pending = null;
  }

  const extensions = [
    setup,
    // GFM (tables, task lists, strikethrough) like the renderer. Fenced code
    // languages load on demand (dynamic import -> separate bundle chunks).
    markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [markdownTags] }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'false' }),
    theme,
    EditorView.domEventHandlers({
      paste(event, v) {
        if (!onPasteImage) return false;
        const items = [...(event.clipboardData?.items || [])];
        if (items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return false;
        const item = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
        const blob = item?.getAsFile();
        if (!blob) return false;
        event.preventDefault();
        const tabId = current;
        Promise.resolve(onPasteImage(blob)).then((md) => {
          if (!md || current !== tabId) return;
          const { from, to } = v.state.selection.main;
          v.dispatch({
            changes: { from, to, insert: md },
            selection: { anchor: from + md.length },
            userEvent: 'input.paste',
            scrollIntoView: true,
          });
        });
        return true;
      },
    }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged && current != null) changed(u.state.doc);
      if ((u.selectionSet || u.docChanged) && current != null) {
        const head = u.state.selection.main.head;
        const l = u.state.doc.lineAt(head);
        const col = head - l.from + 1;
        if (l.number !== cursorAt || col !== colAt) {
          cursorAt = l.number;
          colAt = col;
          // One call per animation frame, with the position it ended on.
          if (!cursorFrame) {
            cursorFrame = requestAnimationFrame(() => {
              cursorFrame = 0;
              if (current != null) onCursor(cursorAt, colAt);
            });
          }
        }
      }
    }),
  ];
  const newState = (text) => EditorState.create({ doc: text, extensions });

  const view = new EditorView({ parent, state: newState('') });

  const sameDoc = (state, text) => state.doc.length === text.length && state.doc.toString() === text;

  // Typed text is never dropped: a pending batch is delivered (for the tab
  // being parked) before its state leaves the view.
  function park() {
    if (current == null) return;
    flush();
    states.set(current, view.state);
    scrolls.set(current, view.scrollSnapshot());
  }

  return {
    // Puts tab `tabId` in the view. A cached state is reused (keeping undo)
    // unless its text differs from `text`, i.e. the file changed underneath.
    show(tabId, text) {
      if (tabId === current) {
        // Unreported typing wins: deliver it, and keep the doc (`text` was
        // read before it). The app's render flushes on entry, so normally
        // nothing is pending here.
        if (pending) {
          flush();
          return;
        }
        if (!sameDoc(view.state, text)) {
          // Replaced underneath (a reload from disk): keep the same line at
          // the top (pixel offsets don't survive the new height estimates).
          const top = view.lineBlockAtHeight(view.scrollDOM.scrollTop - view.documentPadding.top);
          const line = view.state.doc.lineAt(top.from).number;
          view.setState(newState(text));
          const doc = view.state.doc;
          if (line > 1) {
            view.dispatch({
              effects: EditorView.scrollIntoView(doc.line(Math.min(line, doc.lines)).from, { y: 'start' }),
            });
          }
        }
        return;
      }
      park();
      current = tabId;
      cursorAt = 0;
      colAt = 0;
      const cached = states.get(tabId);
      const fresh = !cached || !sameDoc(cached, text);
      view.setState(fresh ? newState(text) : cached);
      states.delete(tabId);
      const snap = scrolls.get(tabId);
      if (snap && !fresh) view.dispatch({ effects: snap });
      else view.scrollDOM.scrollTop = 0;
    },

    // Call before the editor is hidden: remembers the scroll position (a
    // hidden element loses it) and detaches the current tab.
    hide() {
      park();
      current = null;
    },

    // Delivers a batched onChange now. Call before reading or replacing the
    // tab's text, or before switching tabs.
    flush,
    getText: () => view.state.doc.toString(),
    focus: () => view.focus(),
    openSearch: () => openSearchPanel(view),

    // 1-based line of the cursor.
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,

    // 1-based line and column of the cursor.
    cursorPos() {
      const head = view.state.selection.main.head;
      const l = view.state.doc.lineAt(head);
      return { line: l.number, col: head - l.from + 1 };
    },

    // Applies a doc header format (heading, bold, italic, link, code, task)
    // and gives the editor focus back.
    format(name) {
      const run = FORMATS[name];
      if (!run || current == null) return false;
      run(view);
      view.focus();
      return true;
    },

    // Cursor to the start of `line` (clamped), scrolled to the top of the
    // editor. Does not take focus.
    revealLine(line) {
      const doc = view.state.doc;
      const pos = doc.line(Math.min(Math.max(1, Math.floor(line) || 1), doc.lines)).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 8 }),
      });
    },

    // Selects characters [start, end) of `line` (offsets within that line,
    // clamped) and scrolls them into view. Does not take focus.
    selectRange(line, start, end) {
      const doc = view.state.doc;
      const l = doc.line(Math.min(Math.max(1, Math.floor(line) || 1), doc.lines));
      const at = (n) => l.from + Math.min(Math.max(0, n), l.length);
      const from = at(start);
      const to = Math.max(from, at(end));
      view.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      });
    },

    destroyState(tabId) {
      states.delete(tabId);
      scrolls.delete(tabId);
      if (current === tabId) {
        dropPending();
        cursorAt = 0;
        current = null;
        view.setState(newState(''));
      }
    },
  };
}
