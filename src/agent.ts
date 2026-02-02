import { generateText, tool, stepCountIs, ModelMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Tool } from './types.js';
import { ToolExecutionError } from './errors.js';
import chalk from 'chalk';

interface AgentConfig {
  tools: Tool[];
  model?: string;
  maxSteps?: number;
}

/**
 * AI Agent that uses OpenAPI tools
 */
export class Agent {
  private tools: Tool[];
  private model: string;
  private maxSteps: number;
  private conversationHistory: ModelMessage[];

  constructor(config: AgentConfig) {
    this.tools = config.tools;
    this.model = config.model || 'gpt-4o';
    this.maxSteps = config.maxSteps || 10;
    this.conversationHistory = [];
  }

  /**
   * Get available tools description for the agent
   */
  getToolsDescription(): string {
    if (this.tools.length === 0) {
      return 'No tools available.';
    }

    const toolDescriptions = this.tools.map((tool) => {
      return `- ${tool.name}: ${tool.description}`;
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
      // Build AI SDK tools from our tool definitions
      const aiTools: Parameters<typeof generateText>[0]['tools'] = {};

      for (const t of this.tools) {
        const toolExecute = t.execute;
        const toolName = t.name;

        aiTools![t.name] = tool({
          description: t.description,
          inputSchema: t.parameters,
          execute: async (params) => {
            console.log(
              chalk.dim(`\n[Calling ${toolName} with ${JSON.stringify(params)}]`)
            );

            try {
              const result = await toolExecute(params);
              console.log(
                chalk.dim(`[${toolName} returned: ${JSON.stringify(result)}]\n`)
              );
              return result;
            } catch (error) {
              if (error instanceof ToolExecutionError) {
                console.log(chalk.red(`[${toolName} failed: ${error.message}]\n`));
                throw error;
              }
              throw error;
            }
          },
        });
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
        tools: aiTools,
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
    return this.tools.map((t) => t.name);
  }

  /**
   * Get a specific tool by name
   */
  getTool(name: string): Tool | undefined {
    return this.tools.find((t) => t.name === name);
  }
}
