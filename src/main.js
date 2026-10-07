import { createRenderer } from './render.js';

const renderMarkdown = createRenderer(window);
const $ = (id) => document.getElementById(id);
const bar = $('bar');
const filename = $('filename');
const empty = $('empty');
const errorBox = $('error');
const doc = $('doc');
const drop = $('drop');
const picker = $('picker');

async function readFile(file) {
  return file.text();
}

function showDocument(name, html) {
  doc.innerHTML = html;
  filename.textContent = name;
  document.title = name;
  bar.hidden = false;
  empty.hidden = true;
  errorBox.hidden = true;
  window.scrollTo(0, 0);
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

async function openFile(file) {
  if (!file) return;
  try {
    const text = await readFile(file);
    if (text.includes('\u0000')) throw new Error('binary');
    showDocument(file.name, renderMarkdown(text));
  } catch (err) {
    console.error(err);
    showError(`Couldn't read ${file.name}. Is it a text/Markdown file?`);
  }
}

// Open button, Ctrl+O and the file picker
const choose = () => picker.click();
$('open-empty').addEventListener('click', choose);
$('open-bar').addEventListener('click', choose);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    choose();
  }
});
picker.addEventListener('change', () => {
  openFile(picker.files[0]);
  picker.value = '';
});

// Drag and drop anywhere in the window. Only file drags show the overlay.
let dragDepth = 0;
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth++;
  drop.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) drop.hidden = true;
});
// Always cancel the default: browsers navigate the tab to a dropped link,
// which would replace the viewer and lose the open document.
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (!isFileDrag(e) && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.hidden = true;
  openFile(e.dataTransfer?.files?.[0]);
});

// Heading ids are prefixed "user-content-" by the sanitiser; resolve #links.
doc.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  const hash = decodeURIComponent(link.getAttribute('href').slice(1));
  const target = document.getElementById(`user-content-${hash}`) || document.getElementById(hash);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
