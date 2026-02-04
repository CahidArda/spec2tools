import { z } from 'zod';
import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  OpenAPISpec,
  SchemaObject,
  Operation,
  Parameter,
  PathItem,
  HttpMethod,
  Tool,
  AuthConfig,
  SecurityScheme,
} from './types.js';
import { UnsupportedSchemaError, SpecLoadError } from './errors.js';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Fetch and parse an OpenAPI specification from URL or file path
 */
export async function loadOpenAPISpec(specPath: string): Promise<OpenAPISpec> {
  let content: string;

  if (specPath.startsWith('http://') || specPath.startsWith('https://')) {
    const response = await fetch(specPath);
    if (!response.ok) {
      throw new SpecLoadError(`HTTP ${response.status}: ${response.statusText}`);
    }
    content = await response.text();
  } else {
    try {
      content = await readFile(specPath, 'utf-8');
    } catch (error) {
      throw new SpecLoadError(`Cannot read file: ${specPath}`);
    }
  }

  try {
    // Try JSON first, then YAML
    if (specPath.endsWith('.json') || content.trim().startsWith('{')) {
      return JSON.parse(content) as OpenAPISpec;
    }
    return parseYaml(content) as OpenAPISpec;
  } catch (error) {
    throw new SpecLoadError('Invalid JSON or YAML format');
  }
}

/**
 * Extract the base URL from the OpenAPI spec
 */
export function extractBaseUrl(spec: OpenAPISpec): string {
  if (spec.servers && spec.servers.length > 0) {
    return spec.servers[0].url.replace(/\/$/, ''); // Remove trailing slash
  }
  throw new SpecLoadError('No server URL defined in OpenAPI spec');
}

/**
 * Extract authentication configuration from security schemes
 */
export function extractAuthConfig(spec: OpenAPISpec): AuthConfig {
  return extractAuthConfigFromSecurity(
    spec.security,
    spec.components?.securitySchemes
  );
}

/**
 * Extract authentication configuration for a specific operation
 * Uses operation-level security if defined, otherwise falls back to global security
 */
export function extractOperationAuthConfig(
  spec: OpenAPISpec,
  operation: Operation
): AuthConfig {
  // If operation has its own security field, use it (even if empty array = no auth)
  if (operation.security !== undefined) {
    return extractAuthConfigFromSecurity(
      operation.security,
      spec.components?.securitySchemes
    );
  }

  // Fall back to global security
  return extractAuthConfig(spec);
}

/**
 * Extract auth config from a security requirement array
 */
function extractAuthConfigFromSecurity(
  security: Array<Record<string, string[]>> | undefined,
  securitySchemes: Record<string, SecurityScheme> | undefined
): AuthConfig {
  // Empty security array means explicitly no auth required
  if (security !== undefined && security.length === 0) {
    return { type: 'none' };
  }

  if (!securitySchemes || !security || security.length === 0) {
    return { type: 'none' };
  }

  // Get the first security requirement
  const securityReq = security[0];
  const schemeName = Object.keys(securityReq)[0];
  const scheme = securitySchemes[schemeName];

  if (!scheme) {
    return { type: 'none' };
  }

  return parseSecurityScheme(scheme, securityReq[schemeName]);
}

function parseSecurityScheme(
  scheme: SecurityScheme,
  scopes: string[]
): AuthConfig {
  if (scheme.type === 'oauth2') {
    const flow = scheme.flows?.authorizationCode;
    if (!flow) {
      throw new UnsupportedSchemaError(
        'securitySchemes',
        'Only OAuth2 authorization code flow is supported'
      );
    }
    return {
      type: 'oauth2',
      authorizationUrl: flow.authorizationUrl,
      tokenUrl: flow.tokenUrl,
      scopes: scopes,
    };
  }

  if (scheme.type === 'apiKey') {
    return {
      type: 'apiKey',
      apiKeyHeader: scheme.name,
      apiKeyIn: scheme.in as 'header' | 'query',
    };
  }

  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    return { type: 'bearer' };
  }

  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return { type: 'basic' };
  }

  return { type: 'none' };
}

