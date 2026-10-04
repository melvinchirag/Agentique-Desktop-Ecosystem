import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentId, ModelChoice } from '../../shared/agents';
import { loadModelPreferences, saveModelPreferences } from './modelPreferences';

describe('model preferences', () => {
  it('reloads per-agent selections so they override app defaults', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ade-models-'));
    try {
      const path = join(dir, 'models.json');
      const selected = { llm_provider: 'anthropic', model_name: 'claude-sonnet-4-20250514' };
      saveModelPreferences(path, { chipmunk: selected } as Record<AgentId, ModelChoice>);
      expect({ chipmunk: { llm_provider: 'openai', model_name: 'gpt-4o' }, ...loadModelPreferences(path) }.chipmunk).toEqual(selected);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
