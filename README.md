# OpenAPI Agent CLI

A CLI tool that dynamically converts OpenAPI specifications into callable AI agent tools, with built-in authentication support.

## Features

- Parse OpenAPI 3.0 specifications (JSON or YAML)
- Auto-generate Zod schemas from OpenAPI schemas
- Support for OAuth2, API Key, and Bearer token authentication
- Interactive chat mode with AI agent
- Direct tool invocation via CLI commands
- Support for GET, POST, PUT, PATCH, DELETE operations

## Installation

```bash
npm install
npm run build
```

## Usage

### Start the Agent

```bash
# With a remote OpenAPI spec URL
npx agent-cli start --spec https://api.example.com/openapi.json

# With a local file
npx agent-cli start --spec ./openapi.yaml

# Skip authentication
npx agent-cli start --spec ./openapi.yaml --no-auth

# Provide token directly
npx agent-cli start --spec ./openapi.yaml --token "your-access-token"
```

### Chat Mode

Once started, you can interact with the AI agent naturally:

```
> What can you do?
I have access to the following tools:
- createUser: Create a new user
- getUser: Retrieve user by ID
- listUsers: List all users

> Create a user named John with email john@example.com
[Calling createUser with {"name":"John","email":"john@example.com"}]
Created user successfully: { id: "123", name: "John", email: "john@example.com" }
```

### Special Commands

```bash
# List available tools
> /tools

# Call a tool directly
> /call createUser --name "John" --email "john@example.com"

# Show tool schema
> /schema createUser

# Clear conversation history
> /clear

# Show help
> /help

# Exit
> /exit
```

## Supported OpenAPI Features

### Supported
- `GET`, `POST`, `PUT`, `PATCH`, `DELETE` operations
- Path parameters (string, number, boolean)
- Query parameters (string, number, boolean)
- Request body with simple JSON schemas (primitives, flat objects)
- Security schemes: OAuth2 (authorization code with PKCE), API Key, Bearer token
- OAuth2 Dynamic Client Registration (auto-registers client with the auth server)

### Not Supported (throws error)
- Nested objects beyond 1 level
- Arrays of objects
- `anyOf`, `oneOf`, `allOf` schemas
- File uploads
- `$ref` references

## Environment Variables

Set the `OPENAI_API_KEY` environment variable for AI functionality:

```bash
export OPENAI_API_KEY=your-api-key
```

You can also create a `.env` file in the project root:

```
OPENAI_API_KEY=your-api-key
```

## Examples

See the `examples/` directory for sample OpenAPI specifications:

- `sample-api.yaml` - Simple API without authentication
- `authenticated-api.yaml` - API with OAuth2 authentication
- `context7.yaml` - Context7 API with OAuth2 (PKCE + dynamic client registration)

## Architecture

```
┌─────────────┐
│   CLI       │
│  (Commander)│
└──────┬──────┘
       │
       ├──> OpenAPI Parser
       │    - Fetch spec
       │    - Validate scope
       │    - Generate Zod schemas
       │
       ├──> Auth Manager
       │    - Detect auth type
       │    - Handle OAuth flow (PKCE)
       │    - Dynamic client registration
       │    - Store tokens
       │
       ├──> Tool Executor
       │    - Execute HTTP requests
       │    - Attach auth headers
       │    - Parse responses
       │
       └──> AI Agent
            - AI SDK with tools
            - Handle chat loop
            - Execute tool calls
```

## License

MIT
