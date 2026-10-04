import type { Clock } from '../../main/runtime/types';
import type { Point, Rect } from '../../main/shell/contracts';
import type { CreateHitRegistry, HitKind, HitShape } from './contracts';

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const priority = (kind: HitKind) => kind === 'animal' ? 0 : 1;
const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.x <= rect.x + rect.width &&
  point.y >= rect.y && point.y <= rect.y + rect.height;

export const createHitRegistry: CreateHitRegistry = (sink, opts = {}) => {
  const clock = opts.clock ?? realClock;
  const leaveMs = opts.leaveDebounceMs ?? 60;
  const publishMs = 1000 / (opts.publishHz ?? 10);
  const shapes = new Map<string, HitShape>();
  let lastPointer: Point | undefined;
  let captured = false;
  let interactive = false;
  let disposed = false;
  let leaveTimer: unknown;
  let publishTimer: unknown;
  let lastPublishAt = -Infinity;
  let published = '[]';
  const clearLeave = () => { if (leaveTimer !== undefined) clock.clearTimeout(leaveTimer); leaveTimer = undefined; };
  const rects = () => [...shapes.values()].map(shape => shape.rect);
  const publish = () => {
    publishTimer = undefined;
    if (disposed) return;
    const current = rects();
    const serialized = JSON.stringify(current);
    if (serialized === published) return;
    published = serialized;
    lastPublishAt = clock.now();
    sink.publishHitShapes(current);
  };
  const schedulePublish = () => {
    if (publishTimer !== undefined || disposed) return;
    const delay = Math.max(0, lastPublishAt + publishMs - clock.now());
    publishTimer = clock.setTimeout(publish, delay);
  };
  const hitTest = (point: Point): HitShape | null => {
    let hit: HitShape | null = null;
    for (const shape of shapes.values()) {
      if (contains(shape.rect, point) && (!hit || priority(shape.kind) >= priority(hit.kind))) hit = shape;
    }
    return hit;
  };
  const setInteractive = (on: boolean) => {
    if (interactive === on || disposed) return;
    interactive = on;
    sink.setInteractive(on);
  };
  const evaluate = () => {
    if (captured || (lastPointer && hitTest(lastPointer))) {
      clearLeave();
      setInteractive(true);
    } else if (interactive && leaveTimer === undefined) {
      leaveTimer = clock.setTimeout(() => {
        leaveTimer = undefined;
        if (!captured && (!lastPointer || !hitTest(lastPointer))) setInteractive(false);
      }, leaveMs);
    }
  };
  return {
    set(id, kind, rect) {
      if (disposed) return;
      if (rect === null) { this.remove(id); return; }
      const old = shapes.get(id);
      shapes.delete(id);
      shapes.set(id, { id, kind, rect: { ...rect } });
      if (!old || old.kind !== kind || JSON.stringify(old.rect) !== JSON.stringify(rect)) schedulePublish();
      evaluate();
    },
    remove(id) {
      if (disposed || !shapes.delete(id)) return;
      schedulePublish();
      evaluate();
    },
    shapes: () => [...shapes.values()],
    hitTest,
    pointerMove(point) { if (disposed) return; lastPointer = { ...point }; evaluate(); },
    setCaptured(on) { if (disposed || captured === on) return; captured = on; evaluate(); },
    dispose() {
      disposed = true;
      clearLeave();
      if (publishTimer !== undefined) clock.clearTimeout(publishTimer);
      publishTimer = undefined;
      shapes.clear();
    },
  };
};
