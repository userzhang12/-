const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jingxuDesktop', {
  status: () => ipcRenderer.invoke('jingxu:update-status'),
  check: () => ipcRenderer.invoke('jingxu:update-check'),
  download: () => ipcRenderer.invoke('jingxu:update-download'),
  install: () => ipcRenderer.invoke('jingxu:update-install'),
  onStatus: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('jingxu:update-changed', listener);
    return () => ipcRenderer.removeListener('jingxu:update-changed', listener);
  },
});
