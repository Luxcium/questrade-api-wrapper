/**
 * StreamingEngine
 * WebSocket connection management for Level 1 market data and notifications
 * - Retrieve stream port from REST API
 * - Authenticate with access token
 * - Maintain heartbeat every 30 minutes
 * - Reconnect with exponential backoff on disconnect
 * - Support multiple concurrent streams
 * - Emit typed stream events
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  StreamConfig,
  StreamMessage,
  StreamEventType,
  StreamSubscription,
  ErrorCode,
} from '../types';
import { QuestradeError } from '../types';
import { Logger } from './logger';

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const RECONNECT_BASE_BACKOFF_MS = 5000;
const RECONNECT_MAX_BACKOFF_MS = 60000;
const RECONNECT_MAX_ATTEMPTS = 10;
const STREAM_MESSAGE_TIMEOUT_MS = 60000;

interface StreamSession {
  id: string;
  ws: WebSocket | null;
  isConnected: boolean;
  reconnectAttempts: number;
  lastHeartbeat: number;
  subscriptions: Map<string, StreamSubscription>;
  messageQueue: StreamMessage[];
}

export class StreamingEngine extends EventEmitter {
  private sessions: Map<string, StreamSession> = new Map();
  private heartbeatIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
  private reconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private messageSequence: number = 0;
  private logger: Logger;
  private accessTokenProvider: () => string;
  private streamConfigProvider: () => Promise<StreamConfig>;

  constructor(
    logger: Logger,
    accessTokenProvider: () => string,
    streamConfigProvider: () => Promise<StreamConfig>
  ) {
    super();
    this.logger = logger;
    this.accessTokenProvider = accessTokenProvider;
    this.streamConfigProvider = streamConfigProvider;
  }

  /**
   * Create and connect WebSocket stream
   */
  async createStream(
    sessionId: string,
    type: 'level1' | 'level2' | 'trades' | 'notifications'
  ): Promise<StreamSession> {
    // Check if session already exists
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!;
      if (existing.isConnected) {
        this.logger.debug('Stream already connected', { sessionId });
        return existing;
      }
      // Reuse session for reconnection
      return this.connectStream(sessionId, existing);
    }

    // Create new session
    const session: StreamSession = {
      id: sessionId,
      ws: null,
      isConnected: false,
      reconnectAttempts: 0,
      lastHeartbeat: Date.now(),
      subscriptions: new Map(),
      messageQueue: [],
    };

    this.sessions.set(sessionId, session);
    return this.connectStream(sessionId, session);
  }

  /**
   * Connect WebSocket with authentication
   */
  private async connectStream(
    sessionId: string,
    session: StreamSession
  ): Promise<StreamSession> {
    try {
      const streamConfig = await this.streamConfigProvider();
      const accessToken = this.accessTokenProvider();

      // Construct WebSocket URL
      const protocol = streamConfig.streamUri
        ? (streamConfig.streamUri.startsWith('ws://') ? 'ws' : 'wss')
        : 'wss';
      const host = streamConfig.streamUri || `127.0.0.1:${streamConfig.streamPort}`;
      const wsUrl = `${protocol}://${host}`;

      // Remove listeners from old WebSocket if reconnecting
      if (session.ws) {
        session.ws.removeAllListeners();
        session.ws.terminate();
        session.ws = null;
      }

      this.logger.debug('Connecting stream', { sessionId, wsUrl });

      // Create WebSocket with 10s connection timeout
      const ws = new WebSocket(wsUrl, {
        handshakeTimeout: 10000,
        perMessageDeflate: false,
      });

      // Set message handler before open
      ws.on('message', (data: Buffer) => this.handleStreamMessage(sessionId, data));
      ws.on('error', (error: Error) =>
        this.handleStreamError(sessionId, error)
      );
      ws.on('close', () => this.handleStreamClose(sessionId));

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000);

        ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        ws.on('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Send authentication token
      ws.send(accessToken);

      session.ws = ws;
      session.isConnected = true;
      session.reconnectAttempts = 0;

      this.logger.info('Stream connected', { sessionId });
      this.emit('stream-connected', { sessionId, type: 'level1' });

      // Start heartbeat
      this.startHeartbeat(sessionId);

      return session;
    } catch (error) {
      this.logger.error('Failed to connect stream', {
        sessionId,
        error: error instanceof Error ? error.message : error,
      });

      // Schedule reconnection
      this.scheduleReconnect(sessionId, session);

      throw this.createError(
        ErrorCode.STREAM_DISCONNECTED,
        `Failed to connect stream: ${error instanceof Error ? error.message : 'Unknown error'}`,
        0
      );
    }
  }

  /**
   * Handle incoming stream message
   */
  private handleStreamMessage(sessionId: string, data: Buffer): void {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) return;

      // Parse message (format depends on stream type)
      let message: StreamMessage;

      try {
        message = JSON.parse(data.toString('utf8'));
      } catch {
        // Some streams may send binary data or proprietary format
        this.logger.warn('Failed to parse stream message as JSON', { sessionId });
        return;
      }

      // Add sequence and timestamp
      message.sequenceNumber = ++this.messageSequence;
      message.timestamp = Date.now();

      // Update last heartbeat on valid message
      session.lastHeartbeat = Date.now();

      // Emit typed event
      this.emit('stream-message', {
        sessionId,
        message,
      });

      this.logger.debug('Stream message received', {
        sessionId,
        type: message.type,
        sequence: message.sequenceNumber,
      });
    } catch (error) {
      this.logger.error('Error handling stream message', {
        sessionId,
        error,
      });
    }
  }

  /**
   * Handle stream error
   */
  private handleStreamError(sessionId: string, error: Error): void {
    this.logger.error('Stream error', {
      sessionId,
      error: error.message,
    });

    this.emit('stream-error', {
      sessionId,
      error,
    });
  }

  /**
   * Handle stream close
   */
  private handleStreamClose(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.isConnected = false;
    this.stopHeartbeat(sessionId);

    this.logger.info('Stream closed', { sessionId });
    this.emit('stream-disconnected', { sessionId });

    // Attempt to reconnect
    this.scheduleReconnect(sessionId, session);
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(sessionId: string, session: StreamSession): void {
    if (session.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.logger.error('Max reconnection attempts reached', {
        sessionId,
        attempts: session.reconnectAttempts,
      });

      this.emit('stream-reconnect-failed', {
        sessionId,
        attempts: session.reconnectAttempts,
      });

      return;
    }

    // Clear any existing timeout
    if (this.reconnectTimeouts.has(sessionId)) {
      clearTimeout(this.reconnectTimeouts.get(sessionId)!);
    }

    session.reconnectAttempts++;

    // Exponential backoff with jitter
    const backoffMs = Math.min(
      RECONNECT_BASE_BACKOFF_MS * Math.pow(2, session.reconnectAttempts - 1),
      RECONNECT_MAX_BACKOFF_MS
    );
    const jitterMs = Math.random() * backoffMs * 0.1;

    this.logger.info('Scheduling stream reconnection', {
      sessionId,
      attempt: session.reconnectAttempts,
      backoffMs: backoffMs + jitterMs,
    });

    const timeout = setTimeout(() => {
      this.reconnectTimeouts.delete(sessionId);
      this.connectStream(sessionId, session).catch(error => {
        this.logger.debug('Reconnection failed, will retry', {
          sessionId,
          error: error instanceof Error ? error.message : error,
        });
      });
    }, backoffMs + jitterMs);

    this.reconnectTimeouts.set(sessionId, timeout);
  }

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(sessionId: string): void {
    this.stopHeartbeat(sessionId);

    const interval = setInterval(() => {
      const session = this.sessions.get(sessionId);
      if (!session || !session.isConnected) {
        this.stopHeartbeat(sessionId);
        return;
      }

      try {
        // Send heartbeat/ping
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.ping();
          session.lastHeartbeat = Date.now();

          this.logger.debug('Heartbeat sent', { sessionId });
        }
      } catch (error) {
        this.logger.error('Failed to send heartbeat', {
          sessionId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatIntervals.set(sessionId, interval);
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(sessionId: string): void {
    const interval = this.heartbeatIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.heartbeatIntervals.delete(sessionId);
    }
  }

  /**
   * Subscribe to stream events
   */
  subscribe(
    sessionId: string,
    subscriptionId: string,
    type: 'level1' | 'level2' | 'trades' | 'notifications',
    symbols?: string[],
    accountId?: number
  ): StreamSubscription {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw this.createError(
        ErrorCode.STREAM_DISCONNECTED,
        'Stream session not found',
        0
      );
    }

    const subscription: StreamSubscription = {
      id: subscriptionId,
      type,
      symbols,
      accountId,
      active: true,
    };

    session.subscriptions.set(subscriptionId, subscription);

    this.logger.info('Subscription created', {
      sessionId,
      subscriptionId,
      type,
      symbols: symbols?.join(','),
    });

    return subscription;
  }

  /**
   * Unsubscribe from stream events
   */
  unsubscribe(sessionId: string, subscriptionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.subscriptions.delete(subscriptionId);

    this.logger.info('Subscription removed', {
      sessionId,
      subscriptionId,
    });
  }

  /**
   * Close stream
   */
  async closeStream(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.stopHeartbeat(sessionId);

    if (this.reconnectTimeouts.has(sessionId)) {
      clearTimeout(this.reconnectTimeouts.get(sessionId)!);
      this.reconnectTimeouts.delete(sessionId);
    }

    if (session.ws) {
      session.ws.close();
      session.ws = null;
    }

    session.subscriptions.clear();
    this.sessions.delete(sessionId);

    this.logger.info('Stream closed', { sessionId });
  }

  /**
   * Get stream status
   */
  getStreamStatus(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      sessionId,
      isConnected: session.isConnected,
      reconnectAttempts: session.reconnectAttempts,
      lastHeartbeat: session.lastHeartbeat,
      subscriptionCount: session.subscriptions.size,
      messageQueueSize: session.messageQueue.length,
    };
  }

  /**
   * Close all streams
   */
  async closeAll(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map(id => this.closeStream(id)));
    this.logger.info('All streams closed');
  }

  /**
   * Create typed error
   */
  private createError(
    code: ErrorCode,
    message: string,
    statusCode: number
  ): QuestradeError {
    return new QuestradeError(message, code, statusCode, true);
  }
}
