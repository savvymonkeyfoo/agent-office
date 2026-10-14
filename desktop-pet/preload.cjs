// The page's side of the Electron pet (main.cjs): the same bridge the Mac app gives it, plus the mouse,
// which the window itself handles there (drag to move, click to open, right-click for the menu).
const { contextBridge, ipcRenderer } = require('electron');

const send = (message) => ipcRenderer.send('pet', message);
contextBridge.exposeInMainWorld('petNative', { postMessage: send });

window.addEventListener('mousedown', (event) => { if (event.button === 0) send({ type: 'down' }); });
window.addEventListener('mouseup', (event) => { if (event.button === 0) send({ type: 'up' }); });
window.addEventListener('contextmenu', (event) => { event.preventDefault(); send({ type: 'menu' }); });
