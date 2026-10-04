import { screen } from 'electron';
import { SHELL_IPC } from './contracts';
import type { DisplayLayout, Rect, WebContentsLike } from './contracts';

export interface DisplayInfo { workArea: Rect; bounds: Rect; scaleFactor: number }

export const readDisplay = (): DisplayInfo => {
  const { workArea, bounds, scaleFactor } = screen.getPrimaryDisplay();
  return { workArea: { ...workArea }, bounds: { ...bounds }, scaleFactor };
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const hubBoundsFor = (workArea: Rect, collapsed: boolean, current?: Rect): Rect => {
  const width = 360;
  const height = collapsed ? 56 : 560;
  return {
    x: clamp(current?.x ?? workArea.x + workArea.width - width - 16, workArea.x, workArea.x + Math.max(0, workArea.width - width)),
    y: clamp(current?.y ?? workArea.y + 16, workArea.y, workArea.y + Math.max(0, workArea.height - height)),
    width,
    height,
  };
};

export const buildDisplayLayout = (
  display: DisplayInfo,
  hubBounds: Rect,
  flags: Pick<DisplayLayout, 'hubCollapsed' | 'animalsHidden' | 'demoMode' | 'devMode'>,
): DisplayLayout => ({
  workArea: { ...display.workArea },
  displayBounds: { ...display.bounds },
  scaleFactor: display.scaleFactor,
  hubBounds: { ...hubBounds },
  ...flags,
});

interface WindowBounds { getBounds(): Rect; setBounds(bounds: Rect): void; isDestroyed(): boolean }
export const watchDisplay = (opts: {
  overlay: WindowBounds;
  hub: WindowBounds;
  isCollapsed(): boolean;
  layout(): DisplayLayout;
  targets(): readonly WebContentsLike[];
}): (() => void) => {
  const broadcast = () => {
    const layout = opts.layout();
    for (const target of opts.targets()) if (!target.isDestroyed()) target.send(SHELL_IPC.layoutChanged, layout);
  };
  const update = () => {
    if (opts.overlay.isDestroyed() || opts.hub.isDestroyed()) return;
    const { workArea } = readDisplay();
    opts.overlay.setBounds(workArea);
    const next = hubBoundsFor(workArea, opts.isCollapsed(), opts.hub.getBounds());
    opts.hub.setBounds(next);
    broadcast();
  };
  screen.on('display-metrics-changed', update);
  screen.on('display-added', update);
  screen.on('display-removed', update);
  return () => {
    screen.removeListener('display-metrics-changed', update);
    screen.removeListener('display-added', update);
    screen.removeListener('display-removed', update);
  };
};
