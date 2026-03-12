import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  createExecutableTools,
  AuthManager,
} from '@spec2tools/core';
import { toolDefinition, type ServerTool, type JSONSchema } from '@tanstack/ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import {
  Monty,
  MontySnapshot,
  MontyComplete,
  MontyRuntimeError,
  MontySyntaxError,
  MontyTypingError,
} from '@pydantic/monty';

export interface Spec2ToolsOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
  /** Use code mode (2 tools: search + execute) instead of one tool per endpoint */
  codeMode?: boolean;
}

// ─── Code Mode ───────────────────────────────────────────────────────────────

interface ToolIndexEntry {
  originalName: string;
  pyName: string;
  description: string;
  signature: string;
  example: string;
  searchText: string;
}

function toPythonName(name: string): string {
  let py = name.replace(/[^a-zA-Z0-9_]/g, '_');
  if (/^[0-9]/.test(py)) py = `_${py}`;
  return py || '_unnamed';
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

function buildIndex(tools: ServerTool[]): ToolIndexEntry[] {
  const index: ToolIndexEntry[] = [];

  for (const t of tools) {
    const pyName = toPythonName(t.name);
    const description = t.description ?? '';
    const params: { name: string; type: string; required: boolean }[] = [];

    try {
      const schema = t.inputSchema as JSONSchema | undefined;
      if (schema && typeof schema === 'object' && schema.properties) {
        const required = new Set<string>(
          Array.isArray(schema.required) ? (schema.required as string[]) : []
        );
        for (const [pName, pSchema] of Object.entries(schema.properties)) {
          params.push({
            name: pName,
            type: jsonSchemaTypeToPython(pSchema as Record<string, unknown>),
            required: required.has(pName),
          });
        }
      }
    } catch {
      // Cannot introspect schema; proceed with empty params
    }

    const paramStrs = params.map((p) =>
      p.required ? `${p.name}: ${p.type}` : `${p.name}: ${p.type} = None`
    );
    const signature = `${pyName}(${paramStrs.join(', ')})`;

    const exampleParams = params
      .filter((p) => p.required)
      .slice(0, 2)
      .map((p) => {
        if (p.type === 'str') return `${p.name}="..."`;
        if (p.type === 'int' || p.type === 'float') return `${p.name}=1`;
        if (p.type === 'bool') return `${p.name}=True`;
        return `${p.name}=...`;
      });
    const example = `${pyName}(${exampleParams.join(', ')})`;

    index.push({
      originalName: t.name,
      pyName,
      description,
      signature,
      example,
      searchText: `${t.name} ${pyName} ${description}`.toLowerCase(),
    });
  }

  return index;
}

function montyToJson(value: unknown): unknown {
  if (value instanceof Map) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of value) {
      obj[String(k)] = montyToJson(v);
    }
    return obj;
  }
  if (Array.isArray(value)) {
    return value.map(montyToJson);
  }
  return value;
}

/**
 * Convert an existing TanStack AI ServerTool array into code mode
 * (2 tools: `search` + `execute`).
 *
 * Useful when you already have tools from another source and want to reduce
 * token usage by collapsing them into code mode.
 *
 * @example
 * ```ts
 * import { createTools, convertToolsToCodeMode } from '@spec2tools/sdk-tanstack';
 *
 * const tools = await createTools({ spec: './openapi.yaml' });
 * const codeModeTools = convertToolsToCodeMode(tools);
 * ```
 */
