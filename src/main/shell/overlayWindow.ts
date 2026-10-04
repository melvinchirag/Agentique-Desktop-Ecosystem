import { BrowserWindow, screen } from 'electron';
import type { OverlayController, Point, PointerMode, Rect } from './contracts';

export const pointInAny = (rects: readonly Rect[], point: Point): boolean => rects.some(rect =>
  point.x >= rect.x && point.x <= rect.x + rect.width &&
  point.y >= rect.y && point.y <= rect.y + rect.height,
);

export const createOverlayWindow = (opts: {
  workArea: Rect;
  preload: string;
  level?: 'floating' | 'screen-saver';
  toolbar?: boolean;
  pointerMode?: PointerMode;
}): { window: BrowserWindow; controller: OverlayController } => {
  const window = new BrowserWindow({
    ...opts.workArea,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    thickFrame: false,
    alwaysOnTop: true,
    ...(opts.toolbar ? { type: 'toolbar' as const } : {}),
    webPreferences: {
      preload: opts.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const level = opts.level ?? 'floating';
  window.setAlwaysOnTop(true, level);
  window.setIgnoreMouseEvents(true, { forward: true });
  let interactive = false;
  let hidden = false;
  let mode: PointerMode = 'forward';
  let shapes: Rect[] = [];
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  const clearLeave = () => { if (leaveTimer) clearTimeout(leaveTimer); leaveTimer = undefined; };
  const startPoll = () => { if (mode === 'poll' && !hidden && !pollTimer) pollTimer = setInterval(poll, 33); };
  const setInteractive = (on: boolean) => {
    if (interactive === on || window.isDestroyed()) return;
    interactive = on;
    window.setIgnoreMouseEvents(!on, on ? undefined : { forward: true });
  };
  const poll = () => {
    if (hidden || window.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    const hit = pointInAny(shapes, { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
    if (hit) { clearLeave(); setInteractive(true); }
    else if (interactive && !leaveTimer) leaveTimer = setTimeout(() => { leaveTimer = undefined; setInteractive(false); }, 60);
  };
  const setPointerMode = (next: PointerMode) => {
    if (mode === next) return;
    if (pollTimer) clearInterval(pollTimer);
    clearLeave();
    pollTimer = undefined;
    mode = next;
    setInteractive(false);
    startPoll();
  };
  const controller: OverlayController = {
    get interactive() { return interactive; },
    setInteractive: on => { if (mode === 'forward' && !hidden) setInteractive(on); },
    setHitShapes: rects => { shapes = rects.map(rect => ({ ...rect })); },
    setPointerMode,
    setHidden: on => {
      if (hidden === on || window.isDestroyed()) return;
      hidden = on;
      if (on) {
        clearLeave();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
        setInteractive(false);
        window.hide();
      } else {
        window.showInactive();
        window.setAlwaysOnTop(true, level);
        startPoll();
      }
    },
    setBounds: workArea => { if (!window.isDestroyed()) window.setBounds(workArea); },
    destroy: () => { if (pollTimer) clearInterval(pollTimer); clearLeave(); },
  };
  setPointerMode(opts.pointerMode ?? 'forward');
  return { window, controller };
};
