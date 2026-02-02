import express from 'express';
import open from 'open';
import { createServer, Server } from 'http';
import { AuthConfig } from './types.js';
import { AuthenticationError } from './errors.js';
import * as readline from 'readline';

const CALLBACK_PORT = 3000;
const CALLBACK_PATH = '/callback';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

export class AuthManager {
  private authConfig: AuthConfig;
  private accessToken?: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
  }

  /**
   * Check if authentication is required
   */
  requiresAuth(): boolean {
    return this.authConfig.type !== 'none';
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /**
   * Get authorization headers for requests
   */
  getAuthHeaders(): Record<string, string> {
    if (!this.accessToken) {
      return {};
    }

    switch (this.authConfig.type) {
      case 'oauth2':
      case 'bearer':
        return { Authorization: `Bearer ${this.accessToken}` };

      case 'apiKey':
        if (this.authConfig.apiKeyIn === 'header' && this.authConfig.apiKeyHeader) {
          return { [this.authConfig.apiKeyHeader]: this.accessToken };
        }
        return {};

      default:
        return {};
    }
  }

  /**
   * Get query parameters for API key auth
   */
  getAuthQueryParams(): Record<string, string> {
    if (
      this.authConfig.type === 'apiKey' &&
      this.authConfig.apiKeyIn === 'query' &&
      this.authConfig.apiKeyHeader &&
      this.accessToken
    ) {
      return { [this.authConfig.apiKeyHeader]: this.accessToken };
    }
    return {};
  }

  /**
   * Perform authentication based on config type
   */
  async authenticate(): Promise<void> {
    switch (this.authConfig.type) {
      case 'oauth2':
        await this.performOAuth2Flow();
        break;

      case 'apiKey':
        await this.promptForApiKey();
        break;

      case 'bearer':
        await this.promptForBearerToken();
        break;

      case 'none':
        // No authentication needed
        break;
    }
  }

  /**
   * Prompt user for API key
   */
  private async promptForApiKey(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const headerName = this.authConfig.apiKeyHeader || 'API-Key';

    this.accessToken = await new Promise<string>((resolve) => {
      rl.question(`Enter your API key (${headerName}): `, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!this.accessToken) {
      throw new AuthenticationError('API key is required');
    }
  }

  /**
   * Prompt user for bearer token
   */
  private async promptForBearerToken(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.accessToken = await new Promise<string>((resolve) => {
      rl.question('Enter your Bearer token: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!this.accessToken) {
      throw new AuthenticationError('Bearer token is required');
    }
  }

  /**
   * Perform OAuth2 authorization code flow
   */
  private async performOAuth2Flow(): Promise<void> {
    if (!this.authConfig.authorizationUrl || !this.authConfig.tokenUrl) {
      throw new AuthenticationError(
        'OAuth2 requires authorizationUrl and tokenUrl'
      );
    }

    // Get client credentials
    await this.getClientCredentials();

    // Start local callback server
    const authCode = await this.startCallbackServerAndAuthorize();

    // Exchange code for token
    await this.exchangeCodeForToken(authCode);
  }

  /**
   * Prompt for OAuth2 client credentials
   */
  private async getClientCredentials(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.clientId = await new Promise<string>((resolve) => {
      rl.question('Enter OAuth2 Client ID: ', (answer) => {
        resolve(answer.trim());
      });
    });

    this.clientSecret = await new Promise<string>((resolve) => {
      rl.question('Enter OAuth2 Client Secret: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });

    if (!this.clientId || !this.clientSecret) {
      throw new AuthenticationError('Client ID and Client Secret are required');
    }
  }

  /**
   * Start local callback server and initiate authorization
   */
  private async startCallbackServerAndAuthorize(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const app = express();
      let server: Server;

      app.get(CALLBACK_PATH, (req, res) => {
        const code = req.query.code as string;
        const error = req.query.error as string;

        if (error) {
          res.send(`
            <html>
              <body>
                <h1>Authentication Failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new AuthenticationError(error));
          return;
        }

        if (!code) {
          res.send(`
            <html>
              <body>
                <h1>Authentication Failed</h1>
                <p>No authorization code received.</p>
                <p>You can close this window.</p>
              </body>
            </html>
          `);
          server.close();
          reject(new AuthenticationError('No authorization code received'));
          return;
        }

        res.send(`
          <html>
            <body>
              <h1>Authentication Successful!</h1>
              <p>You can close this window and return to the CLI.</p>
            </body>
          </html>
        `);

        server.close();
        resolve(code);
      });

      server = createServer(app);

      server.listen(CALLBACK_PORT, () => {
        const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
        const authUrl = this.buildAuthorizationUrl(redirectUri);

        console.log('\nAuthentication required. Opening browser...');
        console.log(`If browser doesn't open, visit: ${authUrl}\n`);

        open(authUrl).catch(() => {
          console.log('Could not open browser automatically.');
        });
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(
            new AuthenticationError(
              `Port ${CALLBACK_PORT} is already in use. Please free the port and try again.`
            )
          );
        } else {
          reject(new AuthenticationError(err.message));
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        reject(new AuthenticationError('Authentication timed out'));
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Build the OAuth2 authorization URL
   */
  private buildAuthorizationUrl(redirectUri: string): string {
    const url = new URL(this.authConfig.authorizationUrl!);

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', redirectUri);

    if (this.authConfig.scopes && this.authConfig.scopes.length > 0) {
      url.searchParams.set('scope', this.authConfig.scopes.join(' '));
    }

    // Generate state for CSRF protection
    const state = Math.random().toString(36).substring(2, 15);
    url.searchParams.set('state', state);

    return url.toString();
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(code: string): Promise<void> {
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });

    const response = await fetch(this.authConfig.tokenUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AuthenticationError(
        `Token exchange failed: ${response.status} ${errorText}`
      );
    }

    const tokenResponse = (await response.json()) as TokenResponse;

    this.accessToken = tokenResponse.access_token;
    this.refreshToken = tokenResponse.refresh_token;
  }

  /**
   * Set access token directly (for testing or manual token entry)
   */
  setAccessToken(token: string): void {
    this.accessToken = token;
  }
}