export function convertToolsToCodeMode(tools: ServerTool[]): ServerTool[] {
  const index = buildIndex(tools);

  const pyToOriginal = new Map<string, string>();
  for (const entry of index) {
    pyToOriginal.set(entry.pyName, entry.originalName);
  }
  const pythonNames = [...pyToOriginal.keys()];

  const toolMap = new Map(tools.map((t) => [t.name, t]));

  const searchTool = toolDefinition({
    name: 'search',
    description:
      'Search for available API endpoints by keyword. Returns matching ' +
      'function signatures with parameter types and usage examples. ' +
      'Use this to discover what functions are available before writing code.',
    inputSchema: zodToJsonSchema(
      z.object({
        query: z
          .string()
          .describe('Keywords to search for in endpoint names and descriptions'),
      })
    ) as JSONSchema,
  }).server(async (args) => {
    const { query } = args as { query: string };
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = index.filter((entry) =>
      keywords.some((kw) => entry.searchText.includes(kw))
    );
    if (matches.length === 0) {
      return `No endpoints found matching "${query}". Try different keywords.`;
    }
    return matches
      .map((m) => `${m.signature}\n  ${m.description}\n  Example: ${m.example}`)
      .join('\n\n');
  });

  const executeTool = toolDefinition({
    name: 'execute',
    description:
      'Execute Python code that calls API endpoints. Functions discovered ' +
      'via search are available to call directly. Always use keyword arguments.\n' +
      'Example:\n' +
      '  users = listUsers(limit=10)\n' +
      '  user = getUser(id="123")\n' +
      '  users',
    inputSchema: zodToJsonSchema(
      z.object({
        code: z
          .string()
          .describe(
            'Python code to execute. Use keyword arguments when calling API functions.'
          ),
      })
    ) as JSONSchema,
  }).server(async (args) => {
    const { code } = args as { code: string };
    try {
      const m = new Monty(code, { externalFunctions: pythonNames });
      let progress: MontySnapshot | MontyComplete = m.start({
        limits: { maxDurationSecs: 30 },
      });

      while (progress instanceof MontySnapshot) {
        const snapshot = progress;
        const originalName = pyToOriginal.get(snapshot.functionName);
        const serverTool = originalName ? toolMap.get(originalName) : undefined;

        if (!serverTool?.execute) {
          progress = snapshot.resume({
            exception: {
              type: 'ValueError',
              message: `Unknown function: ${snapshot.functionName}`,
            },
          });
          continue;
        }

        try {
          const result = await serverTool.execute(
            snapshot.kwargs as Record<string, unknown>
          );
          progress = snapshot.resume({ returnValue: result });
        } catch (error) {
          progress = snapshot.resume({
            exception: {
              type: 'RuntimeError',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }

      return montyToJson((progress as MontyComplete).output);
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
  });

  return [searchTool, executeTool];
}

// ─── createTools ─────────────────────────────────────────────────────────────

/**
 * Create TanStack AI server tools from an OpenAPI specification.
 *
 * Each OpenAPI operation is converted into a TanStack AI `ServerTool` that can
 * be passed directly to `chat()` from `@tanstack/ai`.
 *
 * @example
 * ```ts
 * import { createTools } from '@spec2tools/sdk-tanstack';
 * import { chat, toServerSentEventsResponse } from '@tanstack/ai';
 * import { openai } from '@tanstack/ai-openai';
 *
 * const tools = await createTools({ spec: './openapi.yaml' });
 *
 * const stream = chat({
 *   adapter: openai(),
 *   model: 'gpt-4o',
 *   messages,
 *   tools,
 * });
 *
 * return toServerSentEventsResponse(stream);
 * ```
 *
 * @throws Error if the API requires authentication (unless codeMode is enabled)
 */
export async function createTools(
  options: Spec2ToolsOptions
): Promise<ServerTool[]> {
  const spec = await loadOpenAPISpec(options.spec);
  const baseUrl = extractBaseUrl(spec);
  const authConfig = extractAuthConfig(spec);

  // Check if auth is required (skip in code mode — auth is handled internally)
  if (!options.codeMode && authConfig.type !== 'none') {
    throw new Error(
      `This API requires authentication (${authConfig.type}). ` +
      `The createTools() function only supports APIs without authentication. ` +
      `Use the CLI for authenticated APIs: npx @spec2tools/cli start --spec ${options.spec}`
    );
  }

  const toolDefs = parseOperations(spec);
  const authManager = new AuthManager(authConfig);
  const tools = createExecutableTools(toolDefs, baseUrl, authManager);

  const serverTools = tools.map((t) => {
    const inputSchema = zodToJsonSchema(t.parameters) as JSONSchema;
    return toolDefinition({
      name: t.name,
      description: t.description,
      inputSchema,
    }).server(async (params) => {
      return t.execute(params);
    });
  });

  if (options.codeMode) {
    return convertToolsToCodeMode(serverTools);
  }

  return serverTools;
}
