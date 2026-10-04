import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { adeDataDir } from './registry';

/** The callback is the only owner of this path; cleanup runs on success, error, and abort. */
export async function withTempFile<T>(
  bytes: Uint8Array, filename: string, use: (absPath: string) => Promise<T>,
  dataDir = adeDataDir(), signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted();
  const dir = join(dataDir, 'tmp');
  const suffix = extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12);
  const path = join(dir, `pixel-${randomUUID()}${suffix}`);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    signal?.throwIfAborted();
    return await use(path);
  } finally {
    await rm(path, { force: true });
  }
}
