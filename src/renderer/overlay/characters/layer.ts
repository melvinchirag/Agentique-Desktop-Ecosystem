import { AnimationClip, Box3, BufferGeometry, CanvasTexture, CapsuleGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera, Points, PointsMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AgentId, AgentMood } from '../../../shared/agents';
import { AGENTS } from '../../../shared/config';
import type { Point, Rect } from '../../../main/shell/contracts';
import type { CharacterLayer, DesktopLayout, Facing, Gait, HitRegistry } from '../../shell/contracts';
import { cameraFor, projectBox, toWorld } from './coords';
import { ClipPlayer, proceduralPose } from './clips';
import { FrameDriver, targetFps, type FrameState } from './fps';
import { clamp01, gaitClip, MotionSlot, travelDuration, tween } from './motion';
import { MOOD, tintMaterial } from './mood';

const HEIGHT: Record<AgentId, number> = { chipmunk: 90, workspace: 100, wolf: 110, beaver: 85, eagle: 95, ants: 18, butterfly: 60, nightingale: 60 };
const EASE = (t: number): number => t * t * (3 - 2 * t);
const ANT_MATRIX = new Matrix4();

interface Tuning { scale?: number; yOffset?: number; bubbleHeight?: number; walkSpeed?: number; clipMap?: Record<string, string>; sounds?: Record<string, string> }
interface Motion { from: Point; to: Point; started: number; duration: number; fromScale: number; toScale: number; arc: number; hide: boolean; restore: string | null; ground?: 'path' | 'arrival'; dock?: boolean; onEnd?: () => void }
interface Animal {
  id: AgentId; x: number; y: number; root: Group; visual: Group; box: Box3; height: number;
  hidden: boolean; facing: Facing; mood: AgentMood; intensity: number; mouth: number; mouthTarget: number;
  blinkAt: number; blinkUntil: number; player: ClipPlayer; slot: MotionSlot; serial: number;
  motion: Motion | null; prop: Mesh | null; dockPoint: Point | null; tuning: Tuning;
  baseMaterials: Map<MeshStandardMaterial, MeshStandardMaterial>; morphs: Mesh[]; eyes: Mesh[];
  swarm: InstancedMesh | null; swarmPivots: Group[]; z: Sprite | null; sparkles: Points | null;
}

function tuningFrom(value: unknown): Tuning {
  if (!value || typeof value !== 'object') return {};
  const source = value as Record<string, unknown>;
  const out: Tuning = {};
  for (const key of ['scale', 'yOffset', 'bubbleHeight', 'walkSpeed'] as const) if (typeof source[key] === 'number' && Number.isFinite(source[key])) out[key] = source[key] as number;
  for (const key of ['clipMap', 'sounds'] as const) {
    const map = source[key];
    if (map && typeof map === 'object' && !Array.isArray(map)) out[key] = Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string'));
  }
  return out;
}

function placeholder(id: AgentId): { object: Group; box: Box3; eyes: Mesh[] } {
  const height = HEIGHT[id];
  const body = new Group();
  const radius = height * 0.24;
  const capsule = new Mesh(new CapsuleGeometry(radius, height - 2 * radius, 4, 8), new MeshStandardMaterial({ color: AGENTS[id].color, roughness: 0.8 }));
  capsule.position.y = height / 2;
  body.add(capsule);
  const eyes: Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(Math.max(1.5, height * 0.045), 6, 4), new MeshStandardMaterial({ color: '#111827' }));
    eye.position.set(side * radius * 0.42, height * 0.64, radius * 0.9);
    body.add(eye); eyes.push(eye);
  }
  return { object: body, box: new Box3().setFromObject(body), eyes };
}

function scrollMesh(height: number): Mesh {
  const mesh = new Mesh(new CapsuleGeometry(Math.max(2, height * 0.035), Math.max(5, height * 0.11), 3, 6), new MeshStandardMaterial({ color: '#E9D8A6' }));
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(height * 0.23, height * 0.42, height * 0.2);
  return mesh;
}

