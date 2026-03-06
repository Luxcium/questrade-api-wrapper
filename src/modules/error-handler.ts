/**
 * ErrorInterceptor
 * Centralized error parsing and transformation
 * - Parse API error responses into strongly-typed errors
 * - Handle HTTP status codes with appropriate error codes
 * - Extract order-specific errors and rejections
 * - Provide retry logic classification
 * - Emit error events for observability
 */

import { EventEmitter } from 'events';
import {
  APIErrorResponse,
  QuestradeError,
  ErrorCode,
  OrderRejectInfo,
  HTTPResponse,
} from '../types';
import { Logger } from './logger';

export class ErrorInterceptor extends EventEmitter {
  private logger: Logger;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
  }

  /**
   * Parse HTTP response and throw strongly-typed error if needed
   */
  parseResponse<T>(response: HTTPResponse<T>): HTTPResponse<T> | never {
    if (response.status >= 200 && response.status < 300) {
      return response;
    }

    throw this.createError(response);
  }

  /**
   * Create strongly-typed error from HTTP response
   */
  private createError(response: HTTPResponse): QuestradeError {
    const statusCode = response.status;
    let errorCode: ErrorCode;
    let message: string;
    let rejectedOrders: OrderRejectInfo[] | undefined;
    let orderId: string | undefined;

    // Parse error body if available
    let apiErrorResponse: Partial<APIErrorResponse> = {};
    if (response.body && typeof response.body === 'object') {
      apiErrorResponse = response.body;
    }

    // Map HTTP status to error code
    switch (statusCode) {
      case 400:
        errorCode = ErrorCode.INVALID_REQUEST;
        message = apiErrorResponse.message || 'Invalid request';
        break;

      case 401:
        errorCode = ErrorCode.UNAUTHORIZED;
        message = apiErrorResponse.message || 'Unauthorized';
        break;

      case 403:
        errorCode = ErrorCode.FORBIDDEN;
        message = apiErrorResponse.message || 'Forbidden';
        break;

      case 404:
        errorCode = ErrorCode.NOT_FOUND;
        message = apiErrorResponse.message || 'Not found';
        break;

      case 409:
        errorCode = ErrorCode.CONFLICT;
        message = apiErrorResponse.message || 'Conflict';
        break;

      case 422:
        errorCode = ErrorCode.UNPROCESSABLE_ENTITY;
        message = apiErrorResponse.message || 'Unprocessable entity';
        // Extract order rejection details
        if (apiErrorResponse.rejectedOrders) {
          rejectedOrders = apiErrorResponse.rejectedOrders;
          orderId = apiErrorResponse.orderId;
        }
        break;

      case 429:
        errorCode = ErrorCode.RATE_LIMITED;
        message = apiErrorResponse.message || 'Rate limited';
        break;

      case 500:
        errorCode = ErrorCode.INTERNAL_SERVER_ERROR;
        message = apiErrorResponse.message || 'Internal server error';
        break;

      case 503:
        errorCode = ErrorCode.SERVICE_UNAVAILABLE;
        message = apiErrorResponse.message || 'Service unavailable';
        break;

      case 504:
        errorCode = ErrorCode.GATEWAY_TIMEOUT;
        message = apiErrorResponse.message || 'Gateway timeout';
        break;

      default:
        errorCode = ErrorCode.UNKNOWN;
        message = apiErrorResponse.message || `HTTP ${statusCode}`;
    }

    const error = new Error(message) as QuestradeError;
    error.code = errorCode;
    error.statusCode = statusCode;
    error.message = message;
    error.isRetryable =
      statusCode >= 500 || statusCode === 429 || statusCode === 408;
    error.orderId = orderId;
    error.rejectedOrders = rejectedOrders;
    error.context = {
      statusCode,
      apiErrorCode: apiErrorResponse.code,
      timestamp: response.timestamp,
    };

    // Add rate limit reset info for 429 errors
    if (statusCode === 429 && response.headers['x-ratelimit-reset']) {
      error.context.resetTimestamp = parseInt(
        response.headers['x-ratelimit-reset'],
        10
      ) * 1000;
    }

    this.logger.error('API error response', {
      errorCode,
      statusCode,
      message,
      context: error.context,
    });

    this.emit('error', error);

    return error;
  }

  /**
   * Handle network-level errors
   */
  handleNetworkError(error: Error, context?: Record<string, any>): never {
    let errorCode: ErrorCode;
    let message: string;

    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
      errorCode = ErrorCode.TIMEOUT;
      message = 'Request timeout';
    } else if (
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ECONNRESET')
    ) {
      errorCode = ErrorCode.CONNECTION_REFUSED;
      message = 'Connection refused or reset';
    } else if (error.message.includes('ENOTFOUND') || error.message.includes('EHOSTUNREACH')) {
      errorCode = ErrorCode.NETWORK_ERROR;
      message = 'Network unreachable';
    } else {
      errorCode = ErrorCode.NETWORK_ERROR;
      message = error.message || 'Network error';
    }

    const questradeError = new Error(message) as QuestradeError;
    questradeError.code = errorCode;
    questradeError.statusCode = 0;
    questradeError.message = message;
    questradeError.originalError = error;
    questradeError.isRetryable = true;
    questradeError.context = { ...context, originalError: error.message };

    this.logger.error('Network error', {
      errorCode,
      message,
      originalError: error.message,
      context,
    });

    this.emit('network-error', questradeError);

    throw questradeError;
  }

  /**
   * Create a specific error type
   */
  createSpecificError(
    code: ErrorCode,
    message: string,
    statusCode: number,
    context?: Record<string, any>
  ): QuestradeError {
    const error = new Error(message) as QuestradeError;
    error.code = code;
    error.statusCode = statusCode;
    error.message = message;
    error.isRetryable =
      statusCode >= 500 || statusCode === 429 || code === ErrorCode.NETWORK_ERROR;
    error.context = context;

    return error;
  }

  /**
   * Check if error is retryable
   */
  isRetryable(error: any): boolean {
    if (error instanceof Error && 'isRetryable' in error) {
      return (error as QuestradeError).isRetryable;
    }

    if (error.statusCode >= 500) return true;
    if (error.statusCode === 429) return true;
    if (error.statusCode === 408) return true;
    if (error.code === ErrorCode.NETWORK_ERROR) return true;

    return false;
  }

  /**
   * Validate error is QuestradeError
   */
  isQuestradeError(error: any): error is QuestradeError {
    return (
      error instanceof Error &&
      'code' in error &&
      'statusCode' in error &&
      'isRetryable' in error
    );
  }

  /**
   * Get error details for logging/monitoring
   */
  getErrorDetails(error: QuestradeError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      isRetryable: error.isRetryable,
      orderId: error.orderId,
      rejectedOrdersCount: error.rejectedOrders?.length || 0,
      context: error.context,
    };
  }
}
