/**
 * QuestradeClient
 * Central orchestrator for all API operations
 * - Coordinates authentication, rate limiting, error handling, and streaming
 * - Provides type-safe API methods for all endpoints
 * - Handles request/response lifecycle with retry logic
 * - Emits events for observability
 */

import { EventEmitter } from 'events';
import fetch, { Response } from 'node-fetch';
import {
  Account,
  AccountBalance,
  Position,
  Order,
  OrderRequest,
  OrderStatus,
  Quote,
  Execution,
  Activity,
  Symbol,
  SymbolSearchResult,
  Market,
  StreamConfig,
  HTTPResponse,
  RateLimitHeaders,
  EndpointCategory,
  QuestradeError,
  ErrorCode,
  StreamEventType,
  StreamMessage,
} from './types';
import { AuthenticationManager } from './modules/authentication';
import { RateLimitingQueue } from './modules/queue';
import { ErrorInterceptor } from './modules/error-handler';
import { StreamingEngine } from './modules/streaming';
import { Logger } from './modules/logger';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

export class QuestradeClient extends EventEmitter {
  private auth: AuthenticationManager;
  private queue: RateLimitingQueue;
  private errorHandler: ErrorInterceptor;
  private stream: StreamingEngine;
  private logger: Logger;
  private requestIdCounter = 0;

  constructor(
    authConfig: {
      clientId: string;
      clientSecret?: string;
      redirectUri: string;
    },
    options?: {
      logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
      logFile?: string;
      prettyPrint?: boolean;
      tokenStoragePath?: string;
      encryptionKey?: string;
    }
  ) {
    super();

    // Initialize logger
    this.logger = new Logger(
      options?.logLevel || 'info',
      options?.logFile || '.keys/logs/questrade-api.log',
      options?.prettyPrint !== false
    );

    this.logger.info('Initializing QuestradeClient');

    // Initialize modules
    this.auth = new AuthenticationManager(
      authConfig,
      options?.tokenStoragePath || '.keys/tokens.json',
      this.logger,
      options?.encryptionKey
    );

    this.queue = new RateLimitingQueue(this.logger);
    this.errorHandler = new ErrorInterceptor(this.logger);

    this.stream = new StreamingEngine(
      this.logger,
      () => this.auth.getAuthorizationHeader().replace('Bearer ', ''),
      () => this.getStreamConfig()
    );

    // Wire up event handlers
    this.wireUpEventHandlers();

    // Start queue processing
    this.queue.start();
  }

  /**
   * Wire up event handlers between modules
   */
  private wireUpEventHandlers(): void {
    this.queue.on('request-completed', ({ requestId, duration, category }) => {
      this.emit('request-completed', { requestId, duration, category });
    });

    this.queue.on('request-failed', ({ requestId, category, error }) => {
      this.emit('request-failed', { requestId, category, error });
    });

    this.queue.on('rate-limit-exceeded', ({ category, waitMs }) => {
      this.logger.warn('Rate limit exceeded', { category, waitMs });
      this.emit('rate-limit-exceeded', { category, waitMs });
    });

    this.stream.on('stream-connected', ({ sessionId }) => {
      this.emit('stream-connected', { sessionId });
    });

    this.stream.on('stream-message', ({ sessionId, message }) => {
      this.emit('stream-message', { sessionId, message });
    });

    this.stream.on('stream-disconnected', ({ sessionId }) => {
      this.emit('stream-disconnected', { sessionId });
    });

    this.stream.on('stream-error', ({ sessionId, error }) => {
      this.emit('stream-error', { sessionId, error });
    });

    this.auth.on('token-refreshed', (data) => {
      this.emit('token-refreshed', data);
    });

    this.auth.on('token-refresh-failed', (error) => {
      this.emit('token-refresh-failed', error);
    });
  }

