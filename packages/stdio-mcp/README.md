# @spec2tools/stdio-mcp

MCP (Model Context Protocol) server that exposes OpenAPI endpoints as tools via stdio transport. This allows AI agents like Claude to call any API described by an OpenAPI specification.

## Installation

```bash
npm install @spec2tools/stdio-mcp
# or
pnpm add @spec2tools/stdio-mcp
```

## Quick Start

### With Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["@spec2tools/stdio-mcp", "./path/to/openapi.yaml"]
    }
  }
}
```

For authenticated APIs:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["@spec2tools/stdio-mcp", "./openapi.yaml", "--api-key", "your-api-key"]
    }
  }
}
```

Or using environment variables:

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["@spec2tools/stdio-mcp", "./openapi.yaml"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

### CLI Usage

```bash
# Start server with local spec
spec2tools-mcp ./openapi.yaml

# Start server with remote spec
spec2tools-mcp https://api.example.com/openapi.json

# Start with authentication
spec2tools-mcp ./api.yaml --api-key your-api-key

# Or use environment variable
API_KEY=your-api-key spec2tools-mcp ./api.yaml
```

### Programmatic Usage

```typescript
import { startMcpServer } from '@spec2tools/stdio-mcp';

await startMcpServer({
  spec: './openapi.yaml',
  name: 'my-api-server',
  version: '1.0.0',
  apiKey: 'your-api-key', // optional
});
```

## CLI Options

| Option | Description |
|--------|-------------|
| `<spec-path>` | Path or URL to OpenAPI specification (JSON or YAML) |
| `--name <name>` | Server name for MCP (default: `openapi-mcp-server`) |
| `--version <ver>` | Server version for MCP (default: `1.0.0`) |
| `--api-key <key>` | API key or bearer token for authentication |
| `-h, --help` | Show help message |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `API_KEY` | API key or bearer token for authentication |

## How It Works

1. **Loads OpenAPI Spec**: Reads your OpenAPI 3.x specification from a local file or URL (supports both JSON and YAML)

2. **Parses Operations**: Converts each API operation into an MCP tool with:
   - Tool name from `operationId` (or generated from method + path)
   - Description from `summary` or `description`
   - Input schema from parameters and request body

3. **Starts MCP Server**: Creates a stdio-based MCP server that AI agents can connect to

4. **Handles Tool Calls**: When an agent calls a tool, the server:
   - Validates the parameters
   - Builds the HTTP request (URL, headers, body)
   - Adds authentication if configured
   - Executes the request and returns the response

## Supported OpenAPI Features

- **HTTP Methods**: GET, POST, PUT, PATCH, DELETE
- **Parameters**: Path and query parameters (string, number, boolean, arrays)
- **Request Bodies**: JSON with primitives and flat objects
- **Authentication**: Bearer tokens, API keys (header or query)

### Limitations

- Nested objects beyond 1 level deep are not supported
- Arrays of objects are not supported
- Schema composition (`anyOf`, `oneOf`, `allOf`) is not supported
- File uploads are not supported
- `$ref` schema references are not supported

## Example

Given this OpenAPI spec:

```yaml
openapi: 3.0.0
info:
  title: User API
  version: 1.0.0
servers:
  - url: https://api.example.com
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        '200':
          description: Success
  /users/{id}:
    get:
      operationId: getUser
      summary: Get user by ID
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        '200':
          description: Success
```

The MCP server will expose two tools:

- `listUsers(limit?: number)` - List all users
- `getUser(id: number)` - Get user by ID

An AI agent can then call these tools naturally:

> "Get me the user with ID 42"

The agent will call `getUser({ id: 42 })` and receive the API response.

## Related Packages

- [`@spec2tools/core`](../core) - Core utilities for OpenAPI parsing
- [`@spec2tools/cli`](../cli) - Interactive CLI with chat interface
- [`@spec2tools/sdk`](../sdk) - AI SDK tool generation

## License

MIT
