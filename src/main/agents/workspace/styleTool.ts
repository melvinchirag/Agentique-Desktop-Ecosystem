import type { ToolDefinition } from '../../../shared/tools';
import type { WorkspaceToolServices } from './calendarTools';

export function createStyleTool(services: WorkspaceToolServices): ToolDefinition[] {
  return [{
    name: 'style_get',
    description: "Get the user's learned email writing style. Call before writing any draft.",
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    risk: 'read',
    execute: async () => {
      if (!services.google()) return { error: 'NOT_CONNECTED' };
      if (!services.getStyle) return { error: 'NO_STYLE' };
      const profile = await services.getStyle();
      return profile == null ? { error: 'NO_STYLE' } : { profile };
    },
  }];
}
