import { chat, streamToText } from '@tanstack/ai';
import { openaiText } from '@tanstack/ai-openai';
import { createTools } from '@spec2tools/sdk-tanstack';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Points to the sample OpenAPI spec bundled with @spec2tools/cli
const SPEC = path.resolve(__dirname, '../../packages/cli/examples/sample-api.yaml');

const prompt = process.argv[2] ?? 'List the first 3 users and tell me their names.';

console.log(`Prompt: ${prompt}\n`);

const tools = await createTools({ spec: SPEC });

const stream = chat({
  adapter: openaiText('gpt-4o-mini'),
  messages: [{ role: 'user', content: prompt }],
  tools,
});

const text = await streamToText(stream);
console.log(text);
