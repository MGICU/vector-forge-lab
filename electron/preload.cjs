const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("vectorForgeDesktop", Object.freeze({
  getLocalActionToken: () => ipcRenderer.invoke("vector-forge:get-local-action-token"),
  getDataDirectoryStatus: () => ipcRenderer.invoke("vector-forge:get-data-dir-status"),
  chooseDataDirectory: () => ipcRenderer.invoke("vector-forge:choose-data-dir"),
  saveDataDirectory: (dataDir) => ipcRenderer.invoke("vector-forge:save-data-dir", dataDir),
  resetDataDirectory: () => ipcRenderer.invoke("vector-forge:reset-data-dir"),
  relaunch: () => ipcRenderer.invoke("vector-forge:relaunch"),
}));
