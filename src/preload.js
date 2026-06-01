const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('genius', {
  // Data
  getData: () => ipcRenderer.invoke('get-data'),
  fetchNow: (mode) => ipcRenderer.invoke('fetch-now', mode),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Watchlist
  getWatchlist: () => ipcRenderer.invoke('get-watchlist'),
  setWatchlist: (list) => ipcRenderer.invoke('set-watchlist', list),

  // Alerts
  getAlerts: () => ipcRenderer.invoke('get-alerts'),
  saveAlert: (alert) => ipcRenderer.invoke('save-alert', alert),
  deleteAlert: (id) => ipcRenderer.invoke('delete-alert', id),

  // Utility
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),

  // Events from main process
  onFetchComplete: (cb) => ipcRenderer.on('fetch-complete', (_, data) => cb(data)),
  onFetchError: (cb) => ipcRenderer.on('fetch-error', (_, data) => cb(data)),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
});
