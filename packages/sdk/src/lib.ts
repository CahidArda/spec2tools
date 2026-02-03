import { tool, generateText } from 'ai';
import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  AuthManager,
  ToolExecutionError,
} from '@spec2tools/core';

type ToolSet = NonNullable<Parameters<typeof generateText>[0]['tools']>;

export interface Spec2ToolsOptions {
  /** Path or URL to OpenAPI specification */
  spec: string;
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
 * @throws Error if the API requires authentication
 */
export async function createTools(
  options: Spec2ToolsOptions
): Promise<ToolSet> {
  const spec = await loadOpenAPISpec(options.spec);
  const baseUrl = extractBaseUrl(spec);
  const authConfig = extractAuthConfig(spec);

  // Check if auth is required
  if (authConfig.type !== 'none') {
    throw new Error(
      `This API requires authentication (${authConfig.type}). ` +
      `The createTools() function only supports APIs without authentication. ` +
      `Use the CLI for authenticated APIs: npx @spec2tools/cli start --spec ${options.spec}`
    );
  }

  const toolDefs = parseOperations(spec);
  const authManager = new AuthManager(authConfig);

  // Build AI SDK tools
  const tools: ToolSet = {};

  for (const toolDef of toolDefs) {
    const { name, description, parameters, httpMethod, path } = toolDef;

    tools[name] = tool({
      description,
      inputSchema: parameters,
      execute: async (params: Record<string, unknown>) => {
        // Build URL with path parameters
        let url = `${baseUrl}${path}`;
        const queryParams: Record<string, string> = {};
        const bodyParams: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(params)) {
          if (value === undefined) continue;

          if (url.includes(`{${key}}`)) {
            // Path parameter
            url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
          } else if (httpMethod === 'GET' || httpMethod === 'DELETE') {
            // Query parameter for GET/DELETE
            queryParams[key] = String(value);
          } else {
            // Body parameter for POST/PUT/PATCH
            bodyParams[key] = value;
          }
        }

        // Add query parameters
        const queryString = new URLSearchParams(queryParams).toString();
        if (queryString) {
          url += `?${queryString}`;
        }

        // Build request options
        const fetchOptions: RequestInit = {
          method: httpMethod,
          headers: {
            'Content-Type': 'application/json',
            ...authManager.getAuthHeaders(),
          },
        };

        // Add body for non-GET/DELETE requests
        if (
          Object.keys(bodyParams).length > 0 &&
          httpMethod !== 'GET' &&
          httpMethod !== 'DELETE'
        ) {
          fetchOptions.body = JSON.stringify(bodyParams);
        }

        const response = await fetch(url, fetchOptions);

        if (!response.ok) {
          const errorText = await response.text();
          throw new ToolExecutionError(
            name,
            new Error(`HTTP ${response.status}: ${errorText}`)
          );
        }

        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      },
    });
  }

  return tools;
}
