# @spec2tools/cli

CLI for interacting with OpenAPI-based AI tools.

## Installation

```bash
npm install -g @spec2tools/cli
```

Or use directly with npx:

```bash
npx @spec2tools/cli start --spec ./openapi.yaml
```

## Usage

### Set Environment Variables

Define a `.env` file and set the `OPENAI_API_KEY` environment variable:

```
OPENAI_API_KEY=your-api-key
```

### Start the Agent

```bash
# With a remote OpenAPI spec URL
npx @spec2tools/cli start --spec https://api.example.com/openapi.json

# With a local file
npx @spec2tools/cli start --spec ./openapi.yaml

# Skip authentication
npx @spec2tools/cli start --spec ./openapi.yaml --no-auth

# Provide API key directly
npx @spec2tools/cli start --spec ./openapi.yaml --api-key "your-api-key"
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

## Examples

The `examples/` directory contains sample OpenAPI specifications:

- `sample-api.yaml` - Simple API without authentication
- `authenticated-api.yaml` - API with OAuth2 authentication
- `context7.yaml` - Context7 API with OAuth2 (PKCE + dynamic client registration)

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

## License

MIT
