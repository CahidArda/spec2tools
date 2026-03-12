import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod/v3';
import { toAISDKTools } from './ai-tools.js';
import type { Tool } from './types.js';

function makeTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: 'getUser',
    description: 'Get user by ID',
    parameters: z.object({ id: z.string() }),
    execute: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
    httpMethod: 'GET',
    path: '/users/{id}',
    ...overrides,
  };
}

describe('toAISDKTools', () => {
  it('converts core tools into a ToolSet keyed by name', () => {
    const tools = [
      makeTool({ name: 'getUser' }),
      makeTool({ name: 'listUsers', description: 'List all users' }),
    ];

    const result = toAISDKTools(tools);

    expect(Object.keys(result)).toEqual(['getUser', 'listUsers']);
  });

  it('preserves description on the AI SDK tool', () => {
    const result = toAISDKTools([makeTool({ description: 'Fetch a user' })]);
    const t = result['getUser'];

    expect('description' in t && t.description).toBe('Fetch a user');
  });

  it('preserves the Zod schema as inputSchema', () => {
    const schema = z.object({ id: z.string(), limit: z.number().optional() });
    const result = toAISDKTools([makeTool({ parameters: schema })]);
    const t = result['getUser'];

    // AI SDK tool() stores the Zod schema as inputSchema
    const inputSchema = 'inputSchema' in t ? (t.inputSchema as Record<string, unknown>) : undefined;
    expect(inputSchema).toBeDefined();
    expect('_def' in inputSchema!).toBe(true);
  });

  it('execute delegates to the core tool execute', async () => {
    const executeFn = vi.fn().mockResolvedValue({ ok: true });
    const result = toAISDKTools([makeTool({ execute: executeFn })]);
    const t = result['getUser'];

    const exec = 'execute' in t ? t.execute : undefined;
    expect(exec).toBeDefined();

    const output = await exec!({ id: '42' }, { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal });
    expect(output).toEqual({ ok: true });
    expect(executeFn).toHaveBeenCalledWith({ id: '42' });
  });

  it('returns empty ToolSet for empty input', () => {
    const result = toAISDKTools([]);
    expect(Object.keys(result)).toHaveLength(0);
  });
});
