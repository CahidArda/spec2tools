/**
 * Error thrown when encountering unsupported OpenAPI schema features
 */
export class UnsupportedSchemaError extends Error {
  constructor(path: string, reason: string) {
    super(`Unsupported schema at ${path}: ${reason}`);
    this.name = 'UnsupportedSchemaError';
  }
}

/**
 * Error thrown when authentication fails
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(`Authentication failed: ${message}`);
    this.name = 'AuthenticationError';
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ToolExecutionError extends Error {
  public readonly toolName: string;
  public readonly cause: Error;

  constructor(toolName: string, cause: Error) {
    super(`Tool ${toolName} failed: ${cause.message}`);
    this.name = 'ToolExecutionError';
    this.toolName = toolName;
    this.cause = cause;
  }
}

/**
 * Error thrown when OpenAPI spec is invalid or cannot be fetched
 */
export class SpecLoadError extends Error {
  constructor(message: string) {
    super(`Failed to load OpenAPI spec: ${message}`);
    this.name = 'SpecLoadError';
  }
}
