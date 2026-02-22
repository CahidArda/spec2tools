import { tool, generateText } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  Monty,
  MontySnapshot,
  MontyComplete,
  MontyRuntimeError,
  MontySyntaxError,
  MontyTypingError,
} from '@pydantic/monty';

type ToolSet = NonNullable<Parameters<typeof generateText>[0]['tools']>;

interface ToolIndexEntry {
  name: string;
  description: string;
  signature: string;
  example: string;
  searchText: string;
}

function jsonSchemaTypeToPython(schema: Record<string, unknown>): string {
  if (!schema) return 'any';
  const type = schema.type as string | undefined;
  if (type === 'string') return 'str';
  if (type === 'integer') return 'int';
  if (type === 'number') return 'float';
  if (type === 'boolean') return 'bool';
  if (type === 'array') return 'list';
  if (type === 'object') return 'dict';
  if (schema.enum) return 'str';
  return 'any';
}

function buildIndex(tools: ToolSet): ToolIndexEntry[] {
  const index: ToolIndexEntry[] = [];

  for (const [name, t] of Object.entries(tools)) {
    const description =
      'description' in t ? ((t.description as string) || '') : '';

    const params: { name: string; type: string; required: boolean }[] = [];

    try {
      const parameters =
        'parameters' in t ? (t.parameters as unknown) : null;
      if (
        parameters &&
        typeof parameters === 'object' &&
        '_def' in (parameters as Record<string, unknown>)
      ) {
        const jsonSchema = zodToJsonSchema(parameters as z.ZodType, {
          target: 'jsonSchema7',
        }) as Record<string, unknown>;
        const properties =
          (jsonSchema.properties as Record<string, Record<string, unknown>>) ||
          {};
        const required = new Set(
          (jsonSchema.required as string[] | undefined) || []
        );

        for (const [pName, pSchema] of Object.entries(properties)) {
          params.push({
            name: pName,
            type: jsonSchemaTypeToPython(pSchema),
            required: required.has(pName),
          });
        }
      }
    } catch {
      // Cannot introspect schema; proceed with empty params
    }

    const paramStrs = params.map((p) => {
      if (p.required) return `${p.name}: ${p.type}`;
      return `${p.name}: ${p.type} = None`;
    });
    const signature = `${name}(${paramStrs.join(', ')})`;

    const exampleParams = params
      .filter((p) => p.required)
      .slice(0, 2)
      .map((p) => {
        if (p.type === 'str') return `${p.name}="..."`;
        if (p.type === 'int' || p.type === 'float') return `${p.name}=1`;
        if (p.type === 'bool') return `${p.name}=True`;
        return `${p.name}=...`;
      });
    const example = `${name}(${exampleParams.join(', ')})`;

    index.push({
      name,
      description,
      signature,
      example,
      searchText: `${name} ${description}`.toLowerCase(),
    });
  }

  return index;
}

/**
 * Transform an AI SDK ToolSet into exactly 2 code-mode tools: `search` and `execute`.
 *
 * The model discovers endpoints via keyword search and calls them by writing
 * Python code that is executed in a sandboxed Monty interpreter. This reduces
 * token consumption by ~99.9% for large APIs (N tools → 2 tools).
 */
export function toCodeModeTools(tools: ToolSet): ToolSet {
  const index = buildIndex(tools);
  const toolNames = Object.keys(tools);

  const searchTool = tool({
    description:
      'Search for available API endpoints by keyword. Returns matching ' +
      'function signatures with parameter types and usage examples. ' +
      'Use this to discover what functions are available before writing code.',
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          'Keywords to search for in endpoint names and descriptions'
        ),
    }),
    execute: async ({ query }) => {
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);

      const matches = index.filter((entry) =>
        keywords.some((kw) => entry.searchText.includes(kw))
      );

      if (matches.length === 0) {
        return `No endpoints found matching "${query}". Try different keywords.`;
      }

      return matches
        .map(
          (m) =>
            `${m.signature}\n  ${m.description}\n  Example: ${m.example}`
        )
        .join('\n\n');
    },
  });

  const executeTool = tool({
    description:
      'Execute Python code that calls API endpoints. Functions discovered ' +
      'via search are available to call directly. Always use keyword arguments.\n' +
      'Example:\n' +
      '  users = listUsers(limit=10)\n' +
      '  user = getUser(id="123")\n' +
      '  users',
    inputSchema: z.object({
      code: z
        .string()
        .describe(
          'Python code to execute. Use keyword arguments when calling API functions.'
        ),
    }),
    execute: async ({ code }) => {
      try {
        const m = new Monty(code, { externalFunctions: toolNames });
        let progress: MontySnapshot | MontyComplete = m.start({
          limits: { maxDurationSecs: 30 },
        });

        while (progress instanceof MontySnapshot) {
          const snapshot = progress;
          const toolEntry = tools[snapshot.functionName];

          if (
            !toolEntry ||
            !('execute' in toolEntry) ||
            !toolEntry.execute
          ) {
            // Should not happen since all tool names are registered,
            // but handle gracefully
            progress = snapshot.resume({
              exception: {
                type: 'ValueError',
                message: `Unknown function: ${snapshot.functionName}`,
              },
            });
            continue;
          }

          const params: Record<string, unknown> = {
            ...(snapshot.kwargs as Record<string, unknown>),
          };

          try {
            const result = await (
              toolEntry.execute as (
                params: unknown,
                options: unknown
              ) => Promise<unknown>
            )(params, {});
            progress = snapshot.resume({ returnValue: result });
          } catch (error) {
            progress = snapshot.resume({
              exception: {
                type: 'RuntimeError',
                message:
                  error instanceof Error ? error.message : String(error),
              },
            });
          }
        }

        return (progress as MontyComplete).output;
      } catch (error) {
        if (error instanceof MontySyntaxError) {
          return `Syntax Error: ${error.message}`;
        }
        if (error instanceof MontyRuntimeError) {
          return `Runtime Error: ${error.message}\n${error.traceback()}`;
        }
        if (error instanceof MontyTypingError) {
          return `Type Error: ${error.displayDiagnostics()}`;
        }
        return `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });

  return {
    search: searchTool,
    execute: executeTool,
  };
}
