// In-app "Save changes?" modal. One modal at a time: a second request waits
// until the first is answered.
//
// confirmSave(name) -> Promise<'save' | 'discard' | 'cancel'>
// Keyboard: focus starts on Save and is trapped in the dialog; Tab /
// Shift+Tab cycle the buttons; Enter activates the focused button (Save
// unless the user moved focus); Esc = Cancel. Focus returns to where it was.

let hooks = { onOpen() {}, onClose() {} };
let queue = Promise.resolve();
let seq = 0;

// onOpen / onClose run when a modal is shown / dismissed (main.js uses them
// to hold incoming file opens and to block app shortcuts meanwhile).
export function setModalHooks(next) {
  hooks = { ...hooks, ...next };
}

// For other modal dialogs (quick open): announce one opening / closing so
// main.js holds incoming opens and blocks app shortcuts meanwhile.
export function modalOpened() {
  hooks.onOpen();
}
export function modalClosed() {
  hooks.onClose();
}

export function confirmSave(name) {
  const result = queue.then(() => show(name));
  queue = result.catch(() => {});
  return result;
}

const BUTTONS = [
  { value: 'save', label: 'Save', primary: true },
  { value: 'discard', label: "Don't save" },
  { value: 'cancel', label: 'Cancel' },
];

function show(name) {
  return new Promise((resolve) => {
    const id = `modal-title-${++seq}`;
    const previous = document.activeElement;
    const app = document.querySelector('.app');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'modal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', id);

    const title = document.createElement('h2');
    title.className = 'modal-title';
    title.id = id;
    title.textContent = `Save changes to ${name}?`;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const buttons = BUTTONS.map(({ value, label, primary }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn-primary' : 'btn';
      b.textContent = label;
      b.dataset.value = value;
      b.addEventListener('click', () => done(value));
      return b;
    });
    actions.append(...buttons);
    dialog.append(title, actions);
    backdrop.append(dialog);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        done('cancel');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focused = buttons.includes(document.activeElement) ? document.activeElement : buttons[0];
        done(focused.dataset.value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        const i = buttons.indexOf(document.activeElement);
        const n = buttons.length;
        const j = i < 0 ? 0 : (i + (e.shiftKey ? -1 : 1) + n) % n;
        buttons[j].focus();
      }
      // Nothing behind the modal sees its keys.
      e.stopPropagation();
    }

    // Clicks outside the dialog do nothing and must not take focus away.
    function onPointer(e) {
      if (!dialog.contains(e.target)) e.preventDefault();
    }

    // Focus can't leave (e.g. a click on the backdrop): pull it back.
    function onFocusOut(e) {
      if (!e.relatedTarget || !dialog.contains(e.relatedTarget)) {
        queueMicrotask(() => {
          if (backdrop.isConnected && !dialog.contains(document.activeElement)) buttons[0].focus();
        });
      }
    }

    let settled = false;
    function done(value) {
      if (settled) return;
      settled = true;
      backdrop.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (app) app.inert = false;
      if (previous && previous.isConnected && typeof previous.focus === 'function') {
        previous.focus({ preventScroll: true });
      }
      try {
        hooks.onClose();
      } finally {
        resolve(value);
      }
    }

    backdrop.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', onPointer);
    dialog.addEventListener('focusout', onFocusOut);
    hooks.onOpen();
    if (app) app.inert = true;
    document.body.append(backdrop);
    buttons[0].focus();
  });
}