/**
 * Resolve a $ref to its actual schema object
 */
function resolveRef(
  ref: string,
  spec: OpenAPISpec,
  visited: Set<string> = new Set()
): SchemaObject {
  // Detect circular references
  if (visited.has(ref)) {
    throw new UnsupportedSchemaError(ref, 'Circular $ref detected');
  }
  visited.add(ref);

  // Only support #/components/schemas/ references
  if (!ref.startsWith('#/components/schemas/')) {
    throw new UnsupportedSchemaError(ref, 'Only #/components/schemas/ $refs are supported');
  }

  const schemaName = ref.replace('#/components/schemas/', '');
  const schema = spec.components?.schemas?.[schemaName];

  if (!schema) {
    throw new UnsupportedSchemaError(ref, `Schema "${schemaName}" not found in components`);
  }

  // If the resolved schema has a $ref, resolve it recursively
  if (schema.$ref) {
    return resolveRef(schema.$ref, spec, visited);
  }

  return schema;
}

/**
 * Convert an OpenAPI schema to a Zod schema
 */
function schemaToZod(
  schema: SchemaObject,
  path: string,
  spec: OpenAPISpec,
  depth: number = 0,
  visited: Set<string> = new Set()
): z.ZodTypeAny {
  // Resolve $ref if present
  if (schema.$ref) {
    const resolvedSchema = resolveRef(schema.$ref, spec, new Set(visited));
    return schemaToZod(resolvedSchema, path, spec, depth, visited);
  }

  // Check for unsupported features
  if (schema.anyOf) {
    throw new UnsupportedSchemaError(path, 'anyOf is not supported');
  }
  if (schema.oneOf) {
    throw new UnsupportedSchemaError(path, 'oneOf is not supported');
  }
  if (schema.allOf) {
    throw new UnsupportedSchemaError(path, 'allOf is not supported');
  }

  // Handle array types
  if (schema.type === 'array') {
    if (!schema.items) {
      throw new UnsupportedSchemaError(path, 'Array without items schema');
    }
    if (schema.items.type === 'object') {
      throw new UnsupportedSchemaError(path, 'Arrays of objects are not supported');
    }
    const itemSchema = schemaToZod(schema.items, `${path}.items`, spec, depth, visited);
    let arraySchema = z.array(itemSchema);
    if (schema.description) {
      arraySchema = arraySchema.describe(schema.description);
    }
    return arraySchema;
  }

  // Handle object types
  if (schema.type === 'object' || schema.properties) {
    if (depth > 1) {
      throw new UnsupportedSchemaError(
        path,
        'Nested objects beyond 1 level are not supported'
      );
    }

    const properties = schema.properties || {};
    const required = schema.required || [];
    const shape: Record<string, z.ZodTypeAny> = {};

    for (const [propName, propSchema] of Object.entries(properties)) {
      let zodProp = schemaToZod(propSchema, `${path}.${propName}`, spec, depth + 1, visited);

      if (!required.includes(propName)) {
        zodProp = zodProp.optional();
      }

      shape[propName] = zodProp;
    }

    let objSchema = z.object(shape);
    if (schema.description) {
      objSchema = objSchema.describe(schema.description);
    }
    return objSchema;
  }

  // Handle primitive types
  switch (schema.type) {
    case 'string': {
      let strSchema: z.ZodTypeAny = z.string();
      if (schema.enum) {
        strSchema = z.enum(schema.enum as [string, ...string[]]);
      }
      if (schema.description) {
        strSchema = strSchema.describe(schema.description);
      }
      return strSchema;
    }

    case 'number':
    case 'integer': {
      let numSchema: z.ZodTypeAny = z.number();
      if (schema.description) {
        numSchema = numSchema.describe(schema.description);
      }
      return numSchema;
    }

    case 'boolean': {
      let boolSchema: z.ZodTypeAny = z.boolean();
      if (schema.description) {
        boolSchema = boolSchema.describe(schema.description);
      }
      return boolSchema;
    }

    default:
      // Default to string for unknown types
      return z.string();
  }
}

