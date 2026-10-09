// CodeMirror 6 wrapper. One EditorView, one EditorState per tab id: switching
// tabs swaps states, so each tab keeps its own undo history and selection.
import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, highlightSpecialChars, drawSelection, dropCursor,
  rectangularSelection, crosshairCursor, highlightActiveLine,
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
import { tags as t } from '@lezer/highlight';

// Colours come from the theme variables in src/styles.css, so light and dark
// follow prefers-color-scheme with no editor-side switching.
const mix = (v, pct) => `color-mix(in srgb, var(${v}) ${pct}%, transparent)`;

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'var(--bg)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  // Same readable column as the Read view; Split panes are narrower anyway.
  '.cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '760px',
    margin: '0 auto',
    padding: '32px 16px 96px',
    caretColor: 'var(--fg)',
  },
  '.cm-line': { padding: '0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground': { backgroundColor: mix('--muted', 22) },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection': {
    backgroundColor: mix('--accent', 28),
  },
  '.cm-activeLine': { backgroundColor: mix('--fg', 4) },
  '.cm-selectionMatch': { backgroundColor: mix('--accent', 14) },
  '.cm-searchMatch': {
    backgroundColor: mix('--hl-variable', 25),
    outline: `1px solid ${mix('--hl-variable', 60)}`,
  },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: mix('--accent', 35) },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: mix('--accent', 20), outline: 'none' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--danger-bg)' },
  '.cm-panels': { backgroundColor: 'var(--subtle)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': { padding: '6px 32px 6px 12px', fontSize: '13px' },
  '.cm-panel.cm-search label': { fontSize: '13px' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--muted)', fontSize: '18px', top: '4px', right: '8px',
  },
  '.cm-textfield': {
    font: 'inherit',
    fontSize: '13px',
    padding: '3px 6px',
    color: 'var(--fg)',
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-textfield:focus': { outline: '2px solid var(--accent)', outlineOffset: '-1px' },
  '.cm-button': {
    font: 'inherit',
    fontSize: '13px',
    padding: '3px 10px',
    color: 'var(--fg)',
    backgroundImage: 'none',
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--subtle)' },
  '.cm-tooltip': {
    color: 'var(--fg)',
    backgroundColor: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    color: 'var(--accent-fg)',
    backgroundColor: 'var(--accent)',
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '600', color: 'var(--hl-title)' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--hl-variable)' },
  { tag: t.quote, color: 'var(--muted)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--hl-comment)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  // Fenced code, via the nested language parsers.
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--hl-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.escape], color: 'var(--hl-string)' },
  { tag: [t.number, t.bool, t.atom, t.null, t.unit, t.constant(t.name)], color: 'var(--hl-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--hl-title)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--hl-variable)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--hl-attr)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--hl-tag)' },
  { tag: t.invalid, color: 'var(--danger-fg)' },
]);

// codemirror's basicSetup, minus lineNumbers, foldGutter and
// highlightActiveLineGutter (and lintKeymap: there is no linter).
const setup = [
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

export function createEditor(parent, { onChange }) {
  const states = new Map(); // tab id -> EditorState (tabs not on screen)
  const scrolls = new Map(); // tab id -> scroll snapshot effect
  let current = null; // tab id whose state is in the view
  let pending = null; // { timer, since } while a batched onChange is due

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
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown source', spellcheck: 'false' }),
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged && current != null) changed(u.state.doc);
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

    destroyState(tabId) {
      states.delete(tabId);
      scrolls.delete(tabId);
      if (current === tabId) {
        dropPending();
        current = null;
        view.setState(newState(''));
      }
    },
  };
}
