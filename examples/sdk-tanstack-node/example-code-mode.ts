import { chat } from '@tanstack/ai';
import { openaiText } from '@tanstack/ai-openai';
import { createTools } from '@spec2tools/sdk-tanstack';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Points to the sample OpenAPI spec bundled with @spec2tools/cli
const SPEC = path.resolve(__dirname, '../../packages/cli/examples/sample-api.yaml');

const prompt = process.argv[2] ?? 'List the first 3 users and tell me their names.';

console.log(` > Prompt: ${prompt}\n`);

// codeMode: true collapses all endpoints into 2 tools (search + execute),
// reducing token usage significantly for large APIs
const tools = await createTools({ spec: SPEC, codeMode: true });

console.log(` > Running with ${Object.keys(tools).length} code-mode tools: ${tools.map(t => t.name).join(', ')}\n`);

const stream = chat({
  adapter: openaiText('gpt-4o-mini'),
  messages: [{ role: 'user', content: prompt }],
  tools,
});

for await (const chunk of stream) {
  if (chunk.type === 'TOOL_CALL_START') {
    console.log(` > Tool call started: ${chunk.toolName}\n`);
  } else if (chunk.type === 'TOOL_CALL_END') {
    if (chunk.input) {
      console.log(` > Tool call parameters: ${JSON.stringify(chunk.input)}\n`);
    } else {
      console.log(` > Tool call result: ${JSON.stringify(chunk.result).slice(0, 40)}...\n`);
    }
  } else if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
    process.stdout.write(chunk.delta);
  }
}
