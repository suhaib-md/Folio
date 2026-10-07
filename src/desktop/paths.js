// Path helpers for document-relative links and images. Pure, no DOM.
//
// Paths come from the OS: Windows ("C:\a\b.md") or POSIX ("/a/b.md", used by
// the browser fake). A path is "Windows-style" if it has a backslash or a
// drive letter; resolved paths keep the document's separator style.

const isWindowsPath = (p) => /\\/.test(p) || /^[A-Za-z]:/.test(p);

export function basename(p) {
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
}

export function dirname(p) {
  const s = String(p);
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (i < 0) return '';
  if (i === 0) return s[0];
  return s.slice(0, i);
}

export function isMarkdownPath(p) {
  return /\.(md|markdown)$/i.test(String(p));
}

// Resolve a link/image href against the document at docPath.
// Returns null when there is nothing on disk to resolve:
//  - no document path (untitled tab) or empty href
//  - anchors ("#h") and anything with a scheme (http:, mailto:, data:, file:,
//    and also "C:..." — absolute Windows hrefs are not followed)
//  - protocol-relative / UNC hrefs ("//host", "\\host")
//  - a leading "/" when the document is Windows-style (root is ambiguous)
// "?query" and "#hash" are dropped; %-escapes are decoded.
export function resolveRelative(docPath, href) {
  if (!docPath || !href) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  if (/^[\\/]{2}/.test(href)) return null;
  let rel = href.split(/[?#]/)[0];
  if (!rel) return null;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    // Malformed escapes: use the text as written.
  }

  const win = isWindowsPath(docPath);
  const sep = win ? '\\' : '/';
  let parts;
  if (/^[\\/]/.test(rel)) {
    if (win) return null;
    parts = [''];
  } else {
    // Drop empty segments after the root: dirname("/a.md") is "/", which
    // would otherwise split to ['', ''] and resolve to "//b.md".
    parts = dirname(docPath).split(/[\\/]/).filter((seg, i) => i === 0 || seg !== '');
  }
  // parts[0] is the root ('' for POSIX "/", "C:" for Windows) and is never popped.
  for (const seg of rel.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 1) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  if (parts.length === 1 && parts[0] === '') return sep;
  return parts.join(sep);
}
