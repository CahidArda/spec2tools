#!/usr/bin/env node
import { startMcpServer, McpServerOptions } from './server.js';

// Re-export for programmatic use
export { startMcpServer, McpServerOptions } from './server.js';

/**
 * CLI entry point
 * Usage: spec2tools-mcp <spec-path> [--name <server-name>] [--version <server-version>]
 *
 * Authentication can be provided via:
 * - Environment variable: API_KEY
 * - Command line: --api-key <key>
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const options = parseArgs(args);

  if (!options.spec) {
    console.error('Error: OpenAPI spec path is required');
    printUsage();
    process.exit(1);
  }

  try {
    await startMcpServer(options);
  } catch (error) {
    console.error('Error starting MCP server:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function parseArgs(args: string[]): McpServerOptions {
  const options: McpServerOptions = { spec: '' };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--name' && args[i + 1]) {
      options.name = args[++i];
    } else if (arg === '--version' && args[i + 1]) {
      options.version = args[++i];
    } else if (arg === '--api-key' && args[i + 1]) {
      options.apiKey = args[++i];
    } else if (!arg.startsWith('-')) {
      options.spec = arg;
    }
  }

  return options;
}

function printUsage(): void {
  console.log(`
@spec2tools/stdio-mcp - MCP server exposing OpenAPI endpoints as tools

Usage:
  spec2tools-mcp <spec-path> [options]

Arguments:
  spec-path           Path or URL to OpenAPI specification (JSON or YAML)

Options:
  --name <name>       Server name for MCP (default: openapi-mcp-server)
  --version <ver>     Server version for MCP (default: 1.0.0)
  --api-key <key>     API key or token for authentication
  -h, --help          Show this help message

Environment Variables:
  API_KEY             API key or token for authentication

Examples:
  # Start server with local spec
  spec2tools-mcp ./openapi.yaml

  # Start server with remote spec
  spec2tools-mcp https://api.example.com/openapi.json

  # Start with authentication
  API_KEY=xxx spec2tools-mcp ./api.yaml

  # Configure in Claude Desktop (claude_desktop_config.json):
  {
    "mcpServers": {
      "my-api": {
        "command": "npx",
        "args": ["@spec2tools/stdio-mcp", "./openapi.yaml"]
      }
    }
  }
`);
}

// Run CLI if this is the entry point
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
