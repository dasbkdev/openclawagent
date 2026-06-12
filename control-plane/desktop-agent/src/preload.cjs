const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("starlabAgent", {
  getStatus: () => ipcRenderer.invoke("agent:getStatus"),
  activate: (input) => ipcRenderer.invoke("agent:activate", input),
  heartbeat: () => ipcRenderer.invoke("agent:heartbeat"),
  ask: (text) => ipcRenderer.invoke("agent:ask", text),
  reset: () => ipcRenderer.invoke("agent:reset"),
  openExternal: (url) => ipcRenderer.invoke("agent:openExternal", url),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("agent:status", listener);
    return () => ipcRenderer.removeListener("agent:status", listener);
  },
});
