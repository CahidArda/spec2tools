import { describe, it, expect } from 'vitest';
import { createTools } from './lib.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_SPEC = path.resolve(__dirname, '../../cli/examples/sample-api.yaml');
const XQUIK_SPEC = path.resolve(__dirname, '../../cli/examples/xquik-api.yaml');

describe('createTools', () => {
  it('returns a ToolSet with one tool per operation', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const names = Object.keys(tools);

    expect(names).toContain('listUsers');
    expect(names).toContain('getUser');
    expect(names).toContain('createUser');
    expect(names).toContain('updateUser');
    expect(names).toContain('deleteUser');
    expect(names).toContain('listPosts');
    expect(names).toContain('createPost');
    expect(names).toContain('getPost');
    expect(names.length).toBe(8);
  });

  it('each tool has description and execute', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });

    for (const [name, t] of Object.entries(tools)) {
      expect('description' in t, `${name} missing description`).toBe(true);
      expect('execute' in t, `${name} missing execute`).toBe(true);
    }
  });

  it('can execute getUser and receive a response', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const getUser = tools['getUser'];
    const exec = 'execute' in getUser ? getUser.execute : undefined;

    const result = await exec!(
      { id: 1 },
      { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal }
    ) as Record<string, unknown>;

    expect(result).toHaveProperty('id', 1);
    expect(result).toHaveProperty('name');
  });

  it('can execute listUsers with query params', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const listUsers = tools['listUsers'];
    const exec = 'execute' in listUsers ? listUsers.execute : undefined;

    const result = await exec!(
      { _limit: 2 },
      { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal }
    ) as unknown[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('can load an OpenAPI 3.1 spec with API key auth in code mode', async () => {
    const tools = await createTools({ spec: XQUIK_SPEC, codeMode: true });
    expect(Object.keys(tools).sort()).toEqual(['execute', 'search']);

    const searchTool = tools['search'];
    const exec = 'execute' in searchTool ? searchTool.execute : undefined;

    const result = await exec!(
      { query: 'tweets' },
      { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal }
    ) as string;

    expect(result).toContain('searchTweets');
    expect(result).toContain('Search X posts');
  });

  describe('codeMode', () => {
    it('returns exactly 2 tools when codeMode is true', async () => {
      const tools = await createTools({ spec: SAMPLE_SPEC, codeMode: true });
      expect(Object.keys(tools).sort()).toEqual(['execute', 'search']);
    });

    it('search tool finds operations from the spec', async () => {
      const tools = await createTools({ spec: SAMPLE_SPEC, codeMode: true });
      const searchTool = tools['search'];
      const exec = 'execute' in searchTool ? searchTool.execute : undefined;

      const result = await exec!(
        { query: 'user' },
        { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal }
      ) as string;

      expect(result).toContain('listUsers');
      expect(result).toContain('getUser');
      expect(result).toContain('createUser');
    });

    it('execute tool can call a real API endpoint', async () => {
      const tools = await createTools({ spec: SAMPLE_SPEC, codeMode: true });
      const executeTool = tools['execute'];
      const exec = 'execute' in executeTool ? executeTool.execute : undefined;

      const result = await exec!(
        { code: 'getUser(id=1)' },
        { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal }
      );

      // Monty returns Python dicts as JS Maps,       
      expect(result["id"]).toBe(1);
      expect(result["name"]).toBeDefined();
    });
  });
});
