import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AnimationClip } from 'three';
import { resolveClip } from './clips';

const base = resolve('src/renderer/public/characters');
const requested = {
  chipmunk: ['Idle', 'Walk', 'Run', 'Talk', 'TalkHappy', 'TalkScared', 'Listen', 'Think', 'Work', 'Happy', 'Celebrate', 'Greet', 'Scared', 'Nervous', 'Sad', 'Excited', 'Relief', 'Handoff', 'Nudge', 'Dizzy', 'Sleep', 'Yawn', 'WakeUp', 'SleepWalk'],
  wolf: ['Idle', 'Walk', 'Run', 'Talk', 'Think', 'Work', 'Scared', 'Nervous', 'Happy', 'Excited', 'Sad', 'Sit', 'Guard', 'Block', 'Howl', 'Handoff', 'Greet', 'Sleep', 'Yawn', 'WakeUp', 'SleepWalk'],
  beaver: ['Idle', 'Walk', 'Run', 'Talk', 'Think', 'Work', 'Carry', 'Handoff', 'Happy', 'Celebrate', 'Greet', 'Scared', 'Nervous', 'Sad', 'Excited', 'Relief', 'Listen', 'Dizzy', 'Sleep', 'Yawn', 'WakeUp', 'SleepWalk'],
  eagle: ['Idle', 'Perch', 'Walk', 'Run', 'Fly', 'Glide', 'Talk', 'Think', 'Work', 'Listen', 'Happy', 'Celebrate', 'Greet', 'Scared', 'Nervous', 'Sad', 'Excited', 'Relief', 'Handoff', 'Nudge', 'Dizzy', 'Sleep', 'Yawn', 'WakeUp', 'SleepWalk', 'Takeoff', 'Land'],
};

describe('director state to shipped GLB clip mapping', () => {
  for (const [id, states] of Object.entries(requested)) {
    it(`${id} resolves every requested state to a real animation`, () => {
      const glb = readFileSync(resolve(base, id, 'default/model.glb'));
      const jsonLength = glb.readUInt32LE(12);
      const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as { animations: { name: string }[] };
      const clips = gltf.animations.map(({ name }) => new AnimationClip(name, 1, []));
      const root = JSON.parse(readFileSync(resolve(base, id, 'character.json'), 'utf8')) as { clipMap: Record<string, string> };
      const variant = JSON.parse(readFileSync(resolve(base, id, 'default/character.json'), 'utf8')) as { clipMap: Record<string, string> };
      expect(variant.clipMap).toEqual(root.clipMap);
      for (const state of states) {
        expect(root.clipMap[state], `${id}.${state} missing`).toBeTruthy();
        expect(resolveClip(state, root.clipMap, clips)?.name, `${id}.${state} has no GLB clip`).toBe(root.clipMap[state]);
      }
    });
  }

  it('prepares Pixel states for the incoming model', () => {
    const { clipMap } = JSON.parse(readFileSync(resolve(base, 'workspace/character.json'), 'utf8')) as { clipMap: Record<string, string> };
    for (const state of ['Idle', 'Walk', 'Talk', 'Happy', 'Write', 'Handoff']) expect(clipMap[state]).toBeTruthy();
  });
});
