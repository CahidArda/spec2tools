import express from 'express';
import open from 'open';
import crypto from 'crypto';
import { createServer, Server } from 'http';
import { AuthConfig } from './types.js';
import { AuthenticationError } from './errors.js';
import * as readline from 'readline';

const CALLBACK_PORT = 54321;
const CALLBACK_PATH = '/callback';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in?: number;
}

interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

export class AuthManager {
  private globalAuthConfig: AuthConfig;
  private accessToken?: string;
  private refreshToken?: string;
  private clientId?: string;
  private clientSecret?: string;
  private codeVerifier?: string;

  constructor(globalAuthConfig: AuthConfig) {
    this.globalAuthConfig = globalAuthConfig;
  }

  /**
   * Check if authentication is required
   */
  requiresAuth(authConfig?: AuthConfig): boolean {
    const config = authConfig ?? this.globalAuthConfig;
    return config.type !== 'none';
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string | undefined {
    return this.accessToken;
  }

  /**
   * Get authorization headers for requests
   * @param authConfig Optional tool-specific auth config that overrides the global config
   */
  getAuthHeaders(authConfig?: AuthConfig): Record<string, string> {
    if (!this.accessToken) {
      return {};
    }

    const config = authConfig ?? this.globalAuthConfig;

    switch (config.type) {
      case 'oauth2':
      case 'bearer':
        return { Authorization: `Bearer ${this.accessToken}` };

      case 'basic':
        return { Authorization: `Basic ${this.accessToken}` };

      case 'apiKey':
        if (config.apiKeyIn === 'header' && config.apiKeyHeader) {
          return { [config.apiKeyHeader]: this.accessToken };
        }
        return {};

      default:
        return {};
    }
  }

  /**
   * Get query parameters for API key auth
   * @param authConfig Optional tool-specific auth config that overrides the global config
   */
  getAuthQueryParams(authConfig?: AuthConfig): Record<string, string> {
    const config = authConfig ?? this.globalAuthConfig;

    if (
      config.type === 'apiKey' &&
      config.apiKeyIn === 'query' &&
      config.apiKeyHeader &&
      this.accessToken
    ) {
      return { [config.apiKeyHeader]: this.accessToken };
    }
    return {};
  }

  /**
   * Perform authentication based on config type
   * @param authConfig Optional tool-specific auth config that overrides the global config
   */
  async authenticate(authConfig?: AuthConfig): Promise<void> {
    const config = authConfig ?? this.globalAuthConfig;

    switch (config.type) {
      case 'oauth2':
        await this.performOAuth2Flow(config);
        break;

      case 'apiKey':
        await this.promptForApiKey(config);
        break;

      case 'bearer':
        await this.promptForBearerToken();
        break;

      case 'basic':
        await this.promptForBasicAuth();
        break;

      case 'none':
        // No authentication needed
        break;
    }
  }

  /**
   * Prompt user for API key
   */
  private async promptForApiKey(config: AuthConfig): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const headerName = config.apiKeyHeader || 'API-Key';

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
   * Prompt user for basic auth credentials
   */
  private async promptForBasicAuth(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer.trim());
        });
      });
    };

    const username = await question('Enter username: ');
    const password = await question('Enter password: ');
    rl.close();

    if (!username || !password) {
      throw new AuthenticationError('Username and password are required for Basic auth');
    }

    // Base64 encode the credentials
    this.accessToken = Buffer.from(`${username}:${password}`).toString('base64');
  }

  /**
   * Perform OAuth2 authorization code flow
   */
  private async performOAuth2Flow(config: AuthConfig): Promise<void> {
    if (!config.authorizationUrl || !config.tokenUrl) {
      throw new AuthenticationError(
        'OAuth2 requires authorizationUrl and tokenUrl'
      );
    }

    // Register client dynamically
    await this.registerClient(config);

    // Start local callback server
    const authCode = await this.startCallbackServerAndAuthorize(config);

    // Exchange code for token
    await this.exchangeCodeForToken(authCode, config);
  }

  /**
   * Register OAuth2 client dynamically
   */
  private async registerClient(config: AuthConfig): Promise<void> {
    // Derive registration URL from token URL (replace /token with /register)
    const registrationUrl = config.tokenUrl!.replace(/\/token$/, '/register');
    const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;

    console.log('Registering OAuth2 client...');

    const response = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_name: 'OpenAPI Agent CLI',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'none',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AuthenticationError(
        `Client registration failed: ${response.status} ${errorText}`
      );
    }

    const registration = (await response.json()) as ClientRegistrationResponse;
    this.clientId = registration.client_id;
    this.clientSecret = registration.client_secret;

    console.log('Client registered successfully.');
  }

  /**
   * Start local callback server and initiate authorization
   */
  private async startCallbackServerAndAuthorize(config: AuthConfig): Promise<string> {
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

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;
        const authUrl = this.buildAuthorizationUrl(redirectUri, config);

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
   * Generate PKCE code verifier and challenge
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate random code verifier (43-128 characters)
    const verifier = crypto.randomBytes(32).toString('base64url');

    // Create code challenge using SHA-256
    const challenge = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');

    return { verifier, challenge };
  }

  /**
   * Build the OAuth2 authorization URL
   */
  private buildAuthorizationUrl(redirectUri: string, config: AuthConfig): string {
    const url = new URL(config.authorizationUrl!);

    // Generate PKCE
    const pkce = this.generatePKCE();
    this.codeVerifier = pkce.verifier;

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId!);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    if (config.scopes && config.scopes.length > 0) {
      url.searchParams.set('scope', config.scopes.join(' '));
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('base64url');
    url.searchParams.set('state', state);

    return url.toString();
  }

  /**
   * Exchange authorization code for access token
   */
  private async exchangeCodeForToken(code: string, config: AuthConfig): Promise<void> {
    const redirectUri = `http://127.0.0.1:${CALLBACK_PORT}${CALLBACK_PATH}`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.clientId!,
      code_verifier: this.codeVerifier!,
    });

    // Only include client_secret if set (public clients don't have one)
    if (this.clientSecret) {
      params.set('client_secret', this.clientSecret);
    }

    const response = await fetch(config.tokenUrl!, {
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
