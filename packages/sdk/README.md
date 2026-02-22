# @spec2tools/sdk

Create AI SDK tools from OpenAPI specifications.

## Installation

```bash
npm install @spec2tools/sdk
```

## Usage

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

### Code Mode

Enable code mode to collapse all endpoints into 2 tools (`search` + `execute`), reducing token usage by ~99.9%:

```ts
const tools = await createTools({
  spec: './openapi.yaml',
  codeMode: true,
});
```

## API

### `createTools(options: Spec2ToolsOptions): Promise<ToolSet>`

Creates AI SDK-compatible tools from an OpenAPI specification.

#### Options

- `spec` (string, required): Path or URL to the OpenAPI specification file (JSON or YAML)
- `codeMode` (boolean, optional): When `true`, returns 2 code-mode tools instead of one per endpoint

#### Returns

A `Promise` that resolves to an object of AI SDK tools.

#### Throws

- `Error` if the API requires authentication (unless `codeMode` is enabled). For authenticated APIs, use the `@spec2tools/cli` package instead.

## License

MIT
