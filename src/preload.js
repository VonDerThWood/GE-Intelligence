const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('genius', {
  // Data
  getData: () => ipcRenderer.invoke('get-data'),
  fetchNow: (mode) => ipcRenderer.invoke('fetch-now', mode),
  getDataDir: () => ipcRenderer.invoke('get-data-dir'),

  // Item stats from RS Wiki
  getItemStats:          (name) => ipcRenderer.invoke('get-item-stats', name),
  getItemHistory:        (id)   => ipcRenderer.invoke('get-item-history', id),
  getItemHistoryLocal:   (id)   => ipcRenderer.invoke('get-item-history-local', id),
  getHistoryStatus:      ()     => ipcRenderer.invoke('get-history-status'),
  startHistoryPopulation:(ids)  => ipcRenderer.invoke('start-history-population', ids),
  stopHistoryPopulation: ()     => ipcRenderer.invoke('stop-history-population'),
  onHistoryProgress:     (cb)   => ipcRenderer.on('history-progress', (_, d) => cb(d)),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),

  // Watchlist
  getWatchlist: () => ipcRenderer.invoke('get-watchlist'),
  setWatchlist: (list) => ipcRenderer.invoke('set-watchlist', list),

  getHidden:    () => ipcRenderer.invoke('get-hidden'),
  setHidden:    (list) => ipcRenderer.invoke('set-hidden', list),

  // Alerts
  getAlerts: () => ipcRenderer.invoke('get-alerts'),
  saveAlert: (alert) => ipcRenderer.invoke('save-alert', alert),
  deleteAlert: (id) => ipcRenderer.invoke('delete-alert', id),

  // Portfolio
  getPortfolio:    ()    => ipcRenderer.invoke('get-portfolio'),
  savePosition:    (pos) => ipcRenderer.invoke('save-position', pos),
  deletePosition:  (id)  => ipcRenderer.invoke('delete-position', id),
  sellPosition:    (opts)=> ipcRenderer.invoke('sell-position', opts),

  // Full timeseries (ATH/ATL + date lookup)
  getItemTimeseries: (id) => ipcRenderer.invoke('get-item-timeseries', id),

  // Local price snapshots (no-lag recent history)
  getPriceSnapshots: (id) => ipcRenderer.invoke('get-price-snapshots', id),

  // Item notes
  getNotes:  ()           => ipcRenderer.invoke('get-notes'),
  saveNote:  (id, text)   => ipcRenderer.invoke('save-note', { id, text }),

  // Search shorthands
  getShorthands:  ()   => ipcRenderer.invoke('get-shorthands'),
  saveShorthands: (sh) => ipcRenderer.invoke('save-shorthands', sh),

  // Category overrides editor
  getOverrides:  ()   => ipcRenderer.invoke('get-overrides'),
  saveOverrides: (ov) => ipcRenderer.invoke('save-overrides', ov),

  // Data portability
  exportData: () => ipcRenderer.invoke('export-data'),
  importData: () => ipcRenderer.invoke('import-data'),

  // Utility
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  showNotification: (opts) => ipcRenderer.invoke('show-notification', opts),
  testNotification: (opts) => ipcRenderer.invoke('test-notification', opts),

  // Events from main process
  onFetchComplete: (cb) => ipcRenderer.on('fetch-complete', (_, data) => cb(data)),
  onFetchError: (cb) => ipcRenderer.on('fetch-error', (_, data) => cb(data)),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, data) => cb(data)),
  removeAllListeners: (ch) => ipcRenderer.removeAllListeners(ch)
});
