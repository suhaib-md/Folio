// Pasting an image: where to save it, the Markdown link, and the save flow.
// The pure parts are node-tested; blobToImage() needs a browser.
import { basename, dirname } from './paths.js';

const MAX_TRIES = 50;
const KEEP = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

// Extension to keep for a clipboard image type, or null if it must be
// converted to PNG.
export const imageExtension = (mime) => KEEP[String(mime).toLowerCase()] || null;

const pad = (n, w = 2) => String(n).padStart(w, '0');

// encodeURIComponent plus parentheses, which would end a Markdown link early.
const encodeName = (s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');

// Where pasted image number `n` (1 = no suffix) of the document goes.
// path: <document folder>/images/<name>-YYYYMMDD-HHMMSS[-n].<ext> in the
// document's separator style; link: the same, relative, with "/" and escapes.
export function imageTarget(docPath, date, ext, n = 1) {
  const base = basename(docPath).replace(/\.[^.]*$/, '') || 'image';
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const file = `${base}-${stamp}${n >= 2 ? `-${n}` : ''}.${ext}`;
  const sep = /\\/.test(docPath) || /^[A-Za-z]:/.test(docPath) ? '\\' : '/';
  const dir = dirname(docPath);
  const path = `${dir.endsWith(sep) ? dir : dir + sep}images${sep}${file}`;
  return { path, link: `images/${encodeName(file)}` };
}

const errorText = (err) => (typeof err === 'string' ? err : err?.message || String(err));

// Writes the image (base64) beside the document, trying -2, -3... when the
// name is taken, and resolves to the Markdown to insert. Rejects with the
// backend's error (`write(path, base64)` is backend.writeImage) ("already exists" after 50 tries).
export async function savePastedImage(docPath, base64, ext, date, write) {
  let last;
  for (let n = 1; n <= MAX_TRIES; n++) {
    const t = imageTarget(docPath, date, ext, n);
    try {
      await write(t.path, base64);
      return `![](${t.link})`;
    } catch (err) {
      if (errorText(err) !== 'already exists') throw err;
      last = err;
    }
  }
  throw last;
}

const bufferToBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

// Browser only. Clipboard image -> { base64, ext }: kept as is when it is
// png/jpeg/gif/webp, else redrawn as PNG.
export async function blobToImage(blob) {
  let ext = imageExtension(blob.type);
  let data = blob;
  if (!ext) {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close?.();
    data = await canvas.convertToBlob({ type: 'image/png' });
    ext = 'png';
  }
  return { base64: bufferToBase64(await data.arrayBuffer()), ext };
}
