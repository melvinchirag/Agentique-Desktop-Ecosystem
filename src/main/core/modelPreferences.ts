import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId, ModelChoice } from '../../shared/agents';
import { AGENTS } from '../../shared/config';

export function loadModelPreferences(path: string): Partial<Record<AgentId, ModelChoice>> {
  try {
    if (!existsSync(path)) return {};
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const choices: Partial<Record<AgentId, ModelChoice>> = {};
    for (const id of Object.keys(AGENTS) as AgentId[]) {
      const value = (raw as Record<string, unknown>)[id];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const model = value as Record<string, unknown>;
        if (typeof model.llm_provider === 'string' && model.llm_provider && typeof model.model_name === 'string' && model.model_name) {
          choices[id] = { llm_provider: model.llm_provider, model_name: model.model_name };
        }
      }
    }
    return choices;
  } catch { return {}; }
}

export function saveModelPreferences(path: string, choices: Record<AgentId, ModelChoice>): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(choices), 'utf8');
  renameSync(temp, path);
}
