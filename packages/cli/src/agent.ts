import { generateText, stepCountIs, ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { type ToolSet, ToolExecutionError } from '@spec2tools/core';
import chalk from 'chalk';

const MAX_OUTPUT_LENGTH = 500;

/**
 * Trim a string if it exceeds the maximum length
 */
function trimOutput(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length > MAX_OUTPUT_LENGTH) {
    return str.substring(0, MAX_OUTPUT_LENGTH) + '...';
  }
  return str;
}

interface AgentConfig {
  tools: ToolSet;
  model?: string;
  maxSteps?: number;
}

/**
 * AI Agent that uses OpenAPI tools
 */
export class Agent {
  private tools: ToolSet;
  private model: string;
  private maxSteps: number;
  private conversationHistory: ModelMessage[];

  constructor(config: AgentConfig) {
    this.tools = config.tools;
    this.model = config.model || 'gpt-5.1-chat-latest';
    this.maxSteps = config.maxSteps || 10;
    this.conversationHistory = [];
  }

  /**
   * Get available tools description for the agent
   */
  getToolsDescription(): string {
    const names = Object.keys(this.tools);
    if (names.length === 0) {
      return 'No tools available.';
    }

    const toolDescriptions = names.map((name) => {
      const t = this.tools[name];
      const desc = 'description' in t ? t.description : '';
      return `- ${name}: ${desc}`;
    });

    return `I have access to the following tools:\n${toolDescriptions.join('\n')}`;
  }

  /**
   * Process a user message and return the response
   */
  async chat(userMessage: string): Promise<string> {
    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    try {
      // Wrap each tool to add CLI logging
      const wrappedTools: ToolSet = {};
      for (const [name, t] of Object.entries(this.tools)) {
        const originalExecute = 'execute' in t ? t.execute : undefined;
        wrappedTools[name] = {
          ...t,
          execute: originalExecute
            ? async (params: unknown, options: unknown) => {
                console.log(
                  chalk.dim(`\n[Calling ${name} with ${JSON.stringify(params)}]`)
                );
                try {
                  const result = await (originalExecute as Function)(params, options);
                  console.log(
                    chalk.dim(`[${name} returned: ${trimOutput(result)}]\n`)
                  );
                  return result;
                } catch (error) {
                  if (error instanceof ToolExecutionError) {
                    console.log(chalk.red(`[${name} failed: ${error.message}]\n`));
                  }
                  throw error;
                }
              }
            : undefined,
        } as ToolSet[string];
      }

      // Build system prompt
      const systemPrompt = `You are a helpful AI assistant with access to various API tools.
When the user asks you to perform actions, use the available tools to help them.
Always explain what you're doing and present results in a clear, readable format.
If a tool call fails, explain the error to the user.`;

      // Generate response with tool use
      const result = await generateText({
        model: openai(this.model),
        system: systemPrompt,
        messages: this.conversationHistory,
        tools: wrappedTools,
        stopWhen: stepCountIs(this.maxSteps),
      });

      // Add assistant response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: result.text,
      });

      return result.text;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Add error response to history
      this.conversationHistory.push({
        role: 'assistant',
        content: `I encountered an error: ${errorMessage}`,
      });

      throw error;
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get the list of tool names
   */
  getToolNames(): string[] {
    return Object.keys(this.tools);
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): ToolSet[string] | undefined {
    return this.tools[name];
  }
}
