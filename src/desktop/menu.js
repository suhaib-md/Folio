// Popup menu (the toolbar's ⋯ menu).
//
// openMenu(anchor, items) -> { close() }
// items: ({ label, key?, danger?, checked?, radio?, disabled?, submenu?, onSelect } | 'separator')[]
//   key: a shortcut shown at the right (text only; the app handles the keys);
//   danger: a destructive item (drawn in the danger colour).
//   checked (boolean) makes a menuitemcheckbox with aria-checked (or a
//   menuitemradio when radio: true);
//   submenu (items) makes a menuitem with aria-haspopup="menu".
// Up/Down move (wrapping), Home/End jump, Right opens a submenu, Left closes
// it, Enter/Space activate, Esc closes one level, Tab or a click outside
// closes it all. Focus returns to the anchor. Not modal: the page behind
// stays live, but main.js closes the menu on any app shortcut (closeMenu).
// `{ at: { x, y } }` opens it at that point (a context menu) instead of under
// the anchor, and re-opening on the same anchor then re-opens instead of
// toggling. `{ className }` adds a class to the root menu (e.g. a fixed width).
let active = null;

const enabledItems = (levelEl) =>
  [...levelEl.children].filter((el) => el.matches('[role^=menuitem]:not([aria-disabled=true])'));

export function isMenuOpen() {
  return active !== null;
}

export function closeMenu() {
  if (active) active.close();
}

