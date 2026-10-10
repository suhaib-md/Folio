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

// Does `text` hold a marker run of its own (a "**" for bold, an odd run of
// "*" for italic)? Then markers around it may belong to different spans.
function hasOwnMarker(text, marker) {
  if (marker !== '*') return text.includes(marker);
  return (text.match(/\*+/g) || []).some((run) => run.length % 2 === 1);
}

// Are the markers just inside the range ("**x**" selected) one `marker` pair?
// Italic must not mistake the halves of "**": it needs an odd run of stars.
function insideMarked(text, marker) {
  const m = marker.length;
  if (text.length <= 2 * m || !text.startsWith(marker) || !text.endsWith(marker)) return false;
  if (hasOwnMarker(text.slice(m, text.length - m), marker)) return false;
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
  if (hasOwnMarker(doc.slice(from, to), marker)) return false;
  if (marker !== '*') return true;
  return runBefore(doc, from) % 2 === 1 && runAfter(doc, to) % 2 === 1;
}

export function toggleWrap(doc, ranges, marker) {
  const m = marker.length;
  const changes = [];
  const out = [];
  let delta = 0; // net length change of everything before the current range
  let lastEnd = 0; // end of the previous edit, original coordinates
  for (let i = 0; i < ranges.length; i++) {
    const { from, to } = ranges[i];
    const next = ranges[i + 1];
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
    } else if (from - m >= lastEnd && (!next || to + m <= next.from) && outsideMarked(doc, from, to, marker)) {
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

// ---- line commands (the doc header's H and Task buttons) ----------------

// Start offsets of the lines the ranges touch (each line once, ascending). A
// selection ending at the very start of a line does not touch that line.
function touchedLines(doc, ranges) {
  const starts = new Set();
  for (const { from, to } of ranges) {
    let at = doc.lastIndexOf('\n', from - 1) + 1;
    for (;;) {
      starts.add(at);
      const nl = doc.indexOf('\n', at);
      if (nl < 0 || nl + 1 >= to) break;
      at = nl + 1;
    }
  }
  return [...starts].sort((a, b) => a - b);
}

const lineAt = (doc, start) => {
  const nl = doc.indexOf('\n', start);
  return doc.slice(start, nl < 0 ? doc.length : nl);
};

// A position moved by `changes` (ascending, non-overlapping). Text inserted
// exactly at the position goes before it; a position inside a replaced span
// moves to the end of the replacement.
function mapPos(pos, changes) {
  let delta = 0;
  for (const c of changes) {
    if (c.from > pos) break;
    if (c.to <= pos) {
      if (c.from === pos && c.to === pos) {
        delta += c.insert.length;
        continue;
      }
      delta += c.insert.length - (c.to - c.from);
    } else {
      // pos is inside a replaced span: move it to the end of the insert
      return c.from + delta + c.insert.length;
    }
  }
  return pos + delta;
}

function lineEdit(doc, ranges, edit) {
  const changes = [];
  for (const start of touchedLines(doc, ranges)) {
    const c = edit(lineAt(doc, start));
    if (c) changes.push({ from: start + c.from, to: start + c.to, insert: c.insert });
  }
  return {
    changes,
    ranges: ranges.map(({ from, to }) => ({ from: mapPos(from, changes), to: mapPos(to, changes) })),
  };
}

const HEADING = /^( {0,3})(#{1,6})(?:[ \t]+|$)/;

// Heading level: none -> # -> ## ... ###### -> none, for every touched line
// (all of them follow the first line's level).
export function cycleHeading(doc, ranges) {
  const lines = touchedLines(doc, ranges);
  const m = lines.length ? HEADING.exec(lineAt(doc, lines[0])) : null;
  const level = m ? m[2].length : 0;
  const next = level >= 6 ? 0 : level + 1;
  return lineEdit(doc, ranges, (text) => {
    const h = HEADING.exec(text);
    const insert = next ? `${'#'.repeat(next)} ` : '';
    if (h) return { from: h[1].length, to: h[0].length, insert };
    return next ? { from: 0, to: 0, insert } : null;
  });
}

const TASK = /^(\s*)([-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]+/;
const BULLET = /^(\s*)([-*+]|\d+[.)])[ \t]+/;

// Task list item: every touched line becomes "- [ ] ..." (a list item gains
// the box), or, when all of them are tasks already, plain text again.
export function toggleTask(doc, ranges) {
  const lines = touchedLines(doc, ranges).map((s) => lineAt(doc, s));
  const allTasks = lines.some((t) => TASK.test(t)) && lines.every((t) => TASK.test(t) || !t.trim());
  return lineEdit(doc, ranges, (text) => {
    if (allTasks) {
      const t = TASK.exec(text);
      return t ? { from: t[1].length, to: t[0].length, insert: '' } : null;
    }
    if (TASK.test(text)) return null;
    if (!text.trim()) return lines.length === 1 ? { from: text.length, to: text.length, insert: '- [ ] ' } : null;
    const b = BULLET.exec(text);
    if (b) return { from: b[0].length, to: b[0].length, insert: '[ ] ' };
    const indent = /^\s*/.exec(text)[0].length;
    return { from: indent, to: indent, insert: '- [ ] ' };
  });
}
