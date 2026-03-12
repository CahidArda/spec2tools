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

export interface Spec2ToolsOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
}

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
 * @throws Error if the API requires authentication
 */
export async function createTools(options: Spec2ToolsOptions): Promise<ServerTool[]> {
  const spec = await loadOpenAPISpec(options.spec);
  const baseUrl = extractBaseUrl(spec);
  const authConfig = extractAuthConfig(spec);

  if (authConfig.type !== 'none') {
    throw new Error(
      `This API requires authentication (${authConfig.type}). ` +
      `The createTools() function only supports APIs without authentication. ` +
      `Use the CLI for authenticated APIs: npx @spec2tools/cli start --spec ${options.spec}`
    );
  }

  const toolDefs = parseOperations(spec);
  const authManager = new AuthManager(authConfig);
  const tools = createExecutableTools(toolDefs, baseUrl, authManager);

  return tools.map((t) => {
    const inputSchema = zodToJsonSchema(t.parameters) as JSONSchema;
    return toolDefinition({
      name: t.name,
      description: t.description,
      inputSchema,
    }).server(async (params) => {
      return t.execute(params);
    });
  });
}
