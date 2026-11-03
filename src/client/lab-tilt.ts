// The Innovation lab's camera tilt: how far the view looks down at the room, set with a slider
// and remembered between visits. 90° would be straight down; the lab starts fairly low, looking
// across the room and up into its timber vault.
// v2: the vaulted roof (#lab) wants a lower view, so everyone starts again from the new home tilt.
const KEY = 'agent-office.lab-tilt-v2';

/** Degrees below horizontal: the slider's range and where a first visit starts. */
export const LAB_TILT = { min: 20, max: 75, home: 28 };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): Store | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

const clampTilt = (deg: number) => Math.min(LAB_TILT.max, Math.max(LAB_TILT.min, deg));

/** The tilt picked last time, or the starting one when nothing (usable) was saved. */
export function savedTilt(storage = browserStorage()) {
  try {
    const saved = Number(storage?.getItem(KEY));
    return storage?.getItem(KEY) != null && Number.isFinite(saved) ? clampTilt(saved) : LAB_TILT.home;
  } catch {
    return LAB_TILT.home;
  }
}

export function saveTilt(deg: number, storage = browserStorage()) {
  try {
    storage?.setItem(KEY, String(Math.round(clampTilt(deg))));
  } catch {
    // Storage blocked: the tilt lasts until reload.
  }
}

/** A slider in `host` for the tilt: moving it calls `onTilt` with degrees below horizontal, and saves it. */
export function bindTiltSlider(host: HTMLElement, onTilt: (deg: number) => void, storage = browserStorage()) {
  host.innerHTML = `
    <label class="tilt-label" for="tilt-range">Tilt</label>
    <input id="tilt-range" type="range" min="${LAB_TILT.min}" max="${LAB_TILT.max}" step="1" value="${savedTilt(storage)}"
      aria-label="Camera tilt, degrees looking down">`;
  const input = host.querySelector<HTMLInputElement>('input')!;
  input.addEventListener('input', () => {
    const deg = clampTilt(Number(input.value));
    saveTilt(deg, storage);
    onTilt(deg);
  });
  return { set: (deg: number) => { input.value = String(Math.round(clampTilt(deg))); } };
}
