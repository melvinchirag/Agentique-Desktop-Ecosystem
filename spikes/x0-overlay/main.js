const { app, BrowserWindow, ipcMain, screen, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}
const pointerMode = option('--pointer', 'forward');
const level = option('--level', 'floating');
const toolbar = argv.includes('--toolbar');
const noGpu = argv.includes('--no-gpu') || process.env.X0_NO_GPU === '1';
if (!['forward', 'poll'].includes(pointerMode)) throw new Error('Use --pointer forward|poll');
if (!['floating', 'screen-saver'].includes(level)) throw new Error('Use --level floating|screen-saver');
if (noGpu) app.disableHardwareAcceleration();

let overlay;
let hub;
let isQuitting = false;
let interactive = false;
let shapes = [];
let pollTimer;
let leaveTimer;
let currentDisplay;
let gpuStatus = 'unknown';
let overlayCreated = false;
const counts = {
  forwardedMoves: 0,
  interactiveToggles: 0,
  clicks: 0,
  hubChars: 0,
  micBytes: 0,
  micMime: 'none',
  fps: []
};

const overlayUrl = pathToFileURL(path.join(__dirname, 'renderer', 'overlay.html')).href;

function displayInfo() {
  const display = screen.getPrimaryDisplay();
  currentDisplay = display;
  return {
    scaleFactor: display.scaleFactor,
    workArea: display.workArea,
    bounds: display.bounds,
    pointerMode,
    level,
    toolbar,
    noGpu,
    gpuStatus,
    interactive
  };
}

function sendDiagnostics() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('x0:diagnostics', displayInfo());
  }
}

function setInteractive(value) {
  if (!overlay || overlay.isDestroyed() || interactive === value) return;
  interactive = value;
  overlay.setIgnoreMouseEvents(!value, value ? undefined : { forward: true });
  if (value) counts.interactiveToggles += 1;
  sendDiagnostics();
}

function wantInteractive(value) {
  if (value) {
    clearTimeout(leaveTimer);
    leaveTimer = undefined;
    setInteractive(true);
  } else if (!leaveTimer) {
    leaveTimer = setTimeout(() => {
      leaveTimer = undefined;
      setInteractive(false);
    }, 60);
  }
}

function contains(rect, point) {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}

function pollPointer() {
  if (!overlay || overlay.isDestroyed()) return;
  const point = screen.getCursorScreenPoint();
  const area = overlay.getBounds();
  const local = { x: point.x - area.x, y: point.y - area.y };
  wantInteractive(shapes.some((rect) => contains(rect, local)));
}

function writeReport() {
  const d = currentDisplay || screen.getPrimaryDisplay();
  const area = d.workArea;
  const avgFps = counts.fps.length
    ? counts.fps.reduce((sum, fps) => sum + fps, 0) / counts.fps.length : 0;
  const check = (pass, label) => `[${pass ? 'PASS' : 'FAIL'}] ${label}`;
  const lines = [
    'X0 REPORT',
    `Electron ${process.versions.electron} · Windows ${os.release()} · scaleFactor ${d.scaleFactor} · workArea ${area.x},${area.y},${area.width},${area.height}`,
    `GPU compositing: ${gpuStatus} · hardware acceleration: ${noGpu ? 'off' : 'on'}`,
    `Pointer mode: ${pointerMode} · AlwaysOnTop level: ${level} · toolbar type: ${toolbar ? 'on' : 'off'}`,
    'AUTO CHECKS',
    check(overlayCreated, 'overlay window created with transparent:true and focusable:false'),
    check(counts.forwardedMoves > 0, `forwarded mousemove events received while ignoring mouse (count=${counts.forwardedMoves})`),
    check(counts.interactiveToggles > 0, 'interactive toggled on at least once'),
    check(counts.clicks > 0, `critter click received on focusable:false window (count=${counts.clicks})`),
    check(counts.hubChars > 0, `hub received keyboard input (chars=${counts.hubChars})`),
    check(counts.micBytes > 0, `mic recording produced bytes (${counts.micBytes}, ${counts.micMime})`),
    check(avgFps >= 30, `FPS >= 30 while rotating (avg=${avgFps.toFixed(1)})`),
    'MANUAL CHECKS (Chanuth fills in)',
    '[ ] background is transparent, not black',
    '[ ] clicks pass through to apps underneath away from the critter',
    '[ ] overlay is not in Alt-Tab or the taskbar',
    "[ ] Hub takes typing focus; overlay never steals focus from the app you're using",
    '[ ] looks right at this display scaling'
  ];
  const report = `${lines.join('\n')}\n`;
  process.stdout.write(`\n${report}`);
  fs.writeFileSync(path.join(__dirname, 'X0-REPORT.md'), report);
}