/**
 * Build parameters schema from path and query parameters
 */
function buildParametersSchema(
  parameters: Parameter[],
  operationId: string,
  spec: OpenAPISpec
): { shape: Record<string, z.ZodTypeAny>; pathParams: Set<string>; queryParams: Set<string> } {
  const shape: Record<string, z.ZodTypeAny> = {};
  const pathParams = new Set<string>();
  const queryParams = new Set<string>();

  for (const param of parameters) {
    if (param.in !== 'path' && param.in !== 'query') {
      continue; // Skip header and cookie parameters
    }

    let paramSchema: z.ZodTypeAny;

    if (param.schema) {
      paramSchema = schemaToZod(
        param.schema,
        `${operationId}.parameters.${param.name}`,
        spec,
        0
      );
    } else {
      paramSchema = z.string();
    }

    if (param.description) {
      paramSchema = paramSchema.describe(param.description);
    }

    if (!param.required) {
      paramSchema = paramSchema.optional();
    }

    shape[param.name] = paramSchema;

    // Track which set this parameter belongs to
    if (param.in === 'path') {
      pathParams.add(param.name);
    } else if (param.in === 'query') {
      queryParams.add(param.name);
    }
  }

  return { shape, pathParams, queryParams };
}

/**
 * Build request body schema
 */
function buildRequestBodySchema(
  operation: Operation,
  operationId: string,
  spec: OpenAPISpec
): { shape: Record<string, z.ZodTypeAny>; bodyParams: Set<string> } {
  const shape: Record<string, z.ZodTypeAny> = {};
  const bodyParams = new Set<string>();

  if (!operation.requestBody?.content) {
    return { shape, bodyParams };
  }

  const jsonContent = operation.requestBody.content['application/json'];
  if (!jsonContent?.schema) {
    return { shape, bodyParams };
  }

  const schema = jsonContent.schema;

  // Check for file uploads
  if (schema.type === 'string' && schema.format === 'binary') {
    throw new UnsupportedSchemaError(
      `${operationId}.requestBody`,
      'File uploads are not supported'
    );
  }

  // Resolve $ref if present
  let resolvedSchema = schema;
  if (schema.$ref) {
    resolvedSchema = resolveRef(schema.$ref, spec);
  }

  // For object schemas, flatten properties into the parameter shape
  if (resolvedSchema.type === 'object' || resolvedSchema.properties) {
    const properties = resolvedSchema.properties || {};
    const required = resolvedSchema.required || [];

    for (const [propName, propSchema] of Object.entries(properties)) {
      // Check for file upload in properties
      if (
        propSchema.type === 'string' &&
        propSchema.format === 'binary'
      ) {
        throw new UnsupportedSchemaError(
          `${operationId}.requestBody.${propName}`,
          'File uploads are not supported'
        );
      }

      let zodProp = schemaToZod(
        propSchema,
        `${operationId}.requestBody.${propName}`,
        spec,
        1
      );

      if (!required.includes(propName)) {
        zodProp = zodProp.optional();
      }

      shape[propName] = zodProp;
      bodyParams.add(propName); // Track that this is a body parameter
    }
  }

  return { shape, bodyParams };
}

/**
 * Generate tool name from operation
 */
