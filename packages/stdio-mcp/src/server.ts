import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  AuthManager,
  type AuthConfig,
  type ToolSet,
  createExecutableTools,
  toAISDKTools,
  toCodeModeTools,
} from '@spec2tools/core';
import { createMCPClient, MCPClientConfig } from '@ai-sdk/mcp';

export interface McpServerOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
  /** Server name for MCP */
  name?: string;
  /** Server version for MCP */
  version?: string;
  /** API key or token for authentication */
  apiKey?: string;
  /** Use code mode (2 tools: search + execute) */
  codeMode?: boolean;
  /** URL of a remote MCP server (Streamable HTTP transport) */
  httpUrl?: string;
  /** URL of a remote MCP server (SSE transport) */
  sseUrl?: string;
}

/**
 * Create and start an MCP server that exposes OpenAPI operations as tools.
 *
 * @example
 * ```ts
 * import { startMcpServer } from '@spec2tools/stdio-mcp';
 *
 * await startMcpServer({
 *   spec: './openapi.yaml',
 *   name: 'my-api-server',
 * });
 * ```
 */
export async function startMcpServer(options: McpServerOptions): Promise<void> {
  const { name = 'openapi-mcp-server', version = '0.1.0' } = options;

  let tools: ToolSet;
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;

  if (options.httpUrl || options.sseUrl) {
    // Remote MCP proxy mode: connect to an existing MCP server
    const transport: MCPClientConfig["transport"] = options.httpUrl
      ? { type: 'http' as const, url: options.httpUrl, headers: { Authorization: `Bearer ${options.apiKey || ''}` } }
      : { type: 'sse' as const, url: options.sseUrl!, headers: { Authorization: `Bearer ${options.apiKey || ''}` } };

    mcpClient = await createMCPClient({ transport });
    // TODO: remove the double cast. it was added to fix a "Type instantiation is excessively deep and possibly infinite" error
    tools = await mcpClient.tools() as unknown as ToolSet;

    if (options.codeMode) {
      tools = toCodeModeTools(tools);
    }
  } else {
    // OpenAPI spec mode: load spec and create tools
    const spec = await loadOpenAPISpec(options.spec);
    const baseUrl = extractBaseUrl(spec);
    const authConfig = extractAuthConfig(spec);

    const authManager = new AuthManager(authConfig);
    configureAuth(authManager, authConfig, options);

    const toolDefs = parseOperations(spec);
    const coreTools = createExecutableTools(toolDefs, baseUrl, authManager);

    tools = toAISDKTools(coreTools);
    if (options.codeMode) {
      tools = toCodeModeTools(tools);
    }
  }

  // Create MCP server
  const server = new Server(
    { name, version },
    { capabilities: { tools: { listChanged: false } } }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: Object.entries(tools).map(([toolName, t]) => {
        const description = 'description' in t ? (t.description as string) || '' : '';
        const schema =
          ('inputSchema' in t ? t.inputSchema : undefined) ??
          ('parameters' in t ? t.parameters : undefined);

        let inputSchema: Record<string, unknown> = { type: 'object', properties: {} };
        if (schema && typeof schema === 'object') {
          const schemaObj = schema as Record<string, unknown>;
          if ('jsonSchema' in schemaObj && schemaObj.jsonSchema) {
            inputSchema = schemaObj.jsonSchema as Record<string, unknown>;
          } else if ('_def' in schemaObj) {
            inputSchema = zodToJsonSchema(schema as import('zod/v3').ZodType, { target: 'jsonSchema7' }) as Record<string, unknown>;
          }
        }

        return {
          name: toolName,
          description,
          inputSchema,
        };
      }),
    };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name: toolName, arguments: args } = request.params;
    const toolEntry = tools[toolName];

    if (!toolEntry) {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
        isError: true,
      };
    }

    try {
      const execute = 'execute' in toolEntry ? toolEntry.execute : undefined;
      if (!execute) {
        return {
          content: [{ type: 'text', text: `Error: Tool "${toolName}" has no execute function` }],
          isError: true,
        };
      }

      const result = await (execute as (params: unknown, options: unknown) => Promise<unknown>)(args ?? {}, {});
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text: resultText }],
      };
    } catch (error) {
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
        if (error.stack) {
          errorMessage += `\n\nStack trace:\n${error.stack}`;
        }
      } else {
        errorMessage = String(error);
      }
      return {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  });

  // Clean up remote MCP client on process exit
  if (mcpClient) {
    const cleanup = async () => {
      await mcpClient!.close();
    };
    process.on('SIGINT', () => { cleanup().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { cleanup().then(() => process.exit(0)); });
  }

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Configure authentication from options or environment variables
 */
function configureAuth(
  authManager: AuthManager,
  _authConfig: AuthConfig,
  options: McpServerOptions
): void {
  // Check for explicit option first, then fall back to environment variable
  const apiKey = options.apiKey || process.env.API_KEY;

  // Set the API key if provided, regardless of auth type
  if (apiKey) {
    authManager.setAccessToken(apiKey);
  }
}
