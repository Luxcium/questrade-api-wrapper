/**
 * RateLimitingQueue
 * Dual-tier request queue with category-based rate limiting
 * - Account operations: 30 RPS max
 * - Market data: 20 RPS max
 * - Automatic backoff on 429 (Too Many Requests)
 * - Priority scheduling for high-priority requests
 * - Per-category independent rate limiting
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  QueuedRequest,
  EndpointCategory,
  RateLimitState,
  QueueStats,
  ErrorCode,
} from '../types';
import { Logger } from './logger';

const RPS_LIMITS = {
  [EndpointCategory.ACCOUNT]: parseInt(process.env.RATE_LIMIT_ACCOUNT_RPS || '30', 10),
  [EndpointCategory.MARKET_DATA]: parseInt(process.env.RATE_LIMIT_MARKET_RPS || '20', 10),
};

const BATCH_INTERVAL_MS = 100; // Process queue every 100ms
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

interface QueueMetrics {
  processedCount: number;
  failedCount: number;
  processingTimes: number[];
}

export class RateLimitingQueue extends EventEmitter {
  private accountQueue: QueuedRequest[] = [];
  private marketQueue: QueuedRequest[] = [];
  private rateLimitState: Map<EndpointCategory, RateLimitState> = new Map();
  private processingInterval: ReturnType<typeof setInterval> | null = null;
  private metrics: QueueMetrics = {
    processedCount: 0,
    failedCount: 0,
    processingTimes: [],
  };
  private requestHandlers: Map<string, (req: QueuedRequest) => Promise<any>> = new Map();
  private logger: Logger;
  private isProcessing = false;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.initializeRateLimitState();
  }

  /**
   * Initialize rate limit state for each category
   */
  private initializeRateLimitState(): void {
    this.rateLimitState.set(EndpointCategory.ACCOUNT, {
      category: EndpointCategory.ACCOUNT,
      remaining: RPS_LIMITS[EndpointCategory.ACCOUNT],
      resetTimestamp: Date.now() + 1000,
      limit: RPS_LIMITS[EndpointCategory.ACCOUNT],
    });

    this.rateLimitState.set(EndpointCategory.MARKET_DATA, {
      category: EndpointCategory.MARKET_DATA,
      remaining: RPS_LIMITS[EndpointCategory.MARKET_DATA],
      resetTimestamp: Date.now() + 1000,
      limit: RPS_LIMITS[EndpointCategory.MARKET_DATA],
    });
  }

  /**
   * Enqueue request with priority
   */
  enqueue<T = any>(
    category: EndpointCategory,
    method: string,
    path: string,
    priority = 5,
    body?: T,
    headers?: Record<string, string>
  ): string {
    const request: QueuedRequest<T> = {
      id: uuidv4(),
      category,
      priority: Math.min(Math.max(priority, 0), 10),
      method: method as any,
      path,
      body,
      headers,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: MAX_RETRIES,
    };

    const queue = this.getQueue(category);
    queue.push(request);

    // Sort by priority descending
    queue.sort((a, b) => b.priority - a.priority);

    this.logger.debug('Request enqueued', {
      requestId: request.id,
      category,
      queueSize: queue.length,
      priority,
    });

    return request.id;
  }

  /**
   * Get appropriate queue for category
   */
  private getQueue(category: EndpointCategory): QueuedRequest[] {
    return category === EndpointCategory.ACCOUNT
      ? this.accountQueue
      : this.marketQueue;
  }

  /**
   * Register handler for processing requests
   */
  registerHandler(
    requestId: string,
    handler: (req: QueuedRequest) => Promise<any>
  ): void {
    this.requestHandlers.set(requestId, handler);
  }

  /**
   * Start processing queue
   */
  start(): void {
    if (this.processingInterval) return;

    this.processingInterval = setInterval(() => {
      this.processQueue().catch(error => {
        this.logger.error('Queue processing error', { error });
      });
    }, BATCH_INTERVAL_MS);

    this.logger.info('Rate limiting queue started');
  }

  /**
   * Stop processing queue
   */
  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    this.logger.info('Rate limiting queue stopped');
  }

  /**
   * Main processing loop
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = Date.now();

      // Process account requests
      await this.processCategory(EndpointCategory.ACCOUNT, now);

      // Process market data requests
      await this.processCategory(EndpointCategory.MARKET_DATA, now);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process requests for a specific category
   */
  private async processCategory(
    category: EndpointCategory,
    now: number
  ): Promise<void> {
    const state = this.rateLimitState.get(category)!;
    const queue = this.getQueue(category);

    // Reset counter if window expired
    if (now >= state.resetTimestamp) {
      state.remaining = state.limit;
      state.resetTimestamp = now + 1000;
    }

    // If rate limited, wait
    if (state.remaining <= 0) {
      const waitMs = Math.max(state.resetTimestamp - now, 0);
      this.logger.debug(`Rate limit hit for ${category}, waiting ${waitMs}ms`);
      this.emit('rate-limit-exceeded', { category, waitMs });
      return;
    }

    // Process requests up to rate limit
    const available = state.remaining;
    for (let i = 0; i < Math.min(available, queue.length); i++) {
      const request = queue.shift();
      if (!request) break;

      state.remaining--;

      // Execute request asynchronously
      this.executeRequest(request).catch(error => {
        this.logger.error('Request execution failed', {
          requestId: request.id,
          error,
          retries: request.retries,
        });
      });
    }
  }

  /**
   * Execute single request with retry logic
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    const startTime = Date.now();

    try {
      const handler = this.requestHandlers.get(request.id);
      if (!handler) {
        throw new Error(`No handler registered for request ${request.id}`);
      }

      const result = await handler(request);
      this.requestHandlers.delete(request.id);

      const duration = Date.now() - startTime;
      this.metrics.processedCount++;
      this.metrics.processingTimes.push(duration);

      // Keep only last 1000 measurements
      if (this.metrics.processingTimes.length > 1000) {
        this.metrics.processingTimes.shift();
      }

      this.emit('request-completed', {
        requestId: request.id,
        duration,
        category: request.category,
      });

      this.logger.debug('Request completed', {
        requestId: request.id,
        duration,
        category: request.category,
      });
    } catch (error) {
      await this.handleRequestError(request, error);
    }
  }

  /**
   * Handle request failure with retry logic
   */
  private async handleRequestError(
    request: QueuedRequest,
    error: any
  ): Promise<void> {
    const isRetryable =
      error.statusCode >= 500 ||
      error.statusCode === 429 ||
      error.code === ErrorCode.NETWORK_ERROR;

    if (isRetryable && request.retries < request.maxRetries) {
      request.retries++;

      // Exponential backoff: 1s, 2s, 4s
      const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, request.retries - 1);

      this.logger.warn('Retrying request', {
        requestId: request.id,
        retry: request.retries,
        backoffMs,
        category: request.category,
      });

      // Re-queue with delay
      setTimeout(() => {
        const queue = this.getQueue(request.category);
        queue.push(request);
        queue.sort((a, b) => b.priority - a.priority);
      }, backoffMs);

      // Handle 429 with rate limit backoff
      if (error.statusCode === 429 && error.context?.resetTimestamp) {
        const state = this.rateLimitState.get(request.category);
        if (state) {
          state.resetTimestamp = error.context.resetTimestamp;
          state.remaining = 0;
        }
      }
    } else {
      this.metrics.failedCount++;
      this.emit('request-failed', {
        requestId: request.id,
        category: request.category,
        error,
        exhaustedRetries: request.retries >= request.maxRetries,
      });

      this.logger.error('Request permanently failed', {
        requestId: request.id,
        category: request.category,
        retries: request.retries,
      });
    }
  }

  /**
   * Update rate limit state from response headers
   */
  updateRateLimitFromHeaders(
    category: EndpointCategory,
    remaining: number,
    resetTimestamp: number
  ): void {
    const state = this.rateLimitState.get(category);
    if (state) {
      state.remaining = remaining;
      state.resetTimestamp = resetTimestamp;

      this.logger.debug('Rate limit updated', {
        category,
        remaining,
        resetTimestamp,
      });
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const avgTime =
      this.metrics.processingTimes.length > 0
        ? this.metrics.processingTimes.reduce((a, b) => a + b, 0) /
          this.metrics.processingTimes.length
        : 0;

    return {
      accountQueueSize: this.accountQueue.length,
      marketQueueSize: this.marketQueue.length,
      totalProcessed: this.metrics.processedCount,
      totalFailed: this.metrics.failedCount,
      avgProcessingTime: avgTime,
    };
  }

  /**
   * Get current rate limit state
   */
  getRateLimitState(category: EndpointCategory): RateLimitState | undefined {
    return this.rateLimitState.get(category);
  }

  /**
   * Clear queue and reset metrics
   */
  reset(): void {
    this.accountQueue = [];
    this.marketQueue = [];
    this.metrics = {
      processedCount: 0,
      failedCount: 0,
      processingTimes: [],
    };
    this.requestHandlers.clear();
    this.initializeRateLimitState();

    this.logger.info('Queue reset');
  }

  /**
   * Drain queue - wait for all pending requests
   */
  async drain(timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();

    while (
      (this.accountQueue.length > 0 || this.marketQueue.length > 0) &&
      Date.now() - startTime < timeoutMs
    ) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.accountQueue.length > 0 || this.marketQueue.length > 0) {
      throw new Error('Queue drain timeout');
    }

    this.logger.info('Queue drained');
  }

  /**
   * Get rate limit info for debugging
   */
  getRateLimitInfo() {
    const info: Record<string, any> = {};

    for (const [category, state] of this.rateLimitState) {
      info[category] = {
        remaining: state.remaining,
        limit: state.limit,
        resetIn: Math.max(state.resetTimestamp - Date.now(), 0),
      };
    }

    return info;
  }
}