function generateToolName(
  operation: Operation,
  method: HttpMethod,
  path: string
): string {
  if (operation.operationId) {
    return operation.operationId;
  }

  // Generate name from method and path
  const cleanPath = path
    .replace(/[{}]/g, '')
    .replace(/\//g, '_')
    .replace(/^_/, '');

  return `${method.toLowerCase()}_${cleanPath}`;
}

/**
 * Parse all operations from the OpenAPI spec and generate tool definitions
 */
export function parseOperations(spec: OpenAPISpec): Omit<Tool, 'execute'>[] {
  const tools: Omit<Tool, 'execute'>[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    // Get path-level parameters
    const pathParameters = pathItem.parameters || [];

    for (const method of HTTP_METHODS) {
      const methodKey = method.toLowerCase() as keyof PathItem;
      const operation = pathItem[methodKey] as Operation | undefined;

      if (!operation) {
        continue;
      }

      const operationId = generateToolName(operation, method, path);

      // Combine path-level and operation-level parameters
      const allParameters = [
        ...pathParameters,
        ...(operation.parameters || []),
      ];

      // Build combined schema from parameters and request body
      const parametersResult = buildParametersSchema(allParameters, operationId, spec);
      const bodyResult = buildRequestBodySchema(operation, operationId, spec);

      const combinedShape = { ...parametersResult.shape, ...bodyResult.shape };
      const parameters = z.object(combinedShape);

      // Extract operation-specific auth config
      const authConfig = extractOperationAuthConfig(spec, operation);

      tools.push({
        name: operationId,
        description: operation.summary || operation.description || `${method} ${path}`,
        parameters,
        httpMethod: method,
        path,
        authConfig,
        parameterMetadata: {
          pathParams: parametersResult.pathParams,
          queryParams: parametersResult.queryParams,
          bodyParams: bodyResult.bodyParams,
        },
      });
    }
  }

  return tools;
}

/**
 * Format tool schema for display
 */
export function formatToolSchema(tool: Omit<Tool, 'execute'>): string {
  const shape = tool.parameters.shape;
  const lines: string[] = ['{'];

  for (const [key, schema] of Object.entries(shape)) {
    const zodSchema = schema as z.ZodTypeAny;
    const isOptional = zodSchema.isOptional();
    const description = zodSchema.description;

    let typeStr = getZodTypeString(zodSchema);
    if (isOptional) {
      typeStr += '.optional()';
    }
    if (description) {
      typeStr += `.describe("${description}")`;
    }

    lines.push(`  ${key}: ${typeStr},`);
  }

  lines.push('}');
  return lines.join('\n');
}

function getZodTypeString(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodOptional) {
    return getZodTypeString(schema.unwrap());
  }
  if (schema instanceof z.ZodString) {
    return 'z.string()';
  }
  if (schema instanceof z.ZodNumber) {
    return 'z.number()';
  }
  if (schema instanceof z.ZodBoolean) {
    return 'z.boolean()';
  }
  if (schema instanceof z.ZodEnum) {
    return `z.enum([${schema.options.map((o: string) => `"${o}"`).join(', ')}])`;
  }
  if (schema instanceof z.ZodArray) {
    return `z.array(${getZodTypeString(schema.element)})`;
  }
  if (schema instanceof z.ZodObject) {
    return 'z.object({...})';
  }
  return 'z.unknown()';
}

/**
 * Format tool signature for display
 */
export function formatToolSignature(tool: Omit<Tool, 'execute'>): string {
  const shape = tool.parameters.shape;
  const params: string[] = [];

  for (const [key, schema] of Object.entries(shape)) {
    const zodSchema = schema as z.ZodTypeAny;
    const isOptional = zodSchema.isOptional();
    const typeStr = getSimpleTypeString(zodSchema);

    params.push(`${key}${isOptional ? '?' : ''}: ${typeStr}`);
  }

  return `${tool.name}(${params.join(', ')})`;
}

function getSimpleTypeString(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodOptional) {
    return getSimpleTypeString(schema.unwrap());
  }
  if (schema instanceof z.ZodString || schema instanceof z.ZodEnum) {
    return 'string';
  }
  if (schema instanceof z.ZodNumber) {
    return 'number';
  }
  if (schema instanceof z.ZodBoolean) {
    return 'boolean';
  }
  if (schema instanceof z.ZodArray) {
    return `${getSimpleTypeString(schema.element)}[]`;
  }
  if (schema instanceof z.ZodObject) {
    return 'object';
  }
  return 'unknown';
}
