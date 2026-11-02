import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('demo scripts source', () => {
  it('is strict UTF-8 without a BOM', () => {
    const bytes = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)));
    expect(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow();
  });
});
