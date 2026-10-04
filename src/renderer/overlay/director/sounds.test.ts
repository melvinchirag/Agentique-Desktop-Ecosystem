import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BiomeEvent } from '../../../shared/events';
import { pokeSound, soundsForEvent } from './sounds';

const manifest = JSON.parse(readFileSync(resolve('resources/sfx/manifest.json'), 'utf8')) as { id: string; file: string }[];
const entry = (type: BiomeEvent['type'], fields: object = {}, agentId = 'chipmunk') => ({ type, agentId, ...fields }) as BiomeEvent;

describe('sound mapping', () => {
  it.each([
    [entry('agent.presence', { presence: 'active', reason: 'startup' }), 'chipmunk.chirp'],
    [entry('agent.mood', { mood: 'scared' }), 'chipmunk.squeak'],
    [entry('agent.mood', { mood: 'happy' }), 'chipmunk.happy-trill'],
    [entry('nudge.fire'), 'chipmunk.knock-knock'],
    [entry('agent.status', { status: 'error' }), 'chipmunk.boing'],
    [entry('agent.presence', { presence: 'sleeping' }), 'chipmunk.snore'],
    [entry('wolf.verdict', { verdict: 'deny' }, 'wolf'), 'wolf.growl'],
    [entry('wolf.alert', {}, 'wolf'), 'wolf.howl'],
    [entry('tool.request', { risk: 'write' }, 'beaver'), 'wolf.sniff'],
    [entry('wolf.verdict', { verdict: 'ask' }, 'wolf'), 'wolf.paw-thump'],
    [entry('agent.status', { status: 'done' }, 'beaver'), 'beaver.tail-slap'],
    [entry('agent.status', { status: 'working' }, 'beaver'), 'beaver.wood-gnaw'],
    [entry('artifact', { kind: 'file_note' }, 'beaver'), 'beaver.paper-rustle'],
    [entry('tool.result', { ok: false }, 'beaver'), 'beaver.reverse-whoosh'],
    [entry('agent.status', { status: 'away' }, 'eagle'), 'eagle.wing-flaps'],
    [entry('agent.return', {}, 'eagle'), 'eagle.whoosh'],
    [entry('agent.status', { status: 'done' }, 'eagle'), 'eagle.screech'],
    [entry('agent.handoff', { via: 'ants' }), 'ants.skitter'],
    [entry('agent.status', { status: 'working' }, 'ants'), 'ants.marching-patter'],
    [entry('agent.status', { status: 'working' }, 'workspace'), 'workspace.blip'],
    [entry('agent.status', { status: 'done' }, 'workspace'), 'workspace.stamp'],
    [entry('agent.presence', { presence: 'active', reason: 'startup' }, 'butterfly'), 'butterfly.flutter-sparkle'],
    [entry('artifact'), 'system.pop'],
    [entry('agent.handoff'), 'system.scroll-pass'],
    [entry('agent.presence', { presence: 'docked' }), 'system.dock-whoomp'],
    [entry('agent.presence', { presence: 'active', reason: 'user' }), 'system.wake-chime'],
    [entry('approval.request'), 'system.approval-ding'],
  ] as const)('%s maps to %s', (event, id) => {
    expect(soundsForEvent(event)).toContain(id);
    expect(manifest.some(sound => sound.id === id)).toBe(true);
  });

  it('all mapped and poke IDs resolve to real files', () => {
    const ids = new Set(manifest.map(sound => sound.id));
    for (const sound of manifest) expect(existsSync(resolve(sound.file))).toBe(true);
    for (const id of ['chipmunk', 'wolf', 'beaver', 'eagle', 'ants', 'workspace', 'butterfly', 'nightingale'] as const) {
      expect(ids.has(pokeSound(id))).toBe(true);
    }
    expect(ids.has('biome.forest-ambience')).toBe(true);
  });
});
