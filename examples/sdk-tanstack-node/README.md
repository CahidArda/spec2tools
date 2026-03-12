# example: sdk-tanstack-node

A minimal Node.js script that generates [TanStack AI](https://tanstack.com/ai) tools from an OpenAPI spec using `@spec2tools/sdk-tanstack`, then runs a chat with OpenAI.

## Setup

```bash
cp .env.example .env
# add your OPENAI_API_KEY to .env
```

Install dependencies from the repo root:

```bash
pnpm install
```

## Run

```bash
# default prompt
pnpm start

# custom prompt
pnpm start "How many posts does user 1 have?"
```

## How it works

1. `createTools({ spec })` reads the OpenAPI spec and returns a `ServerTool[]`
2. The tools are passed to TanStack AI's `chat()` together with the OpenAI adapter
3. The model calls the relevant API endpoints autonomously to answer the prompt
4. `streamToText()` collects the streamed response into a final string
