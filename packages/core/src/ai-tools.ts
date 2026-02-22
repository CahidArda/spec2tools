import { tool, generateText } from 'ai';
import type { Tool } from './types.js';

type ToolSet = NonNullable<Parameters<typeof generateText>[0]['tools']>;

/**
 * Convert core Tool[] into AI SDK ToolSet.
 *
 * Wraps each core tool with the `ai` package's `tool()` helper,
 * producing a `Record<string, CoreTool>` compatible with `generateText`,
 * `streamText`, etc.
 */
export function toAISDKTools(tools: Tool[]): ToolSet {
  const aiTools: ToolSet = {};

  for (const t of tools) {
    aiTools[t.name] = tool({
      description: t.description,
      inputSchema: t.parameters,
      execute: async (params) => {
        return t.execute(params);
      },
    });
  }

  return aiTools;
}

export type { ToolSet };
