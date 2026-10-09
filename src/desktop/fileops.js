// Sidebar file operations, pure parts: name rules and path remapping.
// No DOM, no backend.
import { normalizePath } from './tabs.js';

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// null when `name` is fine as a file or folder name on Windows, else the
// text to show next to the input.
export function validateName(name) {
  const s = String(name ?? '');
  if (!s.trim()) return 'Enter a name.';
  if (/[\\/:*?"<>|]/.test(s)) return 'A name can\u2019t contain \\ / : * ? " < > |';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(s)) return 'A name can\u2019t contain control characters.';
  if (/[. ]$/.test(s)) return 'A name can\u2019t end with a dot or a space.';
  // Windows reserves these with or without an extension ("con.txt").
  const stem = s.split('.')[0].trimEnd();
  if (RESERVED.test(stem)) return `\u201c${stem}\u201d is a reserved name.`;
  return null;
}

// New files get ".md" when the name has no extension ("notes" -> "notes.md",
// "notes.txt" stays; a leading dot alone is not an extension).
export function withMdExtension(name) {
  const s = String(name);
  return s.lastIndexOf('.') > 0 ? s : `${s}.md`;
}

const SEP = /[\\/]+/;
const segments = (p) => normalizePath(p).split('/').filter((s, i) => s !== '' || i === 0);

// `path` after `from` was renamed to `to`: `to` for `from` itself, `to` plus
// the rest for anything inside it, null for any other path. Matches
// case-insensitively and across / and \ (the rest keeps the path's own
// spelling and separator style).
export function remapPath(path, from, to) {
  const nf = segments(from);
  while (nf.length > 1 && nf[nf.length - 1] === '') nf.pop();
  const np = segments(path);
  if (np.length < nf.length) return null;
  for (let i = 0; i < nf.length; i++) if (np[i] !== nf[i]) return null;
  const own = String(path).split(SEP);
  const rest = own.slice(nf.length);
  if (!rest.length) return to;
  while (rest.length && rest[rest.length - 1] === '') rest.pop();
  if (!rest.length) return to;
  const sep = String(path).includes('\\') && !String(path).includes('/') ? '\\' : String(to).includes('\\') ? '\\' : '/';
  return String(to).replace(/[\\/]+$/, '') + sep + rest.join(sep);
}

// `dir` + `name`, in the separator style of `dir`.
export function joinPath(dir, name) {
  const sep = String(dir).includes('\\') && !String(dir).includes('/') ? '\\' : '/';
  return String(dir).replace(/[\\/]+$/, '') + sep + name;
}

// True when `path` is `root` or inside it (case-insensitive, / or \).
export function isInside(root, path) {
  return remapPath(path, root, '/x') !== null;
}
