import { describe, expect, it } from 'vitest';
import { DESIGNED_VOICE_IDS, voiceIdsFromEnv } from './env';

describe('voice ids', () => {
  it('has a designed voice for all eight animals from voices/voices.json', () => {
    expect(Object.keys(DESIGNED_VOICE_IDS).sort()).toEqual(
      ['ants', 'beaver', 'butterfly', 'chipmunk', 'eagle', 'nightingale', 'wolf', 'workspace']);
  });

  it('falls back to the designed voice for a missing EL_VOICE line, and .env wins when set', () => {
    const designed = { chipmunk: 'designed-chip', wolf: 'designed-wolf' };
    expect(voiceIdsFromEnv({ EL_VOICE_CHIPMUNK: 'env-chip' }, designed)).toEqual({ chipmunk: 'env-chip', wolf: 'designed-wolf' });
    expect(voiceIdsFromEnv({}, {})).toEqual({});
  });
});
