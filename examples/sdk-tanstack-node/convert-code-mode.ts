import { chat, toolDefinition, type JSONSchema } from '@tanstack/ai';
import { openaiText } from '@tanstack/ai-openai';
import { convertToolsToCodeMode } from '@spec2tools/sdk-tanstack';

const prompt =
  process.argv[2] ?? 'What is 42 multiplied by 7? Then add 15 to the result.';

console.log(` > Prompt: ${prompt}\n`);

// Mock tools — not from an OpenAPI spec, just plain ServerTool instances
// created manually with toolDefinition().server()
const addTool = toolDefinition({
  name: 'add',
  description: 'Add two numbers together',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' },
    },
    required: ['a', 'b'],
  } as JSONSchema,
}).server(async (args) => {
  const { a, b } = args as { a: number; b: number };
  return { result: a + b };
});

const multiplyTool = toolDefinition({
  name: 'multiply',
  description: 'Multiply two numbers',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number', description: 'First number' },
      b: { type: 'number', description: 'Second number' },
    },
    required: ['a', 'b'],
  } as JSONSchema,
}).server(async (args) => {
  const { a, b } = args as { a: number; b: number };
  return { result: a * b };
});

// convertToolsToCodeMode works with any ServerTool[], not just those from createTools
const tools = convertToolsToCodeMode([addTool, multiplyTool]);

console.log(` > Running with ${tools.length} code-mode tools: ${tools.map(t => t.name).join(', ')}\n`);

const stream = chat({
  adapter: openaiText('gpt-4o-mini'),
  messages: [{ role: 'user', content: prompt }],
  tools,
});

for await (const chunk of stream) {
  if (chunk.type === 'TOOL_CALL_START') {
    console.log(` > Tool call started: ${chunk.toolName}\n`);
  } else if (chunk.type === 'TOOL_CALL_END') {
    console.log(` > Tool call parameters: ${JSON.stringify(chunk.input)}\n`);
  } else if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
    process.stdout.write(chunk.delta);
  }
}
