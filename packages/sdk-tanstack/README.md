# @spec2tools/sdk-tanstack

Create TanStack AI tools from OpenAPI specifications.

## Installation

```bash
npm install @spec2tools/sdk-tanstack @tanstack/ai
```

## Usage

```ts
import { createTools } from '@spec2tools/sdk-tanstack';
import { chat, toServerSentEventsResponse } from '@tanstack/ai';
import { openai } from '@tanstack/ai-openai';

const tools = await createTools({ spec: './openapi.yaml' });

const stream = chat({
  adapter: openai(),
  model: 'gpt-4o',
  messages,
  tools,
});

return toServerSentEventsResponse(stream);
```

### Code Mode

Enable code mode to collapse all endpoints into 2 tools (`search` + `execute`), reducing token usage by ~99.9%:

```ts
const tools = await createTools({
  spec: './openapi.yaml',
  codeMode: true,
});
```

### Converting Existing Tools to Code Mode

Use `convertToolsToCodeMode` to apply code mode to any existing `ServerTool` array:

```ts
import { convertToolsToCodeMode } from '@spec2tools/sdk-tanstack';

const tools = await createTools({ spec: './openapi.yaml' });
const codeModeTools = convertToolsToCodeMode(tools);
```

## API

### `createTools(options: Spec2ToolsOptions): Promise<ServerTool[]>`

Creates TanStack AI server tools from an OpenAPI specification.

#### Options

- `spec` (string, required): Path or URL to the OpenAPI specification file (JSON or YAML)
- `codeMode` (boolean, optional): When `true`, returns 2 code-mode tools instead of one per endpoint

#### Returns

A `Promise` that resolves to an array of TanStack AI `ServerTool` instances, ready to pass to `chat()`.

#### Throws

- `Error` if the API requires authentication (unless `codeMode` is enabled). For authenticated APIs, use the `@spec2tools/cli` package instead.

### `convertToolsToCodeMode(tools: ServerTool[]): ServerTool[]`

Converts an existing TanStack AI `ServerTool` array into code mode (2 tools: `search` + `execute`). Useful when you have tools from another source and want to reduce token usage.

## License

MIT
