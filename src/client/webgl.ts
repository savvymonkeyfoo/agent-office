export function hasWebGL() {
  const probe = document.createElement('canvas');
  try {
    return !!(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}
