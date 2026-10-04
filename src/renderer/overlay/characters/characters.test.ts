import { describe, expect, it, vi } from 'vitest';
import { AnimationClip, Box3, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HitRegistry } from '../../shell/contracts';
import { cameraFor, projectBox, toOverlay, toWorld } from './coords';
import { proceduralFor, resolveClip } from './clips';
import { targetFps } from './fps';
import { MotionSlot, travelDuration, tween } from './motion';
import { MOOD, tintMaterial } from './mood';
import { CharacterController, padded, registerHit } from './layer';

describe('overlay coordinates', () => {
  it('maps CSS pixels to world units and back', () => {
    const camera = cameraFor(1536, 816);
    for (const p of [{ x: 0, y: 0 }, { x: 500, y: 812 }, { x: 1536, y: 816 }]) {
      const world = toWorld(p, 1536, 816);
      expect(toOverlay(world, camera, 1536, 816).x).toBeCloseTo(p.x);
      expect(toOverlay(world, camera, 1536, 816).y).toBeCloseTo(p.y);
    }
  });
  it('projects model bounds with a real orthographic camera', () => {
    const camera = cameraFor(1000, 600);
    const box = new Box3(new Vector3(-20, -200, -5), new Vector3(20, -110, 5));
    const rect = projectBox(box, camera, 1000, 600);
    expect(rect.x).toBeCloseTo(480);
    expect(rect.y).toBeCloseTo(410);
    expect(rect.width).toBeCloseTo(40);
    expect(rect.height).toBeCloseTo(90);
  });
});

describe('frame budget', () => {
  const base = { visible: true, active: 1, moving: false, crossfading: false, oneShot: false, talking: false, tinting: false, idleLoops: true };
  it('selects 30, 10, or 0 fps', () => {
    expect(targetFps(base)).toBe(10);
    for (const flag of ['moving', 'crossfading', 'oneShot', 'talking', 'tinting'] as const) expect(targetFps({ ...base, [flag]: true })).toBe(30);
    expect(targetFps({ ...base, idleLoops: false })).toBe(0);
    expect(targetFps({ ...base, visible: false, moving: true })).toBe(0);
    expect(targetFps({ ...base, active: 0, moving: true })).toBe(0);
  });
});

describe('clips', () => {
  it('maps the required procedural families', () => {
    expect(proceduralFor('Celebrate')).toBe('hop');
    expect(proceduralFor('TalkHappy')).toBe('bob');
    expect(proceduralFor('Worried')).toBe('tremble');
    expect(proceduralFor('TailSlap')).toBe('squash');
    expect(proceduralFor('Dizzy')).toBe('spin');
    expect(proceduralFor('WakeUp')).toBe('slow-bob');
    expect(proceduralFor('SleepWalk')).toBe('gait-bob');
    expect(proceduralFor('Unknown')).toBe('bob');
  });
  it('resolves exact names through clipMap', () => {
    const clips = [new AnimationClip('Scribble', 1, []), new AnimationClip('Idle', 2, [])];
    expect(resolveClip('Work', { Work: 'Scribble' }, clips)).toBe(clips[0]);
    expect(resolveClip('Idle', {}, clips)).toBe(clips[1]);
    expect(resolveClip('work', { Work: 'Scribble' }, clips)).toBeNull();
  });
});

describe('ground motion', () => {
  it('arrives at the gait speed using a fake clock', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const started = Date.now() / 1000;
    const duration = travelDuration(20, 140, 'walk');
    expect(duration).toBe(1);
    vi.advanceTimersByTime(500);
    expect(tween(20, 140, started, duration, Date.now() / 1000)).toBeCloseTo(80);
    vi.advanceTimersByTime(500);
    expect(tween(20, 140, started, duration, Date.now() / 1000)).toBeCloseTo(140);
    expect(travelDuration(0, 260, 'run', 2)).toBeCloseTo(0.5);
    vi.useRealTimers();
  });
  it('resolves an older move when superseded', async () => {
    const slot = new MotionSlot();
    const first = slot.start(); const done = vi.fn(); first.then(done);
    const second = slot.start();
    await first; expect(done).toHaveBeenCalledOnce();
    slot.finish(); await second;
  });
});

describe('mood', () => {
  it('has the approved tint table and scales intensity', () => {
    expect(MOOD.scared.color).toBe('#4A90E2');
    expect(MOOD.nervous.color).toBe('#8FB3D9');
    expect(MOOD.happy.color).toBe('#FFD36E');
    expect(MOOD.excited.color).toBe('#FF9EC7');
    expect(MOOD.proud.color).toBe('#FFC34D');
    expect(MOOD.protective.color).toBe('#B0413E');
    expect(MOOD.sad.desaturate).toBe(0.6);
    expect(MOOD.sleepy.z).toBe(true);
    const base = new MeshStandardMaterial({ color: '#ff0000' });
    const material = base.clone();
    tintMaterial(material, base, 'scared', 0, 0);
    expect(material.emissive.equals(base.emissive)).toBe(true);
    tintMaterial(material, base, 'scared', 1, 0);
    expect(material.emissiveIntensity).toBeGreaterThan(base.emissiveIntensity);
  });
});

describe('hit shapes', () => {
  it('registers padded rectangles and removes hidden animals', () => {
    const set = vi.fn();
    const hit = { set } as unknown as HitRegistry;
    const rect = { x: 10, y: 20, width: 30, height: 40 };
    expect(padded(rect)).toEqual({ x: 2, y: 12, width: 46, height: 56 });
    registerHit(hit, 'chipmunk', rect);
    expect(set).toHaveBeenCalledWith('animal:chipmunk', 'animal', { x: 2, y: 12, width: 46, height: 56 });
    registerHit(hit, 'chipmunk', null);
    expect(set).toHaveBeenLastCalledWith('animal:chipmunk', 'animal', null);
  });
  it('projects a spawned placeholder and registers its padded screen rect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('missing')));
    const load = vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockRejectedValue(new Error('missing'));
    const set = vi.fn();
    const layout = { width: 1000, height: 600, groundY: 596, spots: {} as never, colonyX: 60, centerX: 500, hubX: 800, dockPoint: { x: 800, y: 40 } };
    const layer = new CharacterController(layout, { set } as unknown as HitRegistry, './characters', vi.fn());
    try {
      layer.spawn('chipmunk', 380);
      await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
      layer.frame(1 / 30);
      const rect = layer.screenRect('chipmunk');
      expect(rect).not.toBeNull();
      expect(rect!.x + rect!.width / 2).toBeCloseTo(380, 0);
      expect(rect!.y).toBeLessThan(596);
      expect(rect!.y + rect!.height).toBeGreaterThanOrEqual(596);
      expect(layer.position('chipmunk')).toEqual({ x: 380, y: 596 });
      expect(set).toHaveBeenCalledWith('animal:chipmunk', 'animal', padded(rect!));
      layer.setVisible(false);
      expect(layer.screenRect('chipmunk')).toBeNull();
      expect(set).toHaveBeenLastCalledWith('animal:chipmunk', 'animal', null);
    } finally { layer.dispose(); load.mockRestore(); vi.unstubAllGlobals(); }
  });
});
