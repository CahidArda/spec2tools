# Spec2Tools

Dynamically convert OpenAPI specs into AI agent tools at runtime—no code generation required.

## Packages

This monorepo contains four packages:

| Package | Description | Install |
|---------|-------------|---------|
| [@spec2tools/core](./packages/core) | Core utilities for OpenAPI parsing and authentication | `npm install @spec2tools/core` |
| [@spec2tools/sdk](./packages/sdk) | Create AI SDK tools from OpenAPI specifications | `npm install @spec2tools/sdk` |
| [@spec2tools/cli](./packages/cli) | CLI for interacting with OpenAPI-based AI tools | `npx @spec2tools/cli` |
| [@spec2tools/stdio-mcp](./packages/stdio-mcp) | MCP server exposing OpenAPI endpoints as tools via stdio | `npx @spec2tools/stdio-mcp` |

## Quick Start

### Using the SDK

```ts
import { createTools } from '@spec2tools/sdk';
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

const tools = await createTools({ spec: './openapi.yaml' });

const result = await generateText({
  model: openai('gpt-4o'),
  tools,
  prompt: 'List all users',
  stopWhen: stepCountIs(3)
});

console.log(result.text);
```

### Using the CLI

```bash
# Set your OpenAI API key
export OPENAI_API_KEY=your-api-key

# Start the agent with an OpenAPI spec
npx @spec2tools/cli start --spec https://api.example.com/openapi.json
```

### Using as MCP Server (with Claude Desktop)

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

## Thesis

You have a server. You have an OpenAPI spec. Now, with all the MCP hype, you're told you need to build *another* server—an MCP server—just so AI agents can call your API. You look it up: define tools, maintain handlers, keep it in sync with your actual API. But wait... you already described your API in OpenAPI. Why do we need to describe it to the agent twice?

**Spec2Tools is the alternative.** It reads your OpenAPI spec and exposes endpoints as tools—no code generation, no maintenance burden. Use it directly with the AI SDK, or spin up an MCP server instantly from your existing spec.

## Development

```bash
# Clone the repo
git clone https://github.com/CahidArda/spec2tools.git
cd spec2tools

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## License

MIT
