import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { CODEX, GEMINI, npmNativeCodexPaths } from '../src/main/brain/vendors';

const ctx = { system: 's', prompt: 'p', structured: true, webSearch: false, workDir: 'W', schemaFile: 'S', resultFile: 'R' };

describe('Codex adapter', () => {
  it('runs with no shell, no user config or rules, read-only, nothing persisted', () => {
    const { args } = CODEX.invoke(ctx);
    expect(args).toEqual(expect.arrayContaining(['--ignore-user-config', '--ignore-rules', '--ephemeral']));
    expect(args.join(' ')).toContain('-s read-only');
    expect(args.join(' ')).toContain('--disable shell_tool');
    expect(args.join(' ')).toContain('--disable unified_exec');
    expect(args.join(' ')).toContain('web_search=disabled');
    expect(args.join(' ')).toContain('--output-schema S');
  });
  it('turns web search on only when the turn asks for it', () => {
    expect(CODEX.invoke({ ...ctx, webSearch: true }).args.join(' ')).toContain('web_search=live');
  });
  it('never spawns a .cmd installer on Windows (Node refuses without a shell)', () => {
    for (const v of [CODEX, GEMINI]) expect(v.installer.win32[0].toLowerCase()).not.toMatch(/\.cmd$/);
  });
  it('finds the native codex.exe behind an npm shim', () => {
    const paths = npmNativeCodexPaths({ PATH: 'C:\nodejs', APPDATA: 'C:\AppData' } as NodeJS.ProcessEnv, 'x64');
    expect(paths).toContain(join('C:\nodejs', 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'));
    expect(paths.some((p) => p.startsWith(join('C:\AppData', 'npm')))).toBe(true);
  });
});
