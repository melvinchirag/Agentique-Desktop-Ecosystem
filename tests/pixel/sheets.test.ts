import { describe, expect, it } from 'vitest';
import { validateA1Range } from '../../src/main/agents/workspace/sheetsTools';

describe('sheets_read A1 guard', () => {
  it('rejects ranges beyond Google Sheets dimensions and the 5,000-cell cap', () => {
    expect(validateA1Range('XFD1:XFD1')).toBe(true);
    expect(validateA1Range('XFE1:XFE1')).toBe(false);
    expect(validateA1Range('A1:AZ100')).toBe(false);
  });
});
