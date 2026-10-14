import * as THREE from 'three';

const KEY = 'agent-office.background';
const PLAIN = new THREE.Color('#2B2545');

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

function readPlain(storage?: Store) {
  try {
    return storage?.getItem(KEY) === 'plain';
  } catch {
    return false;
  }
}

function savePlain(storage: Store | undefined, plain: boolean) {
  try {
    storage?.setItem(KEY, plain ? 'plain' : 'sky');
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}

/** The button swaps the scene between the living sky and the old plain colour, remembered where storage allows. */
export function bindBackgroundToggle(button: HTMLElement, scene: THREE.Scene, sky: THREE.Texture, storage = browserStorage()) {
  let plain = readPlain(storage);
  const show = () => {
    scene.background = plain ? PLAIN : sky;
    button.setAttribute('aria-pressed', String(plain));
  };
  button.addEventListener('click', () => {
    plain = !plain;
    savePlain(storage, plain);
    show();
  });
  show();
}