app.whenReady().then(() => {
  const ownOverlay = (webContents) =>
    overlay && webContents === overlay.webContents &&
    overlay.webContents.getURL() === overlayUrl;
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(permission === 'media' && ownOverlay(webContents));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    permission === 'media' && ownOverlay(webContents));

  const area = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    ...area,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    ...(toolbar ? { type: 'toolbar' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  overlayCreated = true;
  overlay.setAlwaysOnTop(true, level);
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));

  hub = new BrowserWindow({
    x: area.x + area.width - 376,
    y: area.y + 16,
    width: 360,
    height: 200,
    frame: false,
    focusable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  hub.setAlwaysOnTop(true, 'floating');
  hub.loadFile(path.join(__dirname, 'renderer', 'hub.html'));
  hub.on('closed', () => { if (!isQuitting) app.quit(); });

  screen.on('display-metrics-changed', () => {
    const next = screen.getPrimaryDisplay().workArea;
    overlay.setBounds(next);
    hub.setPosition(next.x + next.width - 376, next.y + 16);
    sendDiagnostics();
  });
  if (pointerMode === 'poll') pollTimer = setInterval(pollPointer, 33);
  app.getGPUInfo('basic').then(() => {
    gpuStatus = app.getGPUFeatureStatus().gpu_compositing || 'unknown';
    sendDiagnostics();
  }).catch(() => sendDiagnostics());
  sendDiagnostics();
});

ipcMain.handle('x0:get-config', () => displayInfo());
ipcMain.on('x0:set-interactive', (event, value) => {
  if (pointerMode === 'forward' && event.sender === overlay?.webContents) setInteractive(value);
});
ipcMain.on('x0:shapes', (event, value) => {
  if (pointerMode === 'poll' && event.sender === overlay?.webContents && Array.isArray(value)) {
    shapes = value.filter((r) => ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(r[key])));
  }
});
ipcMain.on('x0:forwarded-move', (event) => {
  if (event.sender === overlay?.webContents && !interactive) counts.forwardedMoves += 1;
});
ipcMain.on('x0:fps', (event, value) => {
  if (event.sender === overlay?.webContents && Number.isFinite(value) && value >= 0) counts.fps.push(value);
});
ipcMain.on('x0:critter-click', (event) => {
  if (event.sender === overlay?.webContents) counts.clicks += 1;
});
ipcMain.on('x0:mic-result', (event, bytes, mime) => {
  if (event.sender === overlay?.webContents && Number.isFinite(bytes) && bytes > 0) {
    counts.micBytes = bytes;
    counts.micMime = String(mime || 'unknown');
  }
});
ipcMain.on('x0:hub-input', (event, value, chars) => {
  if (event.sender !== hub?.webContents) return;
  counts.hubChars += Number.isFinite(chars) ? Math.max(0, chars) : 0;
  overlay?.webContents.send('x0:hub-text', String(value).slice(0, 200));
});
ipcMain.on('x0:quit', (event) => { if (event.sender === hub?.webContents) app.quit(); });

app.on('before-quit', () => {
  if (isQuitting) return;
  isQuitting = true;
  clearInterval(pollTimer);
  clearTimeout(leaveTimer);
  writeReport();
});
app.on('window-all-closed', () => app.quit());
