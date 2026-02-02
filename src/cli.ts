import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as readline from 'readline';
import {
  loadOpenAPISpec,
  extractBaseUrl,
  extractAuthConfig,
  parseOperations,
  formatToolSchema,
  formatToolSignature,
} from './openapi-parser.js';
import { AuthManager } from './auth-manager.js';
import { createExecutableTools, executeToolByName } from './tool-executor.js';
import { Agent } from './agent.js';
import { Session, Tool } from './types.js';
import {
  UnsupportedSchemaError,
  AuthenticationError,
  ToolExecutionError,
  SpecLoadError,
} from './errors.js';

const VERSION = '0.1.5';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('spec2tools')
    .description('Dynamically convert OpenAPI specs into AI agent tools at runtime')
    .version(VERSION);

  program
    .command('start')
    .description('Start the agent with an OpenAPI specification')
    .requiredOption('-s, --spec <path>', 'Path or URL to OpenAPI specification')
    .option('--no-auth', 'Skip authentication even if required by spec')
    .option('--token <token>', 'Provide access token directly')
    .action(async (options) => {
      await startAgent(options);
    });

  return program;
}

interface StartOptions {
  spec: string;
  auth: boolean;
  token?: string;
}

async function startAgent(options: StartOptions): Promise<void> {
  const spinner = ora();

  try {
    // Load OpenAPI spec
    spinner.start('Loading OpenAPI specification...');
    const spec = await loadOpenAPISpec(options.spec);
    spinner.succeed(`Loaded: ${spec.info.title} v${spec.info.version}`);

    // Extract base URL
    const baseUrl = extractBaseUrl(spec);
    console.log(chalk.dim(`Base URL: ${baseUrl}`));

    // Extract auth config
    const authConfig = extractAuthConfig(spec);

    // Parse operations
    spinner.start('Parsing operations...');
    const toolDefs = parseOperations(spec);
    spinner.succeed(`Found ${toolDefs.length} operations`);

    if (toolDefs.length === 0) {
      console.log(chalk.yellow('No operations found in the specification.'));
      return;
    }

    // Initialize auth manager
    const authManager = new AuthManager(authConfig);

    // Handle authentication
    if (options.token) {
      authManager.setAccessToken(options.token);
      console.log(chalk.green('Using provided access token'));
    } else if (options.auth && authManager.requiresAuth()) {
      console.log(
        chalk.yellow(`\nAuthentication required (${authConfig.type})`)
      );
      await authManager.authenticate();
      console.log(chalk.green('Authentication successful!'));
    } else if (authManager.requiresAuth()) {
      console.log(
        chalk.yellow(
          '\nWarning: API requires authentication but --no-auth was specified'
        )
      );
    }

    // Create executable tools
    const tools = createExecutableTools(toolDefs, baseUrl, authManager);

    // Initialize session
    const session: Session = {
      baseUrl,
      tools,
      authConfig,
      accessToken: authManager.getAccessToken(),
    };

    // Start chat loop
    await startChatLoop(session);
  } catch (error) {
    spinner.fail();

    if (error instanceof UnsupportedSchemaError) {
      console.error(chalk.red(`\nSchema Error: ${error.message}`));
      console.error(
        chalk.dim(
          'This OpenAPI specification contains features that are not supported.'
        )
      );
    } else if (error instanceof AuthenticationError) {
      console.error(chalk.red(`\nAuth Error: ${error.message}`));
    } else if (error instanceof SpecLoadError) {
      console.error(chalk.red(`\nSpec Error: ${error.message}`));
    } else {
      console.error(
        chalk.red(
          `\nError: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }

    process.exit(1);
  }
}

async function startChatLoop(session: Session): Promise<void> {
  // Initialize agent
  const agent = new Agent({ tools: session.tools });

  console.log(chalk.bold('\n--- Spec2Tools ---'));
  console.log(chalk.dim('Type your message or use special commands:'));
  console.log(chalk.dim('  /tools  - List available tools'));
  console.log(chalk.dim('  /call   - Call a tool directly'));
  console.log(chalk.dim('  /schema - Show tool schema'));
  console.log(chalk.dim('  /help   - Show help'));
  console.log(chalk.dim('  /exit   - Exit the CLI'));
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(chalk.cyan('> '), async (input) => {
      const trimmedInput = input.trim();

      if (!trimmedInput) {
        prompt();
        return;
      }

      // Pause readline during async operations to prevent corruption
      rl.pause();

      try {
        await handleInput(trimmedInput, session, agent);
      } catch (error) {
        console.error(
          chalk.red(
            `Error: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      } finally {
        rl.resume();
        prompt();
      }
    });
  };

  rl.on('close', () => {
    console.log(chalk.dim('\nGoodbye!'));
    process.exit(0);
  });

  prompt();
}

