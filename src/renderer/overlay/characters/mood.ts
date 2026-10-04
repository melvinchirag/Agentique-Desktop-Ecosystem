import { Color, MeshStandardMaterial, type Material } from 'three';
import type { AgentMood } from '../../../shared/agents';

export interface MoodStyle { color: string | null; emissive: number; desaturate: number; dim: number; sparkles: boolean; z: boolean; pulse: boolean }
export const MOOD: Record<AgentMood, MoodStyle> = {
  neutral: { color: null, emissive: 0, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  scared: { color: '#4A90E2', emissive: 0.34, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  nervous: { color: '#8FB3D9', emissive: 0.25, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  happy: { color: '#FFD36E', emissive: 0.28, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  excited: { color: '#FF9EC7', emissive: 0.38, desaturate: 0, dim: 0, sparkles: true, z: false, pulse: false },
  proud: { color: '#FFC34D', emissive: 0.32, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  sad: { color: null, emissive: 0, desaturate: 0.6, dim: 0, sparkles: false, z: false, pulse: false },
  protective: { color: '#B0413E', emissive: 0.4, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: true },
  relieved: { color: '#FFD9A0', emissive: 0.2, desaturate: 0, dim: 0, sparkles: false, z: false, pulse: false },
  sleepy: { color: null, emissive: 0, desaturate: 0, dim: 0.4, sparkles: false, z: true, pulse: false },
};
export function tintMaterial(material: Material, base: Material, mood: AgentMood, intensity: number, seconds: number): void {
  if (!(material instanceof MeshStandardMaterial) || !(base instanceof MeshStandardMaterial)) return;
  const style = MOOD[mood];
  const amount = clamp(intensity);
  material.color.copy(base.color);
  if (style.desaturate) {
    const grey = (material.color.r + material.color.g + material.color.b) / 3;
    material.color.lerp(new Color(grey, grey, grey), style.desaturate * amount);
  }
  material.color.multiplyScalar(1 - style.dim * amount);
  material.emissive.copy(base.emissive);
  material.emissiveIntensity = base.emissiveIntensity;
  if (style.color) {
    material.emissive.lerp(new Color(style.color), amount);
    material.emissiveIntensity += style.emissive * amount * (style.pulse ? 0.7 + Math.sin(seconds * 7) * 0.3 : 1);
  }
}
const clamp = (n: number): number => Math.max(0, Math.min(1, n));
