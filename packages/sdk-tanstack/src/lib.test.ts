import { describe, it, expect } from 'vitest';
import { createTools } from './lib.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_SPEC = path.resolve(__dirname, '../../cli/examples/sample-api.yaml');

describe('createTools', () => {
  it('returns an array with one tool per operation', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const names = tools.map((t) => t.name);

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

  it('each tool has name, description, inputSchema, and execute', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });

    for (const tool of tools) {
      expect(tool.name, `${tool.name} missing name`).toBeTruthy();
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} missing inputSchema`).toBeDefined();
      expect(tool.execute, `${tool.name} missing execute`).toBeDefined();
    }
  });

  it('tools are marked as server-side', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });

    for (const tool of tools) {
      expect((tool as { __toolSide: string }).__toolSide).toBe('server');
    }
  });

  it('can execute getUser and receive a response', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const getUser = tools.find((t) => t.name === 'getUser');

    expect(getUser).toBeDefined();
    const result = await getUser!.execute!({ id: 1 }) as Record<string, unknown>;

    expect(result).toHaveProperty('id', 1);
    expect(result).toHaveProperty('name');
  });

  it('can execute listUsers with query params', async () => {
    const tools = await createTools({ spec: SAMPLE_SPEC });
    const listUsers = tools.find((t) => t.name === 'listUsers');

    expect(listUsers).toBeDefined();
    const result = await listUsers!.execute!({ _limit: 2 }) as unknown[];

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(2);
  });
});