async function handleInput(
  input: string,
  session: Session,
  agent: Agent
): Promise<void> {
  // Handle special commands
  if (input.startsWith('/')) {
    await handleCommand(input, session, agent);
    return;
  }

  // Regular chat message
  const spinner = ora('Thinking...').start();

  try {
    const response = await agent.chat(input);
    spinner.stop();
    console.log(chalk.white('\n' + response + '\n'));
  } catch (error) {
    spinner.fail('Failed to get response');
    throw error;
  }
}

async function handleCommand(
  input: string,
  session: Session,
  agent: Agent
): Promise<void> {
  const parts = input.slice(1).split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (command) {
    case 'tools':
      listTools(session.tools);
      break;

    case 'call':
      await callTool(session.tools, args);
      break;

    case 'schema':
      showSchema(session.tools, args[0]);
      break;

    case 'help':
      showHelp();
      break;

    case 'exit':
    case 'quit':
      console.log(chalk.dim('Goodbye!'));
      process.exit(0);

    case 'clear':
      agent.clearHistory();
      console.log(chalk.dim('Conversation history cleared.'));
      break;

    default:
      console.log(chalk.yellow(`Unknown command: ${command}`));
      console.log(chalk.dim('Type /help for available commands.'));
  }
}

function listTools(tools: Tool[]): void {
  console.log(chalk.bold('\nAvailable tools:'));

  tools.forEach((tool, index) => {
    const signature = formatToolSignature(tool);
    console.log(chalk.cyan(`${index + 1}. ${signature}`));
    console.log(chalk.dim(`   ${tool.description}`));
  });

  console.log('');
}

async function callTool(tools: Tool[], args: string[]): Promise<void> {
  if (args.length === 0) {
    console.log(chalk.yellow('Usage: /call <toolName> [--param value ...]'));
    console.log(chalk.dim('Example: /call createUser --name "John" --email "john@example.com"'));
    return;
  }

  const toolName = args[0];
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    console.log(chalk.red(`Tool not found: ${toolName}`));
    console.log(chalk.dim('Use /tools to see available tools.'));
    return;
  }

  // Parse remaining args as --key value pairs
  const params = parseCallArgs(args.slice(1));

  const spinner = ora(`Calling ${toolName}...`).start();

  try {
    const result = await executeToolByName(tools, toolName, params);
    spinner.succeed(`${toolName} completed`);
    console.log(chalk.white('\nResult:'));
    console.log(JSON.stringify(result, null, 2));
    console.log('');
  } catch (error) {
    spinner.fail(`${toolName} failed`);
    if (error instanceof ToolExecutionError) {
      console.error(chalk.red(error.message));
    } else {
      console.error(
        chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }
}

function parseCallArgs(args: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];

      if (value === undefined) {
        params[key] = true;
        i++;
      } else if (value.startsWith('--')) {
        params[key] = true;
        i++;
      } else {
        // Try to parse as JSON, number, or boolean
        params[key] = parseValue(value);
        i += 2;
      }
    } else {
      i++;
    }
  }

  return params;
}

function parseValue(value: string): unknown {
  // Remove quotes if present
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Try parsing as number
  const num = Number(value);
  if (!isNaN(num)) {
    return num;
  }

  // Check for boolean
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  // Try parsing as JSON
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function showSchema(tools: Tool[], toolName: string | undefined): void {
  if (!toolName) {
    console.log(chalk.yellow('Usage: /schema <toolName>'));
    return;
  }

  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    console.log(chalk.red(`Tool not found: ${toolName}`));
    console.log(chalk.dim('Use /tools to see available tools.'));
    return;
  }

  console.log(chalk.bold(`\nSchema for ${toolName}:`));
  console.log(chalk.white(formatToolSchema(tool)));
  console.log('');
}

function showHelp(): void {
  console.log(chalk.bold('\nAgent CLI Help'));
  console.log('');
  console.log(chalk.cyan('Chat Mode:'));
  console.log('  Just type your message to chat with the AI agent.');
  console.log('  The agent can use available tools to help you.');
  console.log('');
  console.log(chalk.cyan('Special Commands:'));
  console.log(
    chalk.white('  /tools') + chalk.dim('  - List all available tools')
  );
  console.log(
    chalk.white('  /call <tool> [args]') +
      chalk.dim('  - Call a tool directly')
  );
  console.log(
    chalk.white('  /schema <tool>') + chalk.dim('  - Show tool parameter schema')
  );
  console.log(
    chalk.white('  /clear') + chalk.dim('  - Clear conversation history')
  );
  console.log(chalk.white('  /help') + chalk.dim('  - Show this help message'));
  console.log(chalk.white('  /exit') + chalk.dim('  - Exit the CLI'));
  console.log('');
  console.log(chalk.cyan('Examples:'));
  console.log(chalk.dim('  > What can you do?'));
  console.log(chalk.dim('  > Create a user named John with email john@example.com'));
  console.log(chalk.dim('  > /call createUser --name "John" --email "john@example.com"'));
  console.log(chalk.dim('  > /schema createUser'));
  console.log('');
}
