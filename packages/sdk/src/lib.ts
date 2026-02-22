import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  createExecutableTools,
  toAISDKTools,
  toCodeModeTools,
  AuthManager,
  type ToolSet,
} from '@spec2tools/core';

/**
 * Convert an existing AI SDK ToolSet into code mode (2 tools: search + execute).
 *
 * Useful when you already have tools from another source (e.g. `createMCPClient`)
 * and want to reduce token usage by collapsing them into code mode.
 *
 * @example
 * ```ts
 * import { createMCPClient } from '@ai-sdk/mcp';
 * import { convertToolsToCodeMode } from '@spec2tools/sdk';
 *
 * const client = await createMCPClient({
 *   transport: { type: 'sse', url: 'http://localhost:3000/sse' },
 * });
 * const tools = await client.tools();
 * const codeModeTools = convertToolsToCodeMode(tools);
 * ```
 */
export const convertToolsToCodeMode: typeof toCodeModeTools = toCodeModeTools;

export interface Spec2ToolsOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
  /** Use code mode (2 tools: search + execute) instead of one tool per endpoint */
  codeMode?: boolean;
}

/**
 * Create AI SDK tools from an OpenAPI specification.
 *
 * @example
 * ```ts
 * import { createTools } from '@spec2tools/sdk';
 * import { generateText } from 'ai';
 * import { openai } from '@ai-sdk/openai';
 *
 * const tools = await createTools({ spec: './openapi.yaml' });
 *
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   tools,
 *   prompt: 'List all users',
 * });
 * ```
 *
 * @throws Error if the API requires authentication (unless codeMode is enabled)
 */
export async function createTools(
  options: Spec2ToolsOptions
): Promise<ToolSet> {
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
  let aiTools = toAISDKTools(tools);

  if (options.codeMode) {
    aiTools = toCodeModeTools(aiTools);
  }

  return aiTools;
}
