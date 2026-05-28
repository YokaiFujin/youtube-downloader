const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  saveFile: (fileId, filename) => ipcRenderer.invoke('save-file', fileId, filename)
});
