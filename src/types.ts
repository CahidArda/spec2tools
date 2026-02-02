import { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (params: unknown) => Promise<unknown>;
  httpMethod: HttpMethod;
  path: string;
}

export type AuthType = 'oauth2' | 'apiKey' | 'bearer' | 'none';

export interface AuthConfig {
  type: AuthType;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  apiKeyHeader?: string;
  apiKeyIn?: 'header' | 'query';
}

export interface Session {
  baseUrl: string;
  tools: Tool[];
  authConfig: AuthConfig;
  accessToken?: string;
  refreshToken?: string;
}

// OpenAPI Types
export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    securitySchemes?: Record<string, SecurityScheme>;
  };
  security?: Array<Record<string, string[]>>;
}

export interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  patch?: Operation;
  delete?: Operation;
  parameters?: Parameter[];
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
  responses?: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
}

export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: SchemaObject;
}

export interface RequestBody {
  required?: boolean;
  content?: Record<string, MediaType>;
  description?: string;
}

export interface MediaType {
  schema?: SchemaObject;
}

export interface Response {
  description: string;
  content?: Record<string, MediaType>;
}

export interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  required?: string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  enum?: unknown[];
  default?: unknown;
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  allOf?: SchemaObject[];
  $ref?: string;
}

export interface SecurityScheme {
  type: 'oauth2' | 'apiKey' | 'http';
  scheme?: string; // for http type: 'bearer', 'basic'
  bearerFormat?: string;
  name?: string; // for apiKey
  in?: 'header' | 'query' | 'cookie'; // for apiKey
  flows?: {
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      scopes?: Record<string, string>;
    };
    clientCredentials?: {
      tokenUrl: string;
      scopes?: Record<string, string>;
    };
    implicit?: {
      authorizationUrl: string;
      scopes?: Record<string, string>;
    };
  };
}
