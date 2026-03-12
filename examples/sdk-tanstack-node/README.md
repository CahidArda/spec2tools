# example: sdk-tanstack-node

Node.js examples that use `@spec2tools/sdk-tanstack` to generate [TanStack AI](https://tanstack.com/ai) tools, then run a chat with OpenAI.

## Setup

```bash
cp .env.example .env
# add your OPENAI_API_KEY to .env
```

Install dependencies from the repo root:

```bash
pnpm install
```

---

## Examples

### 1. `index.ts` — one tool per endpoint

Generates one `ServerTool` per OpenAPI operation and passes them all to `chat()`.

```bash
pnpm start
pnpm start "How many posts does user 1 have?"
```

**How it works:**
1. `createTools({ spec })` parses the OpenAPI spec and returns a `ServerTool[]` — one per operation
2. The full tool list is passed to `chat()`; the model picks and calls whichever it needs
3. Streamed chunks are printed to the console as they arrive

---

### 2. `code-mode.ts` — collapsed into 2 tools via `codeMode`

Passes `codeMode: true` to `createTools`, collapsing all endpoints into just two tools: `search` and `execute`. The model discovers endpoints with `search` then calls them by writing Python code in `execute`. Significantly reduces token usage for large APIs.

```bash
pnpm start:code-mode
pnpm start:code-mode "How many posts does user 1 have?"
```

**How it works:**
1. `createTools({ spec, codeMode: true })` returns exactly 2 `ServerTool` instances
2. The model uses `search` to find relevant endpoints, then `execute` to call them via a sandboxed Python interpreter
3. Same streaming output as the basic example

---

### 3. `convert-code-mode.ts` — `convertToolsToCodeMode` with hand-written tools

Shows that `convertToolsToCodeMode` works with **any** `ServerTool[]`, not only tools generated from an OpenAPI spec. Two simple math tools are created manually with `toolDefinition().server()`, then converted to code mode.

```bash
pnpm start:convert
pnpm start:convert "What is 42 multiplied by 7? Then add 15 to the result."
```

**How it works:**
1. Two `ServerTool` instances (`add`, `multiply`) are created with `toolDefinition().server()`
2. `convertToolsToCodeMode([addTool, multiplyTool])` collapses them into `search` + `execute`
3. The model writes Python code in `execute` to chain the tool calls together
