const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pulsePet', {
  onState: (callback) => ipcRenderer.on('state', (_event, state) => callback(state)),
  onSprite: (callback) => ipcRenderer.on('sprite', (_event, url) => callback(url)),
  drag: (dx, dy) => ipcRenderer.send('drag', dx, dy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  tray: (open) => ipcRenderer.send('tray', open),
  open: (url) => ipcRenderer.send('open', url),
  quit: () => ipcRenderer.send('quit'),
});
