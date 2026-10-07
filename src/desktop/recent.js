// Start-screen recent lists: file/folder name with its dimmed parent path.
// Pure with respect to app state: data and a callback in, DOM out.
import { basename, dirname } from './paths.js';

export function renderRecent(container, recent, { onOpen }) {
  const d = container.ownerDocument;
  const sections = [];
  const add = (paths, kind, heading) => {
    if (!paths?.length) return;
    const section = d.createElement('section');
    section.className = `recent-section recent-${kind === 'folder' ? 'folders' : 'files'}`;
    const h = d.createElement('h2');
    h.className = 'recent-heading';
    h.textContent = heading;
    const ul = d.createElement('ul');
    ul.className = 'recent-list';
    for (const path of paths) {
      const li = d.createElement('li');
      const btn = d.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-item';
      btn.title = path;
      btn.dataset.path = path;
      const name = d.createElement('span');
      name.className = 'recent-name';
      name.textContent = basename(path);
      const parent = d.createElement('span');
      parent.className = 'recent-parent';
      parent.textContent = dirname(path);
      btn.append(name, parent);
      btn.addEventListener('click', () => onOpen(path, kind));
      li.append(btn);
      ul.append(li);
    }
    section.append(h, ul);
    sections.push(section);
  };
  add(recent?.files, 'file', 'Recent files');
  add(recent?.folders, 'folder', 'Recent folders');
  container.replaceChildren(...sections);
}
