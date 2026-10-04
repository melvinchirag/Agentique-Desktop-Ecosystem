import { expect, it } from 'vitest';
import { demoSeedState } from './seed';

it('provides a realistic Wave 1 scene', () => {
  const state = demoSeedState();
  expect(state.agents?.workspace).toMatchObject({ status: 'working', job: { title: 'Email digest' } });
  expect(state.agents?.eagle).toMatchObject({ status: 'away', job: { title: 'Pizza near me' } });
  expect(state.agents?.beaver).toMatchObject({ queued: 1, pendingApproval: true });
  expect(state.agents?.wolf.status).toBe('idle');
  expect(state.agents?.ants.presence).toBe('sleeping');
  expect(state.agents?.nightingale.presence).toBe('not_installed');
  expect(state.transcript).toHaveLength(6);
  expect(state.transcript?.some(line => line.kind === 'recall')).toBe(true);
  expect(state.tray).toHaveLength(2);
  expect(state.tray?.find(item => item.kind === 'email_draft')?.openUrl).toBeTruthy();
  expect(state.userMood).toEqual({ mood: 'stressed', intensity: 0.6 });
});
