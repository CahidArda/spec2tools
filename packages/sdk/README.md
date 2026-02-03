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

## API

### `createTools(options: Spec2ToolsOptions): Promise<ToolSet>`

Creates AI SDK-compatible tools from an OpenAPI specification.

#### Options

- `spec` (string, required): Path or URL to the OpenAPI specification file (JSON or YAML)

#### Returns

A `Promise` that resolves to an object of AI SDK tools.

#### Throws

- `Error` if the API requires authentication. For authenticated APIs, use the `@spec2tools/cli` package instead.

## Notes

- `createTools()` only works with APIs that don't require authentication
- For authenticated APIs, use the CLI: `npx @spec2tools/cli start --spec ./openapi.yaml`

## License

MIT