function swarmPlaceholder(): { object: Group; box: Box3; swarm: InstancedMesh } {
  const object = new Group();
  const swarm = new InstancedMesh(new CapsuleGeometry(4, 10, 3, 6), new MeshStandardMaterial({ color: AGENTS.ants.color }), 12);
  const matrix = new Matrix4();
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI * 2 / 12;
    matrix.makeTranslation(Math.cos(angle) * (18 + i % 3 * 6), 9, Math.sin(angle) * 8);
    swarm.setMatrixAt(i, matrix);
  }
  swarm.instanceMatrix.needsUpdate = true; object.add(swarm);
  return { object, box: new Box3(new Vector3(-36, 0, -12), new Vector3(36, 18, 12)), swarm };
}

function moodVisuals(height: number): { z: Sprite | null; sparkles: Points } {
  let z: Sprite | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#C8D8FF'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('z', 18, 48);
      z = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false }));
      z.position.set(height * 0.25, height * 1.15, 4); z.scale.set(24, 24, 1); z.visible = false;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-height * 0.3, height * 0.8, 2, height * 0.35, height * 1.08, 2, 0, height * 1.25, 2], 3));
  const sparkles = new Points(geometry, new PointsMaterial({ color: '#FFD9EC', size: 5, sizeAttenuation: false, transparent: true }));
  sparkles.visible = false;
  return { z, sparkles };
}

export function padded(rect: Rect, px = 8): Rect { return { x: rect.x - px, y: rect.y - px, width: rect.width + px * 2, height: rect.height + px * 2 }; }
export function registerHit(hit: HitRegistry, id: AgentId, rect: Rect | null): void {
  hit.set(`animal:${id}`, 'animal', rect ? padded(rect) : null);
}

