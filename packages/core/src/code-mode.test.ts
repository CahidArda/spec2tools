import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { tool } from 'ai';
import { toCodeModeTools } from './code-mode.js';

type ToolSet = ReturnType<typeof toCodeModeTools>;

function makeToolSet(): ToolSet {
  return {
    listUsers: tool({
      description: 'List all users',
      inputSchema: z.object({
        limit: z.number().optional().describe('Max results'),
        offset: z.number().optional().describe('Pagination offset'),
      }),
      execute: vi.fn().mockResolvedValue([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ]),
    }),
    getUser: tool({
      description: 'Get user by ID',
      inputSchema: z.object({
        id: z.string().describe('User ID'),
      }),
      execute: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }),
    }),
    createPost: tool({
      description: 'Create a blog post',
      inputSchema: z.object({
        title: z.string().describe('Post title'),
        body: z.string().describe('Post body'),
      }),
      execute: vi.fn().mockResolvedValue({ id: '99', title: 'Hello' }),
    }),
  };
}

describe('toCodeModeTools', () => {
  it('returns exactly 2 tools: search and execute', () => {
    const result = toCodeModeTools(makeToolSet());
    expect(Object.keys(result).sort()).toEqual(['execute', 'search']);
  });

  describe('search tool', () => {
    async function search(query: string): Promise<string> {
      const result = toCodeModeTools(makeToolSet());
      const searchTool = result['search'];
      const exec = 'execute' in searchTool ? searchTool.execute : undefined;
      return (await exec!({ query }, { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal })) as string;
    }

    it('finds tools by name keyword', async () => {
      const output = await search('user');
      expect(output).toContain('listUsers');
      expect(output).toContain('getUser');
    });

    it('finds tools by description keyword', async () => {
      const output = await search('blog');
      expect(output).toContain('createPost');
      expect(output).not.toContain('listUsers');
    });

    it('returns no-match message for unknown keywords', async () => {
      const output = await search('zzzzzzz');
      expect(output).toContain('No endpoints found');
    });

    it('returns Python-style signatures with types', async () => {
      const output = await search('getUser');
      expect(output).toContain('id: str');
    });

    it('marks optional params with = None', async () => {
      const output = await search('listUsers');
      expect(output).toContain('limit: float = None');
    });

    it('includes example calls for required params', async () => {
      const output = await search('createPost');
      expect(output).toContain('Example:');
      expect(output).toContain('title="..."');
    });
  });

  describe('execute tool', () => {
    async function execute(code: string, toolSet?: ToolSet): Promise<unknown> {
      const ts = toolSet ?? makeToolSet();
      const result = toCodeModeTools(ts);
      const executeTool = result['execute'];
      const exec = 'execute' in executeTool ? executeTool.execute : undefined;
      return exec!({ code }, { toolCallId: 'x', messages: [], abortSignal: new AbortController().signal });
    }

    it('executes simple Python expressions', async () => {
      const output = await execute('1 + 2');
      expect(output).toBe(3);
    });

    it('calls an external tool function with kwargs', async () => {
      const ts = makeToolSet();
      const output = await execute('getUser(id="42")', ts);

      const getUserExec = ts.getUser;
      const mockFn = 'execute' in getUserExec ? getUserExec.execute : undefined;
      expect(mockFn).toHaveBeenCalledWith({ id: '42' }, {});

      // Monty dicts are converted to plain JS objects for JSON compatibility
      expect(output).toEqual({ id: '1', name: 'Alice' });
    });

    it('chains multiple tool calls', async () => {
      const ts = makeToolSet();
      await execute(
        `users = listUsers(limit=10)
user = getUser(id="1")
user`,
        ts
      );

      const listExec = ts.listUsers;
      const getExec = ts.getUser;
      expect('execute' in listExec && listExec.execute).toHaveBeenCalled();
      expect('execute' in getExec && getExec.execute).toHaveBeenCalled();
    });

    it('returns syntax error for invalid Python', async () => {
      const output = await execute('def +++');
      expect(output).toContain('Syntax Error');
    });

    it('returns runtime error when tool execution fails', async () => {
      const ts = makeToolSet();
      const getUserTool = ts.getUser;
      if ('execute' in getUserTool && getUserTool.execute) {
        (getUserTool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
          new Error('Not found')
        );
      }

      const output = await execute('getUser(id="bad")', ts);
      expect(output).toContain('Runtime Error');
      expect(output).toContain('Not found');
    });

    it('handles tool that returns a string', async () => {
      const ts: ToolSet = {
        echo: tool({
          description: 'Echo',
          inputSchema: z.object({ msg: z.string() }),
          execute: vi.fn().mockResolvedValue('hello world'),
        }),
      };

      const output = await execute('echo(msg="hi")', ts);
      expect(output).toBe('hello world');
    });

    it('handles pure computation without external calls', async () => {
      const output = await execute('[i * 2 for i in range(5)]');
      expect(output).toEqual([0, 2, 4, 6, 8]);
    });
  });
});
