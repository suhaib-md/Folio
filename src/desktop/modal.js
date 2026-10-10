// In-app "Save changes?" modal. One modal at a time: a second request waits
// until the first is answered.
//
// confirmSave(name) -> Promise<'save' | 'discard' | 'cancel'>
// Layout: "Don't save" as a danger text button on the left; Cancel and Save
// (with its Ctrl S hint) on the right.
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
  return enqueueShow({
    title: `Save changes to ${name}?`,
    body: 'Your edits will be lost if you close without saving.',
    buttons: SAVE_BUTTONS,
  });
}

// confirmAction({ title, confirmLabel, cancelLabel }) -> Promise<boolean>
// A two-button question (the confirm button focused; Esc = cancel), e.g. the
// sidebar's "Move <name> to the Recycle Bin?" with Cancel / Delete.
export function confirmAction({ title, body = '', confirmLabel, cancelLabel = 'Cancel' }) {
  return enqueueShow({
    title,
    body,
    buttons: [
      { value: 'cancel', label: cancelLabel },
      { value: 'confirm', label: confirmLabel, primary: true },
    ],
  }).then((v) => v === 'confirm');
}

function enqueueShow(spec) {
  const result = queue.then(() => show(spec));
  queue = result.catch(() => {});
  return result;
}

// In screen order; `left` ones sit before the spacer. The primary one has
// focus first.
const SAVE_BUTTONS = [
  { value: 'discard', label: 'Don’t save', text: true, left: true },
  { value: 'cancel', label: 'Cancel' },
  { value: 'save', label: 'Save', primary: true, kbd: 'Ctrl S' },
];

function show({ title: titleText, body: bodyText = '', buttons: BUTTONS }) {
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
    title.textContent = titleText;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const buttons = BUTTONS.map(({ value, label, primary, text, kbd }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = primary ? 'btn btn-primary' : text ? 'btn btn-text' : 'btn';
      b.textContent = label;
      if (kbd) {
        const k = document.createElement('span');
        k.className = 'kbd';
        k.setAttribute('aria-hidden', 'true');
        k.textContent = kbd;
        b.append(k);
      }
      b.dataset.value = value;
      b.addEventListener('click', () => done(value));
      return b;
    });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const left = BUTTONS.filter((b) => b.left).length;
    actions.append(...buttons.slice(0, left), spacer, ...buttons.slice(left));
    const first = buttons[Math.max(0, BUTTONS.findIndex((b) => b.primary))];
    dialog.append(title);
    if (bodyText) {
      const body = document.createElement('p');
      body.className = 'modal-body';
      body.textContent = bodyText;
      dialog.append(body);
    }
    dialog.append(actions);
    backdrop.append(dialog);

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        done('cancel');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const focused = buttons.includes(document.activeElement) ? document.activeElement : first;
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
          if (backdrop.isConnected && !dialog.contains(document.activeElement)) first.focus();
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
    first.focus();
  });
}
