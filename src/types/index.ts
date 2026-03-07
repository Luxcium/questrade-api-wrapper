/**
 * Core Type Definitions for Questrade API
 * Provides complete type safety for all API operations
 */

// ========== AUTHENTICATION TYPES ==========

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number; // in seconds (300 or 1800)
  refresh_token: string;
  api_server: string;
}

export interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  apiServer: string;
  expiresAt: number; // Unix timestamp in milliseconds
  refreshTokenExpiresAt: number; // Unix timestamp in milliseconds (72 hours)
  scope?: string[];
  userId?: string;
  username?: string;
}

export interface AuthConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
}

// ========== RATE LIMITING TYPES ==========

export enum EndpointCategory {
  ACCOUNT = 'account', // 30 RPS
  MARKET_DATA = 'market', // 20 RPS
}

export interface RateLimitState {
  category: EndpointCategory;
  remaining: number;
  resetTimestamp: number; // Unix timestamp in ms
  limit: number;
}

export interface QueuedRequest<T = any> {
  id: string;
  category: EndpointCategory;
  priority: number; // 0 (lowest) to 10 (highest)
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: T;
  headers?: Record<string, string>;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

export interface QueueStats {
  accountQueueSize: number;
  marketQueueSize: number;
  totalProcessed: number;
  totalFailed: number;
  avgProcessingTime: number;
}

// ========== ERROR TYPES ==========

export enum ErrorCode {
  // Client Errors
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  RATE_LIMITED = 'RATE_LIMITED',
  
  // Server Errors
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
  
  // Network Errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT = 'TIMEOUT',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  
  // Custom Errors
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_TOKEN = 'INVALID_TOKEN',
  STREAM_DISCONNECTED = 'STREAM_DISCONNECTED',
  UNKNOWN = 'UNKNOWN',
}

export interface APIErrorResponse {
  code?: string;
  message: string;
  statusCode: number;
  orderId?: string;
  rejectedOrders?: OrderRejectInfo[];
}

export interface OrderRejectInfo {
  orderId: string;
  reason: string;
  timestamp: number;
}

export class QuestradeError extends Error {
  code: ErrorCode;
  statusCode: number;
  originalError?: Error;
  context?: Record<string, any>;
  isRetryable: boolean;
  orderId?: string;
  rejectedOrders?: OrderRejectInfo[];

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    isRetryable: boolean
  ) {
    super(message);
    this.name = 'QuestradeError';
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, QuestradeError.prototype);
  }
}

// ========== ACCOUNT TYPES ==========

export interface Account {
  number: string;
  type: 'Cash' | 'Margin' | 'RRSP' | 'RESP' | 'TFSA' | 'FHSA' | 'Other';
  status: 'Active' | 'Suspended' | 'Closed';
  isFunded: boolean;
  isChart: boolean;
  canPlaceTrades: boolean;
  accountId: number;
}

export interface AccountBalance {
  cash: number;
  marketValue: number;
  totalEquity: number;
  buyingPower: number;
  maintenanceExcess: number;
  isDayTrader: boolean;
  maxBuyingPower: number;
  currency: 'CAD' | 'USD';
  accountType: string;
}

export interface Position {
  symbol: string;
  symbolId: number;
  openQuantity: number;
  closedQuantity: number;
  currentMarketValue: number;
  currentPrice: number;
  averageEntryPrice: number;
  closedPnl: number;
  openPnl: number;
  totalPnl: number;
  isRealTime: boolean;
  isUnderReorg: boolean;
}

// ========== ORDER TYPES ==========

export enum OrderType {
  MARKET = 'Market',
  LIMIT = 'Limit',
  STOP_LOSS = 'StopLoss',
  STOP_LIMIT = 'StopLimit',
  TRAILING_STOP = 'TrailingStop',
}

export enum OrderSide {
  BUY = 'Buy',
  SELL = 'Sell',
  SHORT = 'Short',
}

export enum OrderStatus {
  OPEN = 'Open',
  CLOSED = 'Closed',
  PARTIAL = 'Partial',
  PENDING = 'Pending',
  REJECTED = 'Rejected',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
}

