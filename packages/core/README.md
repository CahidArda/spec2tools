# @spec2tools/core

Core utilities for OpenAPI parsing and authentication.

## Installation

```bash
npm install @spec2tools/core
```

## API

### OpenAPI Parsing

```ts
import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  formatToolSchema,
  formatToolSignature,
} from '@spec2tools/core';

// Load an OpenAPI specification from file or URL
const spec = await loadOpenAPISpec('./openapi.yaml');

// Extract the base URL
const baseUrl = extractBaseUrl(spec);

// Extract authentication configuration
const authConfig = extractAuthConfig(spec);

// Parse operations into tool definitions
const tools = parseOperations(spec);
```

### Authentication Manager

```ts
import { AuthManager } from '@spec2tools/core';

const authManager = new AuthManager(authConfig);

// Check if auth is required
if (authManager.requiresAuth()) {
  // Perform authentication (OAuth2, API Key, or Bearer token)
  await authManager.authenticate();
}

// Get auth headers for requests
const headers = authManager.getAuthHeaders();
```

### Tool Execution

```ts
import { createExecutableTools, executeToolByName } from '@spec2tools/core';

// Create executable tools from tool definitions
const tools = createExecutableTools(toolDefs, baseUrl, authManager);

// Execute a tool by name
const result = await executeToolByName(tools, 'getUser', { id: '123' });
```

### Error Classes

```ts
import {
  UnsupportedSchemaError,
  AuthenticationError,
  ToolExecutionError,
  SpecLoadError,
} from '@spec2tools/core';
```

### Types

```ts
import type {
  HttpMethod,
  Tool,
  AuthType,
  AuthConfig,
  Session,
  OpenAPISpec,
  PathItem,
  Operation,
  Parameter,
  RequestBody,
  MediaType,
  Response,
  SchemaObject,
  SecurityScheme,
} from '@spec2tools/core';
```

## Supported OpenAPI Features

### Supported
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE` operations
- Path parameters (string, number, boolean)
- Query parameters (string, number, boolean)
- Request body with simple JSON schemas (primitives, flat objects)
- Security schemes: OAuth2 (authorization code with PKCE), API Key, Bearer token

### Not Supported (throws error)
- Nested objects beyond 1 level
- Arrays of objects
- `anyOf`, `oneOf`, `allOf` schemas
- File uploads
- `$ref` references

## License

MIT
