const KEY = 'agent-office.view';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** Whether the close-up view was chosen last time. */
export function readCloseUp(storage = browserStorage()) {
  try {
    return storage?.getItem(KEY) === 'close';
  } catch {
    return false;
  }
}

/** The button switches between the wide and close-up starting views, remembered where storage allows. */
export function bindViewToggle(button: HTMLElement, close: { on: boolean }, reframe: () => void, storage = browserStorage()) {
  const show = () => {
    button.setAttribute('aria-pressed', String(close.on));
    button.setAttribute('aria-label', close.on ? 'Wide view' : 'Close-up view');
    button.title = close.on ? 'Wide view' : 'Close-up view';
  };
  button.addEventListener('click', () => {
    close.on = !close.on;
    try {
      storage?.setItem(KEY, close.on ? 'close' : 'wide');
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
    show();
    reframe();
  });
  show();
}