export interface Order {
  id: string;
  symbol: string;
  symbolId: number;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  price?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledQuantity: number;
  remainingQuantity: number;
  timeInForce: 'Day' | 'GTC' | 'GTD' | 'IOC' | 'FOK';
  expiryDate?: string;
  creationTime: number;
  updateTime?: number;
  commission: number;
  notes?: string;
}

export interface OrderRequest {
  symbol: string;
  symbolId?: number;
  quantity: number;
  side: OrderSide;
  type: OrderType;
  price?: number;
  stopPrice?: number;
  timeInForce?: 'Day' | 'GTC' | 'GTD' | 'IOC' | 'FOK';
  expiryDate?: string;
  notes?: string;
}

export interface Execution {
  id: string;
  symbol: string;
  quantity: number;
  price: number;
  commission: number;
  executionTime: number;
  notes?: string;
}

// ========== MARKET DATA TYPES ==========

export interface Quote {
  symbol: string;
  symbolId: number;
  bid: number;
  ask: number;
  last: number;
  lastTradeTime: number;
  volume: number;
  openInterest?: number;
  contractMultiplier?: number;
  expiryDate?: string;
  dividendYield?: number;
  optionDelta?: number;
  isRealTime: boolean;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OptionQuote extends Quote {
  optionType: 'Call' | 'Put';
  strikePrice: number;
  expiryDate: string;
  impliedVolatility: number;
  openInterest: number;
  optionDelta: number;
  optionGamma: number;
  optionTheta: number;
  optionVega: number;
}

export interface Market {
  id: string;
  name: string;
  status: 'Open' | 'Closed' | 'PreOpen' | 'PostClose';
  openTime: string;
  closeTime: string;
  timezone: string;
}

// ========== STREAMING TYPES ==========

export interface StreamConfig {
  streamPort: number;
  streamUri?: string;
  sessionId?: string;
}

export enum StreamEventType {
  QUOTE_UPDATED = 'QuoteUpdated',
  TRADE_EXECUTED = 'TradeExecuted',
  ORDER_STATUS_CHANGED = 'OrderStatusChanged',
  BALANCE_UPDATED = 'BalanceUpdated',
  POSITION_UPDATED = 'PositionUpdated',
  CONNECTED = 'Connected',
  DISCONNECTED = 'Disconnected',
  ERROR = 'Error',
  HEARTBEAT = 'Heartbeat',
}

export interface StreamMessage {
  type: StreamEventType;
  timestamp: number;
  data: any;
  sequenceNumber?: number;
}

export interface StreamSubscription {
  id: string;
  type: 'level1' | 'level2' | 'trades' | 'notifications';
  symbols?: string[];
  accountId?: number;
  active: boolean;
}

// ========== ACTIVITY TYPES ==========

export interface Activity {
  id: string;
  type: 'Trade' | 'Dividend' | 'Interest' | 'Fee' | 'Deposit' | 'Withdrawal';
  symbol?: string;
  quantity?: number;
  price?: number;
  commission?: number;
  amount: number;
  currency: 'CAD' | 'USD';
  date: number;
  description: string;
}

// ========== SYMBOL & SEARCH TYPES ==========

export interface Symbol {
  symbol: string;
  symbolId: number;
  name: string;
  isin?: string;
  currency: 'CAD' | 'USD';
  optionsEnabled: boolean;
  minTradeQuantity: number;
}

export interface SymbolSearchResult {
  symbols: Symbol[];
  total: number;
  limit: number;
  offset: number;
}

// ========== INTERNAL TYPES ==========

export interface HTTPResponse<T = any> {
  status: number;
  headers: Record<string, string>;
  body: T;
  timestamp: number;
}

export interface RateLimitHeaders {
  remaining: number;
  limit: number;
  reset: number; // Unix timestamp in seconds
}

export interface RequestContext {
  requestId: string;
  timestamp: number;
  category: EndpointCategory;
  retryCount: number;
  duration?: number;
}
