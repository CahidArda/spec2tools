# Spec2Tools

Dynamically convert OpenAPI specs into AI agent tools at runtime—no code generation, no MCP server.

## Thesis

You have a server. You have an OpenAPI spec. Now, with all the MCP hype, you're told you need to build *another* server—an MCP server—just so AI agents can call your API. You look it up: define tools, maintain handlers, keep it in sync with your actual API. But wait... you already described your API in OpenAPI. Why do we need to describe it to the agent twice?

**Spec2Tools is the alternative.** A minimal agent harness that reads your OpenAPI spec and exposes endpoints as tools—no MCP server, no code generation, no maintenance burden.

Right now, we build+deploy MCP servers to make APIs "agent-ready". But if agent harnesses supported loading tools from specs, we could remove the maintenance burden of dedicated MCP servers entirely.

## How It Differs

Unlike examples like [ai-tool-maker](https://github.com/nihaocami/ai-tool-maker) which generates static code from OpenAPI specs, Spec2Tools connects to APIs dynamically at runtime. Point it at any OpenAPI spec and start chatting immediately—no build step, no generated files.

## Features

- Parse OpenAPI 3.0 specifications (JSON or YAML)
- Auto-generate Zod schemas from OpenAPI schemas
- Support for OAuth2, API Key, and Bearer token authentication
- Interactive chat mode with AI agent
- Direct tool invocation via CLI commands
- Support for GET, POST, PUT, PATCH, DELETE operations
- Import `createTools()` to get AI SDK-compatible tools directly

## Usage

### Set Environment Variables

Define a `.env` file and define the `OPENAI_API_KEY` environment variable:

```
OPENAI_API_KEY=your-api-key
```

### Start the Agent

```bash
# With a remote OpenAPI spec URL
npx spec2tools start --spec https://api.example.com/openapi.json

# With a local file
npx spec2tools start --spec ./openapi.yaml

# Skip authentication
npx spec2tools start --spec ./openapi.yaml --no-auth

# Provide token directly
npx spec2tools start --spec ./openapi.yaml --token "your-access-token"
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

### Programmatic Usage

Install with:

```bash
npm install spec2tools
```

You can import `createTools` directly in your code to get AI SDK-compatible tools:

```ts
import { createTools } from 'spec2tools';
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

const tools = await createTools({ spec: '../new/examples/sample-api.yaml' });

const result = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'List all users',
  stopWhen: stepCountIs(3)
});

console.log(result.text);
```

> **Note:** `createTools()` only works with APIs that don't require authentication. For authenticated APIs, use the CLI.

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

## Development

```bash
git clone https://github.com/ArdaOzworksAt/spec2tools.git
cd spec2tools
npm install
npm run build
```

Run locally:

```bash
npm start -- start --spec ./examples/sample-api.yaml
```

## License

MIT