export function openMenu(anchor, items, { at = null, className = '' } = {}) {
  if (active) {
    const same = active.anchor === anchor;
    active.close();
    if (same && !at) return null; // the anchor toggles
  }
  const d = anchor.ownerDocument;
  const levels = []; // levels[0] is the root menu; { el, owner: item element that opened it }
  let closed = false;

  const itemOf = new WeakMap(); // row element -> its item
  const levelOf = (target) => levels.find((l) => l.el.contains(target));

  function close({ refocus = true } = {}) {
    if (closed) return;
    closed = true;
    active = null;
    d.removeEventListener('pointerdown', onOutside, true);
    d.removeEventListener('focusin', onFocusIn, true);
    d.defaultView.removeEventListener('blur', onBlur);
    d.defaultView.removeEventListener('resize', onResize);
    const hadFocus = levels.some((l) => l.el.contains(d.activeElement)) || d.activeElement === d.body;
    for (const l of levels) l.el.remove();
    levels.length = 0;
    if (!at) anchor.setAttribute('aria-expanded', 'false');
    if (refocus && hadFocus) anchor.focus({ preventScroll: true });
  }

  function closeFrom(index) {
    while (levels.length > index) {
      const l = levels.pop();
      l.owner?.setAttribute('aria-expanded', 'false');
      l.el.remove();
    }
  }

  function place(el, left, top, flipLeft) {
    el.style.left = '0px';
    el.style.top = '0px';
    const r = el.getBoundingClientRect();
    const vw = d.documentElement.clientWidth;
    const vh = d.documentElement.clientHeight;
    let x = left;
    if (x + r.width > vw - 4) x = flipLeft ?? vw - 4 - r.width;
    x = Math.max(4, Math.min(x, vw - 4 - r.width));
    const y = Math.max(4, Math.min(top, vh - 4 - r.height));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function buildLevel(list, owner) {
    const el = d.createElement('div');
    el.className = 'menu';
    // No checkable items: no empty check-mark column either.
    if (!list.some((i) => i !== 'separator' && typeof i.checked === 'boolean')) el.classList.add('menu-plain');
    el.setAttribute('role', 'menu');
    el.addEventListener('keydown', onKey);
    for (const item of list) {
      if (item === 'separator') {
        const sep = d.createElement('div');
        sep.className = 'menu-separator';
        sep.setAttribute('role', 'separator');
        el.append(sep);
        continue;
      }
      const row = d.createElement('div');
      row.className = 'menu-item';
      row.tabIndex = -1;
      itemOf.set(row, item);
      const isCheck = typeof item.checked === 'boolean';
      row.setAttribute('role', isCheck ? (item.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem');
      if (isCheck) row.setAttribute('aria-checked', String(item.checked));
      if (item.disabled) row.setAttribute('aria-disabled', 'true');
      const mark = d.createElement('span');
      mark.className = 'menu-mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = isCheck && item.checked ? '✓' : '';
      const label = d.createElement('span');
      label.className = 'menu-label';
      label.textContent = item.label;
      row.append(mark, label);
      if (item.danger) row.classList.add('danger');
      if (item.key) {
        const key = d.createElement('span');
        key.className = 'menu-key';
        key.setAttribute('aria-hidden', 'true');
        key.textContent = item.key;
        row.append(key);
      }
      if (item.submenu) {
        row.setAttribute('aria-haspopup', 'menu');
        row.setAttribute('aria-expanded', 'false');
        const arrow = d.createElement('span');
        arrow.className = 'menu-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '▸';
        row.append(arrow);
      }
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        activate(row, item);
      });
      row.addEventListener('mouseenter', () => {
        if (item.disabled) return;
        const idx = levels.findIndex((l) => l.el === el);
        closeFrom(idx + 1);
        row.focus({ preventScroll: true });
        if (item.submenu) openSub(row, item, false);
      });
      el.append(row);
    }
    d.body.append(el);
    return el;
  }

  function openSub(row, item, focusFirst) {
    const idx = levels.findIndex((l) => l.el.contains(row));
    closeFrom(idx + 1);
    const el = buildLevel(item.submenu, row);
    levels.push({ el, owner: row });
    row.setAttribute('aria-expanded', 'true');
    const rr = row.getBoundingClientRect();
    place(el, rr.right - 2, rr.top - 4, rr.left - el.getBoundingClientRect().width + 2);
    if (focusFirst) enabledItems(el)[0]?.focus({ preventScroll: true });
  }

  function activate(row, item) {
    if (item.disabled) return;
    if (item.submenu) {
      openSub(row, item, true);
      return;
    }
    close();
    item.onSelect?.();
  }

  function onKey(e) {
    const row = e.target.closest?.('[role^=menuitem]');
    const lvl = levelOf(e.target);
    if (!lvl) return;
    const rows = enabledItems(lvl.el);
    const at = rows.indexOf(row);
    const move = (i) => {
      e.preventDefault();
      rows[(i + rows.length) % rows.length]?.focus({ preventScroll: true });
    };
    switch (e.key) {
      case 'ArrowDown': move(at < 0 ? 0 : at + 1); break;
      case 'ArrowUp': move(at < 0 ? rows.length - 1 : at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(rows.length - 1); break;
      case 'ArrowRight':
        if (row?.getAttribute('aria-haspopup') === 'menu') {
          e.preventDefault();
          activate(row, itemOf.get(row));
        }
        break;
      case 'ArrowLeft':
        if (lvl !== levels[0]) {
          e.preventDefault();
          const owner = lvl.owner;
          closeFrom(levels.indexOf(lvl));
          owner.focus({ preventScroll: true });
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (row) activate(row, itemOf.get(row));
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        if (lvl !== levels[0]) {
          const owner = lvl.owner;
          closeFrom(levels.indexOf(lvl));
          owner.focus({ preventScroll: true });
        } else {
          close();
        }
        break;
      case 'Tab':
        e.preventDefault();
        close();
        break;
      default:
    }
  }

  function onOutside(e) {
    if (levelOf(e.target) || (!at && anchor.contains(e.target))) return;
    close({ refocus: false });
  }
  const onFocusIn = (e) => {
    if (!levelOf(e.target) && (at || !anchor.contains(e.target))) close({ refocus: false });
  };
  const onBlur = () => close({ refocus: false });
  const onResize = () => close();

  const root = buildLevel(items, null);
  if (className) root.classList.add(...className.split(/\s+/).filter(Boolean));
  levels.push({ el: root, owner: null });
  if (!at) anchor.setAttribute('aria-expanded', 'true');
  const ar = anchor.getBoundingClientRect();
  const rw = root.getBoundingClientRect().width;
  if (at) place(root, at.x, at.y);
  else place(root, ar.right - rw, ar.bottom + 4);
  enabledItems(root)[0]?.focus({ preventScroll: true });
  d.addEventListener('pointerdown', onOutside, true);
  d.addEventListener('focusin', onFocusIn, true);
  d.defaultView.addEventListener('blur', onBlur);
  d.defaultView.addEventListener('resize', onResize);
  active = { anchor, close };
  return { close };
}
