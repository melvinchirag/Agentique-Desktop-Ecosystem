import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRealCore, defaultSettings, disconnectedCalendar, loadPersistedSettings, loadRealCoreEnv, missingRealCoreKeys, savePersistedSettings } from './realCore';
import { makeTestSettings } from '../testing/settings';

describe('real core startup fallback', () => {
  it('defaults new installs to the verified Gemini Flash model and preserves saved choices', () => {
    const defaults = defaultSettings({});
    for (const choice of Object.values(defaults.models)) {
      expect(choice).toEqual({ llm_provider: 'google', model_name: 'gemini-2.5-flash' });
    }
    const root = mkdtempSync(join(tmpdir(), 'ade-model-default-'));
    try {
      const file = join(root, 'settings.json');
      const saved = makeTestSettings();
      saved.models.chipmunk = { llm_provider: 'openai', model_name: 'gpt-4o' };
      savePersistedSettings(file, saved);
      const loaded = loadPersistedSettings(file, defaults);
      expect(loaded.models.chipmunk).toEqual(saved.models.chipmunk);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('uses an empty calendar while Google is disconnected', async () => {
    expect(await disconnectedCalendar().listEvents()).toEqual([]);
  });

  it('finds .env beside the executable before data dir and cwd, and returns its folder for CA resolution', () => {
    const root = mkdtempSync(join(tmpdir(), 'ade-env-'));
    const exeDir = join(root, 'app');
    const dataDir = join(root, 'data');
    mkdirSync(exeDir); mkdirSync(dataDir);
    try {
      writeFileSync(join(dataDir, '.env'), 'ADE_TEST_SOURCE=data\n');
      expect(loadRealCoreEnv({ exePath: join(exeDir, 'ADE.exe'), dataDir }).env.ADE_TEST_SOURCE).toBe('data');
      writeFileSync(join(exeDir, '.env'), 'ADE_TEST_SOURCE=exe\nTIGER_CA_FILE=cert.pem\n');
      const loaded = loadRealCoreEnv({ exePath: join(exeDir, 'ADE.exe'), dataDir });
      expect(loaded.env.ADE_TEST_SOURCE).toBe('exe');
      expect(loaded.baseDir).toBe(exeDir);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('restores model, voice, folders and demo preferences after relaunch', () => {
    const root = mkdtempSync(join(tmpdir(), 'ade-settings-'));
    try {
      const file = join(root, 'settings.json');
      const saved = makeTestSettings({ voiceEnabled: false, sfxEnabled: false, allowedFolders: ['C:/Work'], demoMode: true });
      saved.models.chipmunk = { llm_provider: 'openai', model_name: 'gpt-4o' };
      savePersistedSettings(file, saved);
      const loaded = loadPersistedSettings(file, makeTestSettings());
      expect(loaded).toMatchObject({ voiceEnabled: false, sfxEnabled: false, allowedFolders: ['C:/Work'], demoMode: true });
      expect(loaded.models.chipmunk).toEqual(saved.models.chipmunk);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('requires the Chip and Tiger credentials but treats voice as optional', () => {
    expect(missingRealCoreKeys({})).toEqual(['BACKBOARD_API_KEY', 'BB_ASSISTANT_CHIPMUNK', 'TIGER_DATABASE_URL']);
    expect(missingRealCoreKeys({ BACKBOARD_API_KEY: 'bb', BB_ASSISTANT_CHIPMUNK: 'chip', TIGER_DATABASE_URL: 'postgres://user:pass@example/db' })).toEqual([]);
    expect(missingRealCoreKeys({ BACKBOARD_API_KEY: 'bb', BB_ASSISTANT_CHIPMUNK: 'chip', TIGER_DATABASE_URL: 'postgres://user@example/db' })).toEqual(['TIGER_DATABASE_URL credentials']);
  });

  it('keeps --demo on FakeCore and warns in the Hub when normal startup lacks keys', async () => {
    const demo = createRealCore({ demoMode: true, env: {} });
    const demoEvents: string[] = [];
    demo.subscribe(event => { if (event.type === 'wolf.alert') demoEvents.push(event.reason); });
    demo.start?.();
    expect((await demo.getSettings()).demoMode).toBe(true);
    expect(demoEvents).toEqual([]);
    demo.dispose?.();

    const fallback = createRealCore({ env: {} });
    const warnings: string[] = [];
    fallback.subscribe(event => { if (event.type === 'wolf.alert') warnings.push(event.reason); });
    fallback.start?.();
    expect((await fallback.getSettings()).demoMode).toBe(true);
    expect(warnings).toEqual(['Running demo core: missing keys']);
    expect(await fallback.getMemories('chipmunk')).toEqual([]);
    expect(await fallback.searchMemories('chipmunk', 'sample')).toEqual([]);
    fallback.dispose?.();
  });
});