  /**
   * Initialize client with authorization code
   */
  async initialize(authCode?: string): Promise<void> {
    await this.auth.initialize(authCode);
    this.logger.info('QuestradeClient initialized');
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthorizationUrl(scopes?: string[]): string {
    const params = new URLSearchParams({
      client_id: process.env.QUESTRADE_CLIENT_ID || '',
      response_type: 'code',
      redirect_uri: process.env.QUESTRADE_REDIRECT_URI || '',
      ...(scopes && { scope: scopes.join(',') }),
    });

    return `https://login.questrade.com/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Core request method with rate limiting and error handling
   */
  private async request<T = any>(
    category: EndpointCategory,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: any,
    priority = 5
  ): Promise<T> {
    const requestId = this.generateRequestId();
    this.logger.pushRequestContext(requestId, { category, method, path });

    try {
      return await new Promise((resolve, reject) => {
        // Enqueue request
        const queueId = this.queue.enqueue(category, method, path, priority, body);

        // Register handler
        this.queue.registerHandler(queueId, async (queuedReq) => {
          try {
            const result = await this.auth.executeWithAuth(
              (authHeader) => this.performRequest<T>(method, path, authHeader, body)
            );

            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
    } catch (error) {
      const questradeError = error as QuestradeError;
      this.logger.error('Request failed', {
        error: questradeError.message,
        code: questradeError.code,
        statusCode: questradeError.statusCode,
      });
      throw error;
    } finally {
      this.logger.popRequestContext();
    }
  }

  /**
   * Perform actual HTTP request
   */
  private async performRequest<T = any>(
    method: string,
    path: string,
    authHeader: string,
    body?: any
  ): Promise<T> {
    const apiServer = this.auth.getApiServer();
    const url = `${apiServer}${path}`;

    const fetchOptions: any = {
      method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      fetchOptions.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, fetchOptions);
      return this.handleResponse<T>(response);
    } catch (error) {
      this.errorHandler.handleNetworkError(error as Error, {
        method,
        path,
        url,
      });
    }
  }

  /**
   * Handle HTTP response
   */
  private async handleResponse<T = any>(response: Response): Promise<T> {
    let body: any;

    try {
      const text = await response.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const httpResponse: HTTPResponse<T> = {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      timestamp: Date.now(),
    };

    // Extract and update rate limit headers
    if (httpResponse.headers['x-ratelimit-remaining']) {
      const category =
        httpResponse.headers['x-ratelimit-category'] === 'market-data'
          ? EndpointCategory.MARKET_DATA
          : EndpointCategory.ACCOUNT;

      this.queue.updateRateLimitFromHeaders(
        category,
        parseInt(httpResponse.headers['x-ratelimit-remaining'], 10),
        parseInt(httpResponse.headers['x-ratelimit-reset'], 10) * 1000
      );
    }

    return this.errorHandler.parseResponse(httpResponse) as any;
  }

  /**
   * ===== ACCOUNT OPERATIONS =====
   */

  async getAccounts(): Promise<Account[]> {
    const response = await this.request<{ accounts: Account[] }>(
      EndpointCategory.ACCOUNT,
      'GET',
      '/accounts'
    );
    return response.accounts;
  }

  async getAccountBalance(accountId: number): Promise<AccountBalance> {
    return this.request<AccountBalance>(
      EndpointCategory.ACCOUNT,
      'GET',
      `/accounts/${accountId}/balances`
    );
  }

  async getPositions(accountId: number): Promise<Position[]> {
    const response = await this.request<{ positions: Position[] }>(
      EndpointCategory.ACCOUNT,
      'GET',
      `/accounts/${accountId}/positions`
    );
    return response.positions;
  }

  async getOrders(accountId: number): Promise<Order[]> {
    const response = await this.request<{ orders: Order[] }>(
      EndpointCategory.ACCOUNT,
      'GET',
      `/accounts/${accountId}/orders`
    );
    return response.orders;
  }

  async placeOrder(accountId: number, order: OrderRequest): Promise<{ orderId: string }> {
    return this.request<{ orderId: string }>(
      EndpointCategory.ACCOUNT,
      'POST',
      `/accounts/${accountId}/orders`,
      order,
      8 // Higher priority for order placement
    );
  }

  async cancelOrder(accountId: number, orderId: string): Promise<void> {
    await this.request<void>(
      EndpointCategory.ACCOUNT,
      'DELETE',
      `/accounts/${accountId}/orders/${orderId}`,
      undefined,
      9 // Highest priority for cancellations
    );
  }

  async getExecutions(accountId: number): Promise<Execution[]> {
    const response = await this.request<{ executions: Execution[] }>(
      EndpointCategory.ACCOUNT,
      'GET',
      `/accounts/${accountId}/executions`
    );
    return response.executions;
  }

  async getActivities(accountId: number, startDate?: string, endDate?: string): Promise<Activity[]> {
    let path = `/accounts/${accountId}/activities`;
    if (startDate || endDate) {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      path += `?${params.toString()}`;
    }

    const response = await this.request<{ activities: Activity[] }>(
      EndpointCategory.ACCOUNT,
      'GET',
      path
    );
    return response.activities;
  }

  /**
   * ===== MARKET DATA OPERATIONS =====
   */

  async getMarkets(): Promise<Market[]> {
    const response = await this.request<{ markets: Market[] }>(
      EndpointCategory.MARKET_DATA,
      'GET',
      '/markets'
    );
    return response.markets;
  }

  async getQuote(symbolId: number): Promise<Quote> {
    return this.request<Quote>(
      EndpointCategory.MARKET_DATA,
      'GET',
      `/markets/quotes/${symbolId}`
    );
  }

  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult> {
    const params = new URLSearchParams({ prefix: query, limit: limit.toString() });
    return this.request<SymbolSearchResult>(
      EndpointCategory.MARKET_DATA,
      'GET',
      `/symbols/search?${params.toString()}`
    );
  }

  /**
   * ===== STREAMING OPERATIONS =====
   */

  async connectStream(sessionId: string, type: 'level1' | 'level2' | 'trades' | 'notifications'): Promise<void> {
    await this.stream.createStream(sessionId, type);
  }

  subscribeToQuotes(sessionId: string, symbols: string[]) {
    const subscriptionId = `quotes-${Date.now()}`;
    return this.stream.subscribe(sessionId, subscriptionId, 'level1', symbols);
  }

  async closeStream(sessionId: string): Promise<void> {
    return this.stream.closeStream(sessionId);
  }

  /**
   * ===== UTILITY METHODS =====
   */

  private async getStreamConfig(): Promise<StreamConfig> {
    const response = await this.request<{ streamPort: number }>(
      EndpointCategory.ACCOUNT,
      'GET',
      '/notifications/stream'
    );
    return { streamPort: response.streamPort };
  }

  private generateRequestId(): string {
    return `req-${Date.now()}-${++this.requestIdCounter}`;
  }

  getTokenInfo() {
    return this.auth.getTokenInfo();
  }

  getQueueStats() {
    return this.queue.getStats();
  }

  getRateLimitInfo() {
    return this.queue.getRateLimitInfo();
  }

  async shutdown(): Promise<void> {
    this.logger.info('Shutting down QuestradeClient');
    this.queue.stop();
    await this.stream.closeAll();
    this.logger.close();
  }
}
