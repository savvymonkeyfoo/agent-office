const KEY = 'agent-office.layout';

/** The presets on offer, by id, with the name the picker shows. */
const LAYOUTS: [id: string, name: string][] = [['classic', 'Classic'], ['control-room', 'Control room']];

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

/** What a first visit (or unusable storage) gets. */
const DEFAULT_LAYOUT = 'control-room';

/** The layout picked last time, or the default when nothing (usable) was saved. */
export function savedLayout(storage = browserStorage()) {
  try {
    const id = storage?.getItem(KEY);
    return LAYOUTS.some(([known]) => known === id) ? id! : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(storage: Store | undefined, id: string) {
  try {
    storage?.setItem(KEY, id);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

/** Fills `host` with a button per layout, the current one marked; picking one saves it and calls `onPick`. Returns the current id. */
export function bindLayoutPicker(host: HTMLElement, onPick: (id: string) => void, storage = browserStorage()) {
  let current = savedLayout(storage);
  const buttons = LAYOUTS.map(([id, name]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = name;
    button.addEventListener('click', () => {
      if (id === current) return;
      current = id;
      saveLayout(storage, id);
      mark();
      onPick(id);
    });
    return button;
  });
  const mark = () => buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(LAYOUTS[i][0] === current)));
  mark();
  host.replaceChildren(...buttons);
  return current;
}
