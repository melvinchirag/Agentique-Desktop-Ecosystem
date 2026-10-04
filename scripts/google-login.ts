/** Development-only OAuth login. Run with GOOGLE_CLIENT_ID set; writes .ade-dev/google-tokens.json. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { GoogleAuthService } from '../src/main/connectors/google/googleAuthService';
import { DevFileTokenStore } from '../src/main/connectors/google/tokenStore';
import { RealClock } from '../src/main/runtime/clock';

const execFileAsync = promisify(execFile);

async function openExternal(url: string): Promise<void> {
  const [command, args] = process.platform === 'win32'
    ? ['explorer.exe', [url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  await execFileAsync(command, args);
}

async function main(): Promise<void> {
  if (process.env.ADE_PACKAGED === '1') throw new Error('Development login cannot run in a packaged app');
  try { process.loadEnvFile?.('.env'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Set GOOGLE_CLIENT_ID in the environment');
  const store = new DevFileTokenStore({ isPackaged: false });
  const auth = new GoogleAuthService({
    clientId,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    store,
    fetch: globalThis.fetch,
    openExternal,
    clock: new RealClock(),
  });
  const { email } = await auth.connect();
  process.stdout.write(`Connected Google as ${email}. Refresh token saved in ignored .ade-dev/.\n`);
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Google login failed'}\n`);
  process.exitCode = 1;
});
