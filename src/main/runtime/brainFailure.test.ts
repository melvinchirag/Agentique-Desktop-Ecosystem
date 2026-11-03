import { describe, expect, it } from 'vitest';
import { explainBrainFailure, FOGGY_LINE } from './brainFailure';

describe('explainBrainFailure', () => {
  it('a Backboard 401 (dead key) tells the user to fix the key in Setup', () => {
    const r = explainBrainFailure('Backboard /threads/messages returned 401: {"detail":"Invalid API key"}');
    expect(r.kind).toBe('backboard_rejected');
    expect(r.speech).toMatch(/ADE Setup/);
  });
  it('a Backboard 402 is out of credit', () => {
    expect(explainBrainFailure('Backboard /threads/messages returned 402: payment required').kind).toBe('backboard_credit');
  });
  it('429 is rate limited', () => {
    expect(explainBrainFailure('Backboard /threads/messages returned 429: too many requests').kind).toBe('rate_limited');
  });
  it('a CLI that is not signed in names the vendor', () => {
    const r = explainBrainFailure('Codex: Not logged in. Run `codex login` first.');
    expect(r.kind).toBe('cli_not_signed_in');
    expect(r.speech).toMatch(/^Codex says you are not signed in/);
  });
  it('a missing CLI binary', () => {
    expect(explainBrainFailure('Claude Code: spawn claude ENOENT').kind).toBe('cli_missing');
  });
  it('an old CLI that rejects a flag we pass', () => {
    const r = explainBrainFailure("Codex: error: unexpected argument '--ephemeral' found");
    expect(r.kind).toBe('cli_too_old');
    expect(r.speech).toMatch(/Update Codex/);
  });
  it('a timeout', () => {
    expect(explainBrainFailure('Codex: This operation was aborted').kind).toBe('timeout');
  });
  it('no internet', () => {
    expect(explainBrainFailure('TypeError: fetch failed').kind).toBe('network');
  });
  it('anything else keeps the foggy line', () => {
    const r = explainBrainFailure('network down');
    expect(r).toEqual({ kind: 'unknown', bubble: 'Foggy 😵', speech: FOGGY_LINE });
  });
});
