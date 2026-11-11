const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  save: (text) => ipcRenderer.invoke('data:save', text),
  saveSync: (text) => ipcRenderer.sendSync('data:saveSync', text),
  copy: (text) => ipcRenderer.invoke('copy', text),
  saveHtml: (name, html) => ipcRenderer.invoke('file:saveHtml', name, html),
  exportBackup: (text) => ipcRenderer.invoke('backup:export', text),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  boardLoad: (id) => ipcRenderer.invoke('board:load', id),
  boardSave: (id, text) => ipcRenderer.invoke('board:save', id, text),
  boardSaveSync: (id, text) => ipcRenderer.sendSync('board:saveSync', id, text),
  boardDelete: (id) => ipcRenderer.invoke('board:delete', id),
  savePng: (name, dataUrl) => ipcRenderer.invoke('file:savePng', name, dataUrl),
  showDataDir: () => ipcRenderer.invoke('dir:show'),
});