export class CharacterController implements CharacterLayer {
  readonly scene = new Group();
  private animals = new Map<AgentId, Animal>();
  private camera: OrthographicCamera;
  private driver: FrameDriver;
  private visible = true;
  private carrier: { mesh: Group; from: number; to: number; started: number; duration: number; resolve: () => void } | null = null;
  constructor(private layout: DesktopLayout, private readonly hit: HitRegistry, private readonly assetBase: string, private readonly invalidate: () => void) {
    this.camera = cameraFor(layout.width, layout.height);
    this.driver = new FrameDriver(invalidate);
  }
  get viewCamera(): OrthographicCamera { return this.camera; }
  private now(): number { return performance.now() / 1000; }
  private point(a: Animal): Point { return { x: a.x, y: a.y }; }
  private place(a: Animal): void {
    a.root.position.copy(toWorld(this.point(a), this.layout.width, this.layout.height));
    a.root.updateMatrixWorld(true);
  }
  private frameState(): FrameState {
    const state: FrameState = { visible: this.visible, active: this.carrier ? 1 : 0, moving: !!this.carrier, crossfading: false, oneShot: false, talking: false, tinting: false, idleLoops: false };
    for (const a of this.animals.values()) {
      if (a.hidden) continue;
      state.active++;
      state.moving ||= !!a.motion;
      state.crossfading ||= a.player.isCrossfading;
      state.oneShot ||= a.player.isOneShot;
      state.talking ||= a.mouthTarget > 0 || a.mouth > 0.01;
      state.tinting ||= a.mood !== 'neutral' && a.mood !== 'sleepy' && a.intensity > 0;
      state.idleLoops ||= a.player.loopName !== 'Sleep';
    }
    return state;
  }
  private refresh(): void {
    this.driver.setFps(targetFps(this.frameState()));
    this.invalidate();
  }
  spawn(id: AgentId, x: number): void {
    const existing = this.animals.get(id);
    if (existing) {
      existing.slot.cancel(); existing.serial++; existing.motion = null;
      existing.x = x; existing.y = this.layout.groundY; existing.hidden = false; existing.root.scale.setScalar(1); existing.root.visible = this.visible;
      this.place(existing); this.refresh(); return;
    }
    const p = id === 'ants' ? swarmPlaceholder() : placeholder(id);
    const root = new Group(); const visual = new Group();
    root.rotation.x = 12 * Math.PI / 180;
    visual.add(p.object); root.add(visual); this.scene.add(root);
    const effects = moodVisuals(HEIGHT[id]);
    if (effects.z) root.add(effects.z);
    root.add(effects.sparkles);
    const player = new ClipPlayer(p.object, []);
    const a: Animal = { id, x, y: this.layout.groundY, root, visual, box: p.box, height: HEIGHT[id], hidden: false, facing: 'front', mood: 'neutral', intensity: 1,
      mouth: 0, mouthTarget: 0, blinkAt: this.now() + 2 + Math.random() * 4, blinkUntil: 0, player, slot: new MotionSlot(), serial: 0,
      motion: null, prop: null, dockPoint: null, tuning: {}, baseMaterials: new Map(), morphs: [], eyes: 'eyes' in p ? p.eyes : [],
      swarm: 'swarm' in p ? p.swarm : null, swarmPivots: [], z: effects.z, sparkles: effects.sparkles };
    this.animals.set(id, a); this.place(a); this.prepareMaterials(a); void player.play('Idle'); this.refresh();
    void this.load(a);
  }
  private async load(a: Animal): Promise<void> {
    const characterUrl = `${this.assetBase.replace(/\/$/, '')}/${a.id}`;
    const url = `${characterUrl}/default`;
    let tuning: Tuning = {};
    let hasManifest = false;
    for (const manifest of [`${characterUrl}/character.json`, `${url}/character.json`]) {
      try {
        const response = await fetch(manifest);
        if (response.ok) { tuning = tuningFrom(await response.json()); hasManifest = true; break; }
      } catch { /* optional manifest */ }
    }
    if (this.animals.get(a.id) !== a) return;
    a.tuning = tuning;
    // Swarm's model and manifest arrive together; keep its animated 12-ant placeholder until then.
    if (a.id === 'ants' && !hasManifest) return;
    try {
      const gltf = await new GLTFLoader().loadAsync(`${url}/model.glb`);
      if (this.animals.get(a.id) !== a) return;
      const model = cloneSkeleton(gltf.scene);
      const bounds = new Box3().setFromObject(model);
      if (bounds.isEmpty() || bounds.getSize(new Vector3()).y <= 0) throw new Error('Empty model');
      let triangles = 0;
      model.traverse(object => { if (object instanceof Mesh) { const geo = object.geometry; triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; } });
      if (process.env.NODE_ENV !== 'production' && triangles > 30000) console.warn(`${a.id} model has ${Math.round(triangles)} triangles (budget 30000)`);
      const height = HEIGHT[a.id] * (tuning.scale && tuning.scale > 0 ? tuning.scale : 1);
      const scale = height / bounds.getSize(new Vector3()).y;
      model.scale.setScalar(scale);
      model.position.y -= bounds.min.y * scale;
      model.position.y += tuning.yOffset ?? 0;
      const normalized = new Box3().setFromObject(model);
      a.visual.clear();
      if (a.id === 'ants') {
        a.swarmPivots = [];
        for (let i = 0; i < 12; i++) {
          const ant = i ? cloneSkeleton(model) : model;
          const angle = i * Math.PI * 2 / 12;
          const pivot = new Group(); pivot.position.set(Math.cos(angle) * (18 + i % 3 * 6), 0, Math.sin(angle) * 8);
          pivot.add(ant); a.visual.add(pivot); a.swarmPivots.push(pivot);
        }
        a.box = new Box3(new Vector3(-36, 0, -12), new Vector3(36, a.height, 12));
      } else { a.visual.add(model); a.box = normalized; }
      a.height = normalized.getSize(new Vector3()).y;
      if (a.id === 'ants') a.box.max.y = a.height;
      a.swarm = null;
      a.eyes = []; a.morphs = [];
      a.visual.traverse(object => { if (object instanceof Mesh && object.morphTargetDictionary) a.morphs.push(object); });
      a.player.dispose();
      a.player = new ClipPlayer(model, gltf.animations as AnimationClip[], tuning.clipMap);
      void a.player.play('Idle');
      this.prepareMaterials(a); this.setProp(a.id, a.prop ? 'scroll' : null);
      this.refresh();
    } catch { /* per-character placeholder stays visible */ }
  }
  private prepareMaterials(a: Animal): void {
    a.baseMaterials.clear();
    a.visual.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const clone = (material: MeshStandardMaterial): MeshStandardMaterial => {
        const instance = material.clone(); a.baseMaterials.set(instance, material.clone()); return instance;
      };
      if (Array.isArray(object.material)) object.material = object.material.map(m => m instanceof MeshStandardMaterial ? clone(m) : m.clone());
      else if (object.material instanceof MeshStandardMaterial) object.material = clone(object.material);
      else object.material = object.material.clone();
    });
  }
  despawn(id: AgentId): void {
    const a = this.animals.get(id); if (!a) return;
    a.slot.cancel(); a.player.dispose(); a.serial++; this.scene.remove(a.root); this.animals.delete(id);
    registerHit(this.hit, id, null); this.refresh();
  }
  has(id: AgentId): boolean { return this.animals.has(id); }
  play(id: AgentId, clip: string, opts?: { once?: boolean }): Promise<void> {
    const a = this.animals.get(id); if (!a) return Promise.resolve();
    if (!opts?.once && a.motion?.restore) a.motion.restore = clip;
    const result = a.player.play(clip, opts?.once); this.refresh(); return result;
  }
  private begin(a: Animal, motion: Omit<Motion, 'started'>): Promise<void> {
    a.serial++; a.slot.cancel();
    const promise = a.slot.start();
    a.motion = { ...motion, started: this.now() };
    a.hidden = false; a.root.visible = this.visible; this.refresh(); return promise;
  }
  moveTo(id: AgentId, x: number, opts?: { gait?: Gait }): Promise<void> {
    const a = this.animals.get(id); if (!a) return Promise.resolve();
    const gait = opts?.gait ?? 'walk';
    const previous = a.motion?.restore ?? a.player.loopName;
    this.face(id, x < a.x ? 'left' : 'right'); void a.player.play(gaitClip[gait]);
    return this.begin(a, { from: this.point(a), to: { x, y: this.layout.groundY }, duration: travelDuration(a.x, x, gait, a.tuning.walkSpeed), fromScale: 1, toScale: 1, arc: 0, hide: false, restore: previous, ground: 'path' });
  }
  face(id: AgentId, facing: Facing): void { const a = this.animals.get(id); if (!a) return; a.facing = facing; a.visual.rotation.y = facing === 'left' ? -Math.PI / 3 : facing === 'right' ? Math.PI / 3 : 0; this.refresh(); }
  async flyOff(id: AgentId): Promise<void> {
    const a = this.animals.get(id); if (!a) return;
    a.serial++; a.slot.cancel(); a.motion = null; const serial = a.serial;
    await this.play(id, 'Takeoff', { once: true });
    if (a.serial !== serial || this.animals.get(id) !== a) return;
    void this.play(id, 'Fly');
    await this.begin(a, { from: this.point(a), to: { x: a.x + 100, y: -a.height - 20 }, duration: 0.9, fromScale: 1, toScale: 1, arc: -80, hide: true, restore: null });
  }
  async flyIn(id: AgentId, x: number): Promise<void> {
    const a = this.animals.get(id); if (!a) return;
    a.y = -a.height - 20; a.x = x - 100; a.hidden = false;
    void this.play(id, 'Glide');
    const arrival = this.begin(a, { from: this.point(a), to: { x, y: this.layout.groundY }, duration: 0.9, fromScale: 1, toScale: 1, arc: -70, hide: false, restore: null, ground: 'arrival' });
    const serial = a.serial;
    await arrival;
    if (a.serial === serial && !a.hidden) await this.play(id, 'Land', { once: true });
  }
  dockInto(id: AgentId, dockPoint: Point): Promise<void> {
    const a = this.animals.get(id); if (!a) return Promise.resolve();
    a.dockPoint = dockPoint;
    return this.begin(a, { from: this.point(a), to: dockPoint, duration: 0.6, fromScale: 1, toScale: 0.01, arc: -40, hide: true, restore: null, dock: true });
  }
  undock(id: AgentId, x: number): Promise<void> {
    const a = this.animals.get(id); if (!a) return Promise.resolve();
    const from = a.dockPoint ?? { x, y: -a.height };
    a.x = from.x; a.y = from.y; a.root.scale.setScalar(0.01);
    return this.begin(a, { from, to: { x, y: this.layout.groundY }, duration: 0.6, fromScale: 0.01, toScale: 1, arc: -40, hide: false, restore: null });
  }
  setMood(id: AgentId, mood: AgentMood, intensity = 1): void { const a = this.animals.get(id); if (!a) return; a.mood = mood; a.intensity = clamp01(intensity); this.refresh(); }
  setMouth(id: AgentId, open: number): void { const a = this.animals.get(id); if (!a) return; a.mouthTarget = clamp01(open); this.refresh(); }
  setProp(id: AgentId, prop: 'scroll' | null): void {
    const a = this.animals.get(id); if (!a) return;
    if (a.prop) a.visual.remove(a.prop);
    a.prop = prop ? scrollMesh(a.height) : null;
    if (a.prop) a.visual.add(a.prop);
    this.refresh();
  }
  antCarrier(fromX: number, toX: number): Promise<void> {
    this.carrier?.resolve(); if (this.carrier) this.scene.remove(this.carrier.mesh);
    const p = placeholder('ants'); const mesh = p.object; mesh.add(scrollMesh(18)); this.scene.add(mesh);
    return new Promise(resolve => {
      this.carrier = { mesh, from: fromX, to: toX, started: this.now(), duration: travelDuration(fromX, toX, 'walk'), resolve };
      this.refresh();
    });
  }
  screenRect(id: AgentId): Rect | null {
    const a = this.animals.get(id); if (!a || a.hidden || !this.visible) return null;
    a.root.updateMatrixWorld(true);
    const box = a.box.clone().applyMatrix4(a.visual.matrixWorld);
    return projectBox(box, this.camera, this.layout.width, this.layout.height);
  }
  position(id: AgentId): Point | null { const a = this.animals.get(id); return a && !a.hidden && this.visible ? this.point(a) : null; }
  setVisible(visible: boolean): void {
    this.visible = visible; this.scene.visible = visible;
    if (!visible) {
      for (const a of this.animals.values()) {
        a.slot.cancel(); a.serial++; a.motion = null;
        if (a.player.isOneShot) void a.player.play(a.player.loopName);
        registerHit(this.hit, a.id, null);
      }
      if (this.carrier) { this.scene.remove(this.carrier.mesh); this.carrier.resolve(); this.carrier = null; }
    }
    this.refresh();
  }
  setLayout(layout: DesktopLayout): void {
    this.layout = layout; this.camera = cameraFor(layout.width, layout.height);
    for (const a of this.animals.values()) {
      a.x = Math.max(0, Math.min(layout.width, a.x));
      if (a.motion?.ground === 'path') { a.motion.from.y = layout.groundY; a.motion.to.y = layout.groundY; a.y = layout.groundY; }
      else if (a.motion?.ground === 'arrival') a.motion.to.y = layout.groundY;
      else if (a.motion?.dock) { a.motion.to = layout.dockPoint; a.dockPoint = layout.dockPoint; }
      else if (!a.motion && !a.hidden) a.y = layout.groundY;
      this.place(a);
    }
    this.refresh();
  }
  frame(dt: number): void {
    const now = this.now();
    for (const a of this.animals.values()) {
      if (a.hidden || !this.visible) continue;
      a.player.update(dt);
      const motion = a.motion;
      if (motion) {
        const t = clamp01((now - motion.started) / (motion.duration || 0.0001));
        a.x = tween(motion.from.x, motion.to.x, 0, 1, t);
        a.y = tween(motion.from.y, motion.to.y, 0, 1, EASE(t)) + Math.sin(Math.PI * t) * motion.arc;
        a.root.scale.setScalar(tween(motion.fromScale, motion.toScale, 0, 1, EASE(t)));
        if (t >= 1) {
          a.motion = null; a.hidden = motion.hide; a.root.visible = !a.hidden;
          if (motion.restore) void a.player.play(motion.restore);
          motion.onEnd?.(); a.slot.finish();
        }
      }
      const pose = a.player.procedural ? proceduralPose(a.player.procedural, a.player.proceduralSeconds, a.player.isOneShot) : null;
      a.visual.position.set(pose?.x ?? 0, pose?.y ?? 0, 0);
      a.visual.scale.y = pose?.scaleY ?? 1;
      a.visual.rotation.z = pose?.rotation ?? 0;
      a.mouth += (a.mouthTarget - a.mouth) * Math.min(1, dt * 12);
      if (now >= a.blinkAt) { a.blinkUntil = now + 0.12; a.blinkAt = now + 2 + Math.random() * 4; }
      const blink = now < a.blinkUntil ? 1 : 0;
      for (const mesh of a.morphs) {
        const dict = mesh.morphTargetDictionary;
        if (!dict || !mesh.morphTargetInfluences) continue;
        if (dict.MouthOpen !== undefined) mesh.morphTargetInfluences[dict.MouthOpen] = a.mouth;
        if (dict.Blink !== undefined) mesh.morphTargetInfluences[dict.Blink] = blink;
      }
      for (const eye of a.eyes) eye.scale.y = blink ? 0.15 : 1;
      if (a.swarm) {
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI * 2 / 12;
          ANT_MATRIX.makeTranslation(Math.cos(angle) * (18 + i % 3 * 6), 9 + Math.sin(now * 3 + i) * 1.5, Math.sin(angle) * 8);
          a.swarm.setMatrixAt(i, ANT_MATRIX);
        }
        a.swarm.instanceMatrix.needsUpdate = true;
      }
      for (let i = 0; i < a.swarmPivots.length; i++) a.swarmPivots[i].position.y = Math.sin(now * 3 + i) * 1.5;
      if (!a.morphs.some(m => m.morphTargetDictionary?.MouthOpen !== undefined)) a.visual.scale.y *= 1 + a.mouth * 0.025;
      for (const [material, base] of a.baseMaterials) tintMaterial(material, base, a.mood, a.intensity, now);
      if (a.z) { a.z.visible = a.mood === 'sleepy' && a.intensity > 0; a.z.position.y = a.height * 1.15 + Math.sin(now * 2) * 3; }
      if (a.sparkles) { a.sparkles.visible = a.mood === 'excited' && a.intensity > 0; a.sparkles.rotation.z = Math.sin(now * 3) * 0.12; }
      this.place(a);
      registerHit(this.hit, a.id, this.screenRect(a.id));
    }
    if (this.carrier && this.visible) {
      const c = this.carrier; const t = clamp01((now - c.started) / (c.duration || 0.0001));
      c.mesh.position.copy(toWorld({ x: tween(c.from, c.to, 0, 1, t), y: this.layout.groundY }, this.layout.width, this.layout.height));
      if (t >= 1) { this.scene.remove(c.mesh); this.carrier = null; c.resolve(); }
    }
    this.driver.setFps(targetFps(this.frameState()));
  }
  dispose(): void {
    this.driver.dispose(); for (const id of [...this.animals.keys()]) this.despawn(id);
    if (this.carrier) { this.carrier.resolve(); this.scene.remove(this.carrier.mesh); this.carrier = null; }
  }
}
