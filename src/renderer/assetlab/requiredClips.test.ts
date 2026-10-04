import { describe, it, expect } from 'vitest';
import {
  checkClips,
  guessAgentFromPath,
  CORE_REQUIRED_CLIPS,
  CHIP_RECOMMENDED_CLIPS,
  STANDARD_RECOMMENDED_CLIPS
} from './requiredClips';

describe('requiredClips', () => {
  it('flags a missing required clip (spec §16 item 11)', () => {
    // Missing 'Talk' from core 1-6
    const foundClips = ['Idle', 'Walk', 'Work', 'Happy', 'Scared'];
    const results = checkClips('chipmunk', foundClips);

    const talkResult = results.find((r) => r.name === 'Talk');
    expect(talkResult).toBeDefined();
    expect(talkResult?.tier).toBe('required');
    expect(talkResult?.found).toBe(false);

    const idleResult = results.find((r) => r.name === 'Idle');
    expect(idleResult?.found).toBe(true);
    expect(idleResult?.via).toBeUndefined();
  });

  it('honors clipMap aliases from character.json', () => {
    // Blender exported 'Scribble' instead of 'Work'
    const foundClips = ['Idle', 'Walk', 'Talk', 'Scribble', 'Happy', 'Scared'];
    const clipMap = { Work: 'Scribble' };

    const results = checkClips('chipmunk', foundClips, clipMap);

    const workResult = results.find((r) => r.name === 'Work');
    expect(workResult).toBeDefined();
    expect(workResult?.tier).toBe('required');
    expect(workResult?.found).toBe(true);
    expect(workResult?.via).toBe('Scribble');
  });

  it('honors the bird Fly rule for eagle, butterfly, and nightingale', () => {
    // Eagle model with 'Fly' instead of 'Walk'
    const foundClips = ['Idle', 'Fly', 'Talk', 'Work', 'Happy', 'Scared'];

    const eagleResults = checkClips('eagle', foundClips);
    const eagleWalk = eagleResults.find((r) => r.name === 'Walk');
    expect(eagleWalk?.found).toBe(true);
    expect(eagleWalk?.via).toBe('Fly');

    const butterflyResults = checkClips('butterfly', foundClips);
    const butterflyWalk = butterflyResults.find((r) => r.name === 'Walk');
    expect(butterflyWalk?.found).toBe(true);
    expect(butterflyWalk?.via).toBe('Fly');

    const nightingaleResults = checkClips('nightingale', foundClips);
    const nightingaleWalk = nightingaleResults.find((r) => r.name === 'Walk');
    expect(nightingaleWalk?.found).toBe(true);
    expect(nightingaleWalk?.via).toBe('Fly');

    // Non-bird (e.g. beaver or wolf) should NOT accept Fly for Walk
    const beaverResults = checkClips('beaver', foundClips);
    const beaverWalk = beaverResults.find((r) => r.name === 'Walk');
    expect(beaverWalk?.found).toBe(false);
  });

  it("honors Chip's no-SleepWalk rule", () => {
    const chipResults = checkClips('chipmunk', []);
    const chipNames = chipResults.map((r) => r.name);
    expect(chipNames).not.toContain('SleepWalk');

    // Other animals should have SleepWalk in recommended
    const beaverResults = checkClips('beaver', []);
    const beaverSleepWalk = beaverResults.find((r) => r.name === 'SleepWalk');
    expect(beaverSleepWalk).toBeDefined();
    expect(beaverSleepWalk?.tier).toBe('recommended');
  });

  it('includes per-animal signature clips for Chip and Archie', () => {
    const chipResults = checkClips('chipmunk', ['Run', 'Nudge']);
    const chipRun = chipResults.find((r) => r.name === 'Run');
    expect(chipRun?.tier).toBe('signature');
    expect(chipRun?.found).toBe(true);

    const chipNudge = chipResults.find((r) => r.name === 'Nudge');
    expect(chipNudge?.tier).toBe('signature');
    expect(chipNudge?.found).toBe(true);

    const archieResults = checkClips('beaver', ['Carry', 'TailSlap']);
    const archieCarry = archieResults.find((r) => r.name === 'Carry');
    expect(archieCarry?.tier).toBe('signature');
    expect(archieCarry?.found).toBe(true);

    const archieTailSlap = archieResults.find((r) => r.name === 'TailSlap');
    expect(archieTailSlap?.tier).toBe('signature');
    expect(archieTailSlap?.found).toBe(true);
  });

  it('correctly guesses agent from path or file name', () => {
    expect(guessAgentFromPath('characters/chipmunk/default/model.glb')).toBe('chipmunk');
    expect(guessAgentFromPath('chip_rigged.glb')).toBe('chipmunk');
    expect(guessAgentFromPath('archie_v2.glb')).toBe('beaver');
    expect(guessAgentFromPath('beaver.glb')).toBe('beaver');
    expect(guessAgentFromPath('warden_security.glb')).toBe('wolf');
    expect(guessAgentFromPath('characters/wolf/snow/model.glb')).toBe('wolf');
    expect(guessAgentFromPath('pixel.glb')).toBe('workspace');
    expect(guessAgentFromPath('scout_flying.glb')).toBe('eagle');
    expect(guessAgentFromPath('swarm_ant.glb')).toBe('ants');
    expect(guessAgentFromPath('iris_model.glb')).toBe('butterfly');
    expect(guessAgentFromPath('celene_music.glb')).toBe('nightingale');
    expect(guessAgentFromPath('unknown_file.glb')).toBe('chipmunk');
  });
});
