/**
 * AuthenticationManager
 * Handles OAuth 2.0 token lifecycle, automatic refresh, and secure storage
 * - Intercepts all requests to inject Authorization header
 * - Automatically refreshes expired tokens
 * - Handles concurrent requests during token refresh
 * - Supports both file-based and memory-based token storage
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { TokenPayload, OAuthTokenResponse, AuthConfig, ErrorCode } from '../types';
import { QuestradeError } from '../types';
import { Logger } from './logger';

const TOKEN_BUFFER_SECONDS = 30; // Refresh token 30s before expiry
const REFRESH_TOKEN_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 hours

export class AuthenticationManager extends EventEmitter {
  private tokenPayload: TokenPayload | null = null;
  private refreshPromise: Promise<void> | null = null;
  private config: AuthConfig;
  private storagePath: string;
  private encryptionKey?: Buffer;
  private logger: Logger;
  private lastRefreshTime: number = 0;

  constructor(
    config: AuthConfig,
    storagePath: string,
    logger: Logger,
    encryptionKey?: string
  ) {
    super();
    this.config = config;
    this.storagePath = storagePath;
    this.logger = logger;

    if (encryptionKey) {
      this.encryptionKey = Buffer.from(
        crypto.createHash('sha256').update(encryptionKey).digest()
      );
    }

    this.setMaxListeners(10);
  }

  /**
   * Initialize with existing token or perform OAuth flow
   */
  async initialize(authCode?: string): Promise<void> {
    try {
      // Try to load from disk first
      const stored = await this.loadTokenFromDisk();
      if (stored && !this.isTokenExpired(stored)) {
        this.tokenPayload = stored;
        this.logger.info('Token loaded from disk', { userId: stored.userId });
        await this.validateAndRefreshIfNeeded();
        return;
      }

      // If auth code provided, perform OAuth exchange
      if (authCode) {
        await this.exchangeAuthCodeForToken(authCode);
        return;
      }

      throw new Error('No valid token available and no auth code provided');
    } catch (error) {
      this.logger.error('Failed to initialize authentication', { error });
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeAuthCodeForToken(code: string): Promise<void> {
    try {
      const response = await fetch(
        'https://login.questrade.com/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            ...(this.config.clientSecret && { client_secret: this.config.clientSecret }),
            code,
            grant_type: 'authorization_code',
            redirect_uri: this.config.redirectUri,
          }).toString(),
        }
      );

      if (!response.ok) {
        throw new Error(`OAuth token exchange failed: ${response.statusText}`);
      }

      const oauthResponse = (await response.json()) as OAuthTokenResponse;
      this.setTokenPayload(oauthResponse);
      await this.saveTokenToDisk();
      
      this.logger.info('Successfully obtained new token via OAuth', {
        expiresIn: oauthResponse.expires_in,
      });
    } catch (error) {
      this.logger.error('Failed to exchange auth code for token', { error });
      throw error;
    }
  }

  /**
   * Get Authorization header value
   */
  getAuthorizationHeader(): string {
    if (!this.tokenPayload) {
      throw this.createError(
        ErrorCode.UNAUTHORIZED,
        'No valid token available',
        401
      );
    }

    if (this.isTokenExpired(this.tokenPayload)) {
      throw this.createError(
        ErrorCode.TOKEN_EXPIRED,
        'Token has expired',
        401
      );
    }

    return `Bearer ${this.tokenPayload.accessToken}`;
  }

  /**
   * Get API server URL
   */
  getApiServer(): string {
    if (!this.tokenPayload) {
      throw this.createError(
        ErrorCode.UNAUTHORIZED,
        'No valid token available',
        401
      );
    }
    return this.tokenPayload.apiServer;
  }

  /**
   * Middleware to inject auth header and handle token refresh
   */
  async executeWithAuth<T>(
    requestFn: (header: string) => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    const maxRetries = 2;

    try {
      // Wait for any ongoing refresh to complete
      if (this.refreshPromise) {
        await this.refreshPromise;
      }

      // Check if token needs refresh before making request
      await this.validateAndRefreshIfNeeded();

      const header = this.getAuthorizationHeader();
      return await requestFn(header);
    } catch (error) {
      // If 401 Unauthorized and we haven't retried yet, refresh and retry
      if (
        error instanceof Error &&
        error.message.includes('401') &&
        retryCount < maxRetries
      ) {
        this.logger.warn('Received 401, attempting token refresh', { retryCount });
        
        // Prevent concurrent refresh attempts
        if (!this.refreshPromise) {
          this.refreshPromise = this.refreshToken();
        }
        
        await this.refreshPromise;
        return this.executeWithAuth(requestFn, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Validate token and refresh if needed
   */
  private async validateAndRefreshIfNeeded(): Promise<void> {
    if (!this.tokenPayload) return;

    const now = Date.now();
    const timeToExpiry = this.tokenPayload.expiresAt - now;

    // Refresh if token expires within buffer or refresh token expiring soon
    if (
      timeToExpiry < TOKEN_BUFFER_SECONDS * 1000 ||
      this.tokenPayload.refreshTokenExpiresAt - now < 60 * 60 * 1000 // 1 hour before RT expires
    ) {
      await this.refreshToken();
    }
  }

  /**
   * Refresh the access token using refresh token
   */
  async refreshToken(): Promise<void> {
    // Prevent concurrent refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this._performTokenRefresh();
    return this.refreshPromise.finally(() => {
      this.refreshPromise = null;
    });
  }

  private async _performTokenRefresh(): Promise<void> {
    try {
      if (!this.tokenPayload) {
        throw new Error('No token payload to refresh');
      }

      const now = Date.now();
      if (now - this.lastRefreshTime < 5000) {
        this.logger.debug('Skipping refresh: last refresh within 5s');
        return;
      }

      this.lastRefreshTime = now;

      const response = await fetch(
        'https://login.questrade.com/oauth2/token',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            ...(this.config.clientSecret && { client_secret: this.config.clientSecret }),
            refresh_token: this.tokenPayload.refreshToken,
            grant_type: 'refresh_token',
          }).toString(),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Token refresh failed (${response.status}): ${error}`
        );
      }

      const oauthResponse = (await response.json()) as OAuthTokenResponse;
      this.setTokenPayload(oauthResponse);
      await this.saveTokenToDisk();

      this.emit('token-refreshed', {
        timestamp: Date.now(),
        expiresIn: oauthResponse.expires_in,
      });

      this.logger.info('Token successfully refreshed', {
        expiresIn: oauthResponse.expires_in,
      });
    } catch (error) {
      this.emit('token-refresh-failed', error);
      this.logger.error('Failed to refresh token', { error });
      throw error;
    }
  }

  /**
   * Set token payload from OAuth response
   */
  private setTokenPayload(oauthResponse: OAuthTokenResponse): void {
    const now = Date.now();
    this.tokenPayload = {
      accessToken: oauthResponse.access_token,
      refreshToken: oauthResponse.refresh_token,
      apiServer: oauthResponse.api_server,
      expiresAt: now + oauthResponse.expires_in * 1000,
      refreshTokenExpiresAt: now + REFRESH_TOKEN_EXPIRY_MS,
    };
  }

  /**
   * Check if token is expired
   */
  private isTokenExpired(token: TokenPayload): boolean {
    return Date.now() > token.expiresAt;
  }

  /**
   * Save token to disk (encrypted if key provided)
   */
  private async saveTokenToDisk(): Promise<void> {
    if (!this.tokenPayload) return;

    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });

      let data = JSON.stringify(this.tokenPayload);

      if (this.encryptionKey) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        data = JSON.stringify({ iv: iv.toString('hex'), data: encrypted });
      }

      await fs.writeFile(this.storagePath, data, { mode: 0o600 });
      this.logger.debug('Token saved to disk');
    } catch (error) {
      this.logger.error('Failed to save token to disk', { error });
      throw error;
    }
  }

  /**
   * Load token from disk (decrypt if needed)
   */
  private async loadTokenFromDisk(): Promise<TokenPayload | null> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf-8');
      let parsed = JSON.parse(data);

      if (this.encryptionKey && parsed.iv) {
        const decipher = crypto.createDecipheriv(
          'aes-256-cbc',
          this.encryptionKey,
          Buffer.from(parsed.iv, 'hex')
        );
        let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        parsed = JSON.parse(decrypted);
      }

      return parsed as TokenPayload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      this.logger.warn('Failed to load token from disk', { error });
      return null;
    }
  }

  /**
   * Clear token (logout)
   */
  async clearToken(): Promise<void> {
    this.tokenPayload = null;
    try {
      await fs.unlink(this.storagePath);
      this.logger.info('Token cleared');
    } catch (error) {
      // File may not exist
    }
  }

  /**
   * Get token info (for debugging)
   */
  getTokenInfo() {
    if (!this.tokenPayload) return null;

    return {
      apiServer: this.tokenPayload.apiServer,
      expiresIn: Math.round((this.tokenPayload.expiresAt - Date.now()) / 1000),
      refreshTokenExpiresIn: Math.round(
        (this.tokenPayload.refreshTokenExpiresAt - Date.now()) / 1000
      ),
      isExpired: this.isTokenExpired(this.tokenPayload),
    };
  }

  /**
   * Create strongly-typed error
   */
  private createError(
    code: ErrorCode,
    message: string,
    statusCode: number
  ): QuestradeError {
    const error = new QuestradeError(
      message,
      code,
      statusCode,
      statusCode >= 500 || statusCode === 429
    );
    return error;
  }
}
