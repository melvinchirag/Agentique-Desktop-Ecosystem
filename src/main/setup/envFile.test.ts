import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnvFile } from '../sponsors/env';
import { saveSetupKeys, writeSetupEnv } from './envFile';

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'ade-setup-')); roots.push(root); return join(root, 'ADE', '.env'); };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('setup env writer', () => {
  it('creates the data folder and key file', () => {
    const file = fixture();
    saveSetupKeys(file, 'sample-key', 'sample-voice');
    expect(readEnvFile(file)).toMatchObject({ BACKBOARD_API_KEY: 'sample-key', ELEVENLABS_API_KEY: 'sample-voice' });
  });
  it('merges settings and keeps unrelated lines and comments', () => {
    const file = fixture();
    saveSetupKeys(file, 'old-key');
    writeFileSync(file, '# personal note\nOTHER=keep\nBACKBOARD_API_KEY=old-key\nBB_ASSISTANT_CHIPMUNK=old-id\n');
    saveSetupKeys(file, 'new-key');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('# personal note\nOTHER=keep\n');
    expect(text).toContain('BACKBOARD_API_KEY=new-key');
    expect(text).not.toContain('BB_ASSISTANT_CHIPMUNK');
    expect(text).not.toContain('old-key');
  });
  it('keeps assistant ids when saving the same account again', () => {
    const file = fixture();
    saveSetupKeys(file, 'same-key');
    writeSetupEnv(file, { BB_ASSISTANT_CHIPMUNK: 'chip-id', CUSTOM_LINE: 'value' });
    saveSetupKeys(file, 'same-key');
    expect(readEnvFile(file)).toMatchObject({ BB_ASSISTANT_CHIPMUNK: 'chip-id', CUSTOM_LINE: 'value' });
  });
  it('writes a temp file before replacement and leaves the original intact if replacement fails', () => {
    const file = fixture();
    saveSetupKeys(file, 'old-key');
    expect(() => writeSetupEnv(file, { BACKBOARD_API_KEY: 'new-key' }, [], (temp, target) => {
      expect(readEnvFile(String(target)).BACKBOARD_API_KEY).toBe('old-key');
      expect(readEnvFile(String(temp)).BACKBOARD_API_KEY).toBe('new-key');
      throw new Error('rename failed');
    })).toThrow('rename failed');
    expect(readEnvFile(file).BACKBOARD_API_KEY).toBe('old-key');
    expect(readdirSync(join(file, '..')).filter(name => name.endsWith('.tmp'))).toEqual([]);
    writeSetupEnv(file, { BACKBOARD_API_KEY: 'new-key' }, [], renameSync);
    expect(readEnvFile(file).BACKBOARD_API_KEY).toBe('new-key');
  });
});
