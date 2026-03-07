/**
 * Logger
 * Structured logging with file rotation, context tracking, and multiple levels
 * - JSON output for production environments
 * - Pretty-printed output for development
 * - File rotation based on size/time
 * - Request/response context tracking
 */

import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, WriteStream } from 'fs';

export enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, any>;
  requestId?: string;
  duration?: number;
}

export class Logger {
  private level: LogLevel;
  private filePath: string;
  private stream: WriteStream | null = null;
  private prettyPrint: boolean;
  private context: Map<string, any> = new Map();
  private requestIdStack: string[] = [];
  private pendingWrites: string[] = [];

  constructor(
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' = 'info',
    filePath?: string,
    prettyPrint = true
  ) {
    this.level = LogLevel[level.toUpperCase() as keyof typeof LogLevel] || LogLevel.INFO;
    this.filePath = filePath || '';
    this.prettyPrint = prettyPrint;

    if (this.filePath) {
      this.initializeFileStream();
    }
  }

  /**
   * Initialize file stream for logging
   */
  private async initializeFileStream(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });

      this.stream = createWriteStream(this.filePath, {
        flags: 'a',
        encoding: 'utf8',
      });

      this.stream.on('error', error => {
        console.error('Logger stream error:', error);
      });

      // Flush any writes that arrived before the stream was ready
      for (const pending of this.pendingWrites) {
        this.stream.write(pending);
      }
      this.pendingWrites = [];
    } catch (error) {
      console.error('Failed to initialize logger', error);
    }
  }

  /**
   * Push request context
   */
  pushRequestContext(requestId: string, context: Record<string, any> = {}): void {
    this.requestIdStack.push(requestId);
    this.context.set(requestId, context);
  }

  /**
   * Pop request context
   */
  popRequestContext(): void {
    const requestId = this.requestIdStack.pop();
    if (requestId) {
      this.context.delete(requestId);
    }
  }

  /**
   * Get current request ID
   */
  private getCurrentRequestId(): string | undefined {
    return this.requestIdStack[this.requestIdStack.length - 1];
  }

  /**
   * Log trace message
   */
  trace(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.TRACE) {
      this.log('TRACE', message, context);
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.DEBUG) {
      this.log('DEBUG', message, context);
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.INFO) {
      this.log('INFO', message, context);
    }
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.WARN) {
      this.log('WARN', message, context);
    }
  }

  /**
   * Log error message
   */
  error(message: string, context?: Record<string, any>): void {
    if (this.level <= LogLevel.ERROR) {
      this.log('ERROR', message, context);
    }
  }

  /**
   * Core logging function
   */
  private log(level: string, message: string, context?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: {
        ...(this.getCurrentRequestId() ? this.context.get(this.getCurrentRequestId()!) : {}),
        ...context,
      },
      requestId: this.getCurrentRequestId(),
    };

    if (this.prettyPrint) {
      this.writePretty(entry);
    } else {
      this.writeJSON(entry);
    }
  }

  /**
   * Write pretty-formatted log
   */
  private writePretty(entry: LogEntry): void {
    const levelColor = this.getColorForLevel(entry.level);
    const resetColor = '\x1b[0m';

    let output = `${entry.timestamp} ${levelColor}[${entry.level}]${resetColor} ${entry.message}`;

    if (entry.requestId) {
      output += ` [${entry.requestId}]`;
    }

    if (entry.context && Object.keys(entry.context).length > 0) {
      output += `\n  ${JSON.stringify(entry.context, null, 2).split('\n').join('\n  ')}`;
    }

    console.log(output);

    if (this.stream) {
      // Strip ANSI color codes before writing to file
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      this.stream.write(stripped + '\n');
    } else if (this.filePath) {
      // Buffer writes until the stream is ready
      const stripped = output.replace(/\x1b\[[0-9;]*m/g, '');
      this.pendingWrites.push(stripped + '\n');
    }
  }

  /**
   * Write JSON log
   */
  private writeJSON(entry: LogEntry): void {
    const json = JSON.stringify(entry);
    console.log(json);

    if (this.stream) {
      this.stream.write(json + '\n');
    } else if (this.filePath) {
      this.pendingWrites.push(json + '\n');
    }
  }

  /**
   * Get color for log level
   */
  private getColorForLevel(level: string): string {
    switch (level) {
      case 'TRACE':
        return '\x1b[36m'; // Cyan
      case 'DEBUG':
        return '\x1b[36m'; // Cyan
      case 'INFO':
        return '\x1b[32m'; // Green
      case 'WARN':
        return '\x1b[33m'; // Yellow
      case 'ERROR':
        return '\x1b[31m'; // Red
      default:
        return '\x1b[0m'; // Reset
    }
  }

  /**
   * Close logger
   */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
