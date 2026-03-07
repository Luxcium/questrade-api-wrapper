/**
 * Questrade API TypeScript Wrapper
 * Main export point for the library
 */

export { QuestradeClient } from './client';

// Type exports
export type {
  // Auth
  OAuthTokenResponse,
  TokenPayload,
  AuthConfig,
  
  // Rate limiting
  QueuedRequest,
  QueueStats,
  RateLimitState,
  
  // Errors
  APIErrorResponse,
  OrderRejectInfo,
  
  // Accounts
  Account,
  AccountBalance,
  Position,
  
  // Orders
  Order,
  OrderRequest,
  Execution,
  
  // Markets
  Quote,
  Candle,
  OptionQuote,
  Market,
  
  // Streaming
  StreamConfig,
  StreamMessage,
  StreamSubscription,
  
  // Activity
  Activity,
  
  // Search
  Symbol,
  SymbolSearchResult,
  
  // Internal
  HTTPResponse,
  RateLimitHeaders,
  RequestContext,
} from './types';

// QuestradeError is a class (value + type) so export as a value
export { QuestradeError } from './types';

// Enum exports
export {
  ErrorCode,
  OrderType,
  OrderSide,
  OrderStatus,
  EndpointCategory,
  StreamEventType,
} from './types';

// Module exports (for advanced usage)
export { AuthenticationManager } from './modules/authentication';
export { RateLimitingQueue } from './modules/queue';
export { ErrorInterceptor } from './modules/error-handler';
export { StreamingEngine } from './modules/streaming';
export { Logger, LogLevel } from './modules/logger';
