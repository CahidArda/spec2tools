import { z } from 'zod';
import { Tool, HttpMethod, AuthConfig, ParameterMetadata } from './types.js';
import { ToolExecutionError } from './errors.js';
import { AuthManager } from './auth-manager.js';

interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  httpMethod: HttpMethod;
  path: string;
  authConfig?: AuthConfig;
  parameterMetadata?: ParameterMetadata;
}

/**
 * Create executable tools from tool definitions
 */
export function createExecutableTools(
  toolDefs: ToolDefinition[],
  baseUrl: string,
  authManager: AuthManager
): Tool[] {
  return toolDefs.map((def) => ({
    ...def,
    execute: createExecutor(def, baseUrl, authManager),
  }));
}

/**
 * Create an executor function for a tool
 */
function createExecutor(
  tool: ToolDefinition,
  baseUrl: string,
  authManager: AuthManager
): (params: unknown) => Promise<unknown> {
  return async (params: unknown): Promise<unknown> => {
    try {
      // Validate parameters
      const validatedParams = tool.parameters.parse(params);

      // Build URL with path parameters replaced
      let url = buildUrl(baseUrl, tool.path, validatedParams);

      // Separate path, query, and body parameters using metadata
      const { queryParams, bodyParams } = separateParams(
        validatedParams,
        tool.parameterMetadata
      );

      // Add query parameters
      const urlObj = new URL(url);
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          urlObj.searchParams.set(key, String(value));
        }
      }

      // Check if this tool requires auth (respects operation-level security)
      // Tool-level authConfig overrides the global authConfig
      const toolRequiresAuth = authManager.requiresAuth(tool.authConfig);

      // Add auth query params if needed
      if (toolRequiresAuth) {
        const authQueryParams = authManager.getAuthQueryParams(tool.authConfig);
        for (const [key, value] of Object.entries(authQueryParams)) {
          urlObj.searchParams.set(key, value);
        }
      }

      url = urlObj.toString();

      // Build request options
      const headers: Record<string, string> = {
        ...(toolRequiresAuth ? authManager.getAuthHeaders(tool.authConfig) : {}),
      };

      const fetchOptions: RequestInit = {
        method: tool.httpMethod,
        headers,
      };

      // Add body for methods that support it
      if (['POST', 'PUT', 'PATCH'].includes(tool.httpMethod)) {
        if (Object.keys(bodyParams).length > 0) {
          headers['Content-Type'] = 'application/json';
          fetchOptions.body = JSON.stringify(bodyParams);
        }
      }

      fetchOptions.headers = headers;

      // Execute request
      const response = await fetch(url, fetchOptions);

      // Parse response
      const contentType = response.headers.get('content-type') || '';

      let responseData: unknown;

      if (contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        // Build detailed error message
        const errorDetails = [
          `HTTP ${response.status} ${response.statusText}`,
          `URL: ${tool.httpMethod} ${url}`,
          `Response: ${typeof responseData === 'string' ? responseData : JSON.stringify(responseData, null, 2)}`
        ];

        // Add helpful context for common errors
        if (response.status === 401) {
          errorDetails.push('Authentication failed. Check your API key/token.');
        } else if (response.status === 403) {
          errorDetails.push('Access forbidden. Verify your permissions.');
        } else if (response.status === 404) {
          errorDetails.push('Resource not found.');
        } else if (response.status === 429) {
          errorDetails.push('Rate limit exceeded. Try again later.');
        } else if (response.status >= 500) {
          errorDetails.push('Server error. The API service may be experiencing issues.');
        }

        throw new Error(errorDetails.join('\n'));
      }

      return responseData;
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ToolExecutionError(
          tool.name,
          new Error(`Invalid parameters: ${error.message}`)
        );
      }
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      throw new ToolExecutionError(
        tool.name,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  };
}

/**
 * Build URL with path parameters replaced
 */
function buildUrl(
  baseUrl: string,
  path: string,
  params: Record<string, unknown>
): string {
  let finalPath = path;

  // Replace path parameters
  const pathParamRegex = /\{(\w+)\}/g;
  let match;

  while ((match = pathParamRegex.exec(path)) !== null) {
    const paramName = match[1];
    const paramValue = params[paramName];

    if (paramValue !== undefined) {
      finalPath = finalPath.replace(
        `{${paramName}}`,
        encodeURIComponent(String(paramValue))
      );
    }
  }

  return `${baseUrl}${finalPath}`;
}

/**
 * Separate parameters into path, query, and body params using metadata
 */
function separateParams(
  params: Record<string, unknown>,
  metadata?: ParameterMetadata
): { pathParams: Record<string, unknown>; queryParams: Record<string, unknown>; bodyParams: Record<string, unknown> } {
  const pathParams: Record<string, unknown> = {};
  const queryParams: Record<string, unknown> = {};
  const bodyParams: Record<string, unknown> = {};

  // If we have metadata, use it to categorize parameters
  if (metadata) {
    for (const [key, value] of Object.entries(params)) {
      if (metadata.pathParams.has(key)) {
        pathParams[key] = value;
      } else if (metadata.queryParams.has(key)) {
        queryParams[key] = value;
      } else if (metadata.bodyParams.has(key)) {
        bodyParams[key] = value;
      } else {
        // Fallback: if not in metadata, treat as body param
        bodyParams[key] = value;
      }
    }
  } else {
    // Fallback to old behavior if no metadata (shouldn't happen with new parser)
    // This keeps backward compatibility
    const pathParamNames = extractPathParamNames(params);
    
    for (const [key, value] of Object.entries(params)) {
      if (pathParamNames.has(key)) {
        pathParams[key] = value;
      } else if (isPrimitive(value)) {
        queryParams[key] = value;
      } else {
        bodyParams[key] = value;
      }
    }
  }

  return { pathParams, queryParams, bodyParams };
}

/**
 * Extract path parameter names from params (fallback)
 */
function extractPathParamNames(params: Record<string, unknown>): Set<string> {
  // This is a fallback - in practice, metadata should always be provided
  return new Set<string>();
}

/**
 * Check if value is a primitive type
 */
function isPrimitive(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

/**
 * Execute a tool directly by name
 */
export async function executeToolByName(
  tools: Tool[],
  toolName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    throw new Error(`Tool not found: ${toolName}`);
  }

  return tool.execute(params);
}
