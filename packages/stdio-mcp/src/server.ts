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
  Tool,
  AuthConfig,
  createExecutableTools,
} from '@spec2tools/core';

export interface McpServerOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
  /** Server name for MCP */
  name?: string;
  /** Server version for MCP */
  version?: string;
  /** API key or token for authentication */
  apiKey?: string;
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
  const { spec: specPath, name = 'openapi-mcp-server', version = '0.1.0' } = options;

  // Load and parse OpenAPI spec
  const spec = await loadOpenAPISpec(specPath);
  const baseUrl = extractBaseUrl(spec);
  const authConfig = extractAuthConfig(spec);

  // Set up auth manager
  const authManager = new AuthManager(authConfig);
  configureAuth(authManager, authConfig, options);

  // Parse operations into tool definitions and create executable tools
  const toolDefs = parseOperations(spec);
  const tools = createExecutableTools(toolDefs, baseUrl, authManager);

  // Create MCP server
  const server = new Server(
    { name, version },
    { capabilities: { tools: { listChanged: false } } }
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.parameters, { target: 'jsonSchema7' }),
      })),
    };
  });

  // Register tool execution handler
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name: toolName, arguments: args } = request.params;
    const tool = tools.find((t) => t.name === toolName);

    if (!tool) {
      return {
        content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
        isError: true,
      };
    }

    try {
      const result = await tool.execute(args ?? {});
      const resultText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text: resultText }],
      };
    } catch (error) {
      let errorMessage: string;
      if (error instanceof Error) {
        errorMessage = error.message;
        // Include stack trace for debugging if available
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

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Configure authentication from options or environment variables
 */
function configureAuth(
  authManager: AuthManager,
  authConfig: AuthConfig,
  options: McpServerOptions
): void {
  // Check for explicit option first, then fall back to environment variable
  const apiKey = options.apiKey || process.env.API_KEY;

  // Set the API key if provided, regardless of auth type
  if (apiKey) {
    authManager.setAccessToken(apiKey);
  }
}
