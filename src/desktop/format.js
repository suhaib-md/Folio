// Pure Markdown formatting helpers for the editor shortcuts. They work on the
// document string and {from,to} ranges (UTF-16 offsets, ascending and not
// overlapping, as CodeMirror keeps them) and return
//   { changes: [{from,to,insert}] (original-document coordinates),
//     ranges:  [{from,to}]        (selection in the changed document) }.

const runBefore = (doc, i) => {
  let n = 0;
  while (i - n > 0 && doc[i - n - 1] === '*') n++;
  return n;
};
const runAfter = (doc, i) => {
  let n = 0;
  while (doc[i + n] === '*') n++;
  return n;
};

// Are the markers just inside the range ("**x**" selected) a `marker` pair?
// Italic must not mistake the halves of "**": it needs an odd run of stars.
function insideMarked(text, marker) {
  const m = marker.length;
  if (text.length <= 2 * m || !text.startsWith(marker) || !text.endsWith(marker)) return false;
  if (marker !== '*') return true;
  const lead = runAfter(text, 0);
  const trail = text.length - text.replace(/\*+$/, '').length;
  return lead < text.length && lead % 2 === 1 && trail % 2 === 1;
}

// ... just outside the range?
function outsideMarked(doc, from, to, marker) {
  const m = marker.length;
  if (from < m || doc.slice(from - m, from) !== marker || doc.slice(to, to + m) !== marker) {
    return false;
  }
  if (marker !== '*') return true;
  return runBefore(doc, from) % 2 === 1 && runAfter(doc, to) % 2 === 1;
}

export function toggleWrap(doc, ranges, marker) {
  const m = marker.length;
  const changes = [];
  const out = [];
  let delta = 0; // net length change of everything before the current range
  let lastEnd = 0; // end of the previous edit, original coordinates
  for (const { from, to } of ranges) {
    if (from === to) {
      changes.push({ from, to, insert: marker + marker });
      out.push({ from: from + delta + m, to: from + delta + m });
      delta += 2 * m;
      lastEnd = to;
    } else if (insideMarked(doc.slice(from, to), marker)) {
      changes.push({ from, to: from + m, insert: '' }, { from: to - m, to, insert: '' });
      out.push({ from: from + delta, to: to + delta - 2 * m });
      delta -= 2 * m;
      lastEnd = to;
    } else if (from - m >= lastEnd && outsideMarked(doc, from, to, marker)) {
      changes.push({ from: from - m, to: from, insert: '' }, { from: to, to: to + m, insert: '' });
      out.push({ from: from - m + delta, to: to - m + delta });
      delta -= 2 * m;
      lastEnd = to + m;
    } else {
      changes.push({ from, to: from, insert: marker }, { from: to, to, insert: marker });
      out.push({ from: from + delta + m, to: to + delta + m });
      delta += 2 * m;
      lastEnd = to;
    }
  }
  return { changes, ranges: out };
}

export function insertLink(doc, ranges) {
  const tail = '](url)';
  const changes = [];
  const out = [];
  let delta = 0;
  for (const { from, to } of ranges) {
    changes.push({ from, to: from, insert: '[' }, { from: to, to, insert: tail });
    if (from === to) {
      out.push({ from: from + delta + 1, to: from + delta + 1 });
    } else {
      const url = to + delta + 3; // after "[" + selection + "]("
      out.push({ from: url, to: url + 3 });
    }
    delta += 1 + tail.length;
  }
  return { changes, ranges: out };
}
