const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('x0', {
  getConfig: () => ipcRenderer.invoke('x0:get-config'),
  setInteractive: (value) => ipcRenderer.send('x0:set-interactive', Boolean(value)),
  publishShapes: (shapes) => ipcRenderer.send('x0:shapes', shapes),
  forwardedMove: () => ipcRenderer.send('x0:forwarded-move'),
  fps: (value) => ipcRenderer.send('x0:fps', value),
  critterClick: () => ipcRenderer.send('x0:critter-click'),
  micResult: (bytes, mime) => ipcRenderer.send('x0:mic-result', bytes, mime),
  hubInput: (value, chars) => ipcRenderer.send('x0:hub-input', value, chars),
  quit: () => ipcRenderer.send('x0:quit'),
  onDiagnostics: (fn) => ipcRenderer.on('x0:diagnostics', (_event, data) => fn(data)),
  onHubText: (fn) => ipcRenderer.on('x0:hub-text', (_event, value) => fn(value))
});
