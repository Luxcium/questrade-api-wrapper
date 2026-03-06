# Questrade API TypeScript Wrapper

A production-grade TypeScript wrapper for the Questrade API with OAuth 2.0 authentication, dual-tier rate limiting, centralized error handling, and WebSocket streaming support.

## Architecture Overview

The wrapper is organized into four coordinated modules:

### 1. Authentication Manager (`src/modules/authentication.ts`)
- OAuth 2.0 token lifecycle management
- Automatic token refresh (30 minutes expiry with 30-second buffer)
- Concurrent request handling during refresh
- Secure token storage (encrypted with optional AES-256-CBC)
- Token persistence to disk with automatic serialization

**Key Features:**
- Prevents token refresh thundering with internal promise caching
- Middleware-style request interceptor that injects Bearer token
- Emits events for token refresh success/failure
- Validates token expiry before each request

### 2. Rate Limiting Queue (`src/modules/queue.ts`)
- Dual-tier request queuing by endpoint category
- Account operations: 30 RPS max
- Market data: 20 RPS max
- Priority scheduling (0-10 scale)
- Automatic backoff on HTTP 429 with reset timestamp parsing
- Exponential backoff for retries (1s, 2s, 4s)
- Per-category independent rate limiting windows

**Key Features:**
- Processes queue every 100ms with configurable batch interval
- Maintains separate queues for account vs market data
- Extracts `X-RateLimit-*` headers from responses
- Emits metrics: request-completed, request-failed, rate-limit-exceeded
- Supports drain operation for graceful shutdown

### 3. Error Interceptor (`src/modules/error-handler.ts`)
- Strongly-typed error hierarchy with discriminated unions
- HTTP status code mapping to semantic error codes
- Order rejection details extraction
- Retry classification (retryable vs non-retryable)
- Network error detection and classification
- Error context preservation for observability

**Error Categories:**
- Client: INVALID_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT
- Server: INTERNAL_SERVER_ERROR, SERVICE_UNAVAILABLE, GATEWAY_TIMEOUT
- Network: NETWORK_ERROR, TIMEOUT, CONNECTION_REFUSED
- Custom: TOKEN_EXPIRED, INVALID_TOKEN, STREAM_DISCONNECTED

### 4. Streaming Engine (`src/modules/streaming.ts`)
- WebSocket connection management with 10-second handshake timeout
- Token authentication (plain text send on connect)
- 30-minute heartbeat cycle to prevent disconnection
- Exponential backoff reconnection (5s base, 60s max, 10 max attempts)
- Multiple concurrent streams with session tracking
- Message type routing and event broadcasting
- Support for Level 1, Level 2, trades, and notifications streams

**Key Features:**
- Automatic reconnection with jitter-based backoff
- Per-session subscription management
- Message sequence numbering for ordering verification
- Heartbeat failure detection and stream close
- Clean resource teardown on shutdown

## Configuration

### Environment Variables (`.env`)

```bash
# OAuth Configuration
QUESTRADE_CLIENT_ID=your_client_id
QUESTRADE_CLIENT_SECRET=your_client_secret
QUESTRADE_REDIRECT_URI=http://localhost:3000/callback

# Token Storage
TOKEN_STORAGE_PATH=.keys/tokens.json
TOKEN_ENCRYPTION_ENABLED=false

# Rate Limiting
RATE_LIMIT_ACCOUNT_RPS=30
RATE_LIMIT_MARKET_RPS=20

# Streaming
STREAM_HEARTBEAT_INTERVAL_MS=1800000
STREAM_RECONNECT_MAX_ATTEMPTS=10

# Logging
LOG_LEVEL=info
LOG_FILE=.keys/logs/questrade-api.log
LOG_PRETTY=true

# Development/Testing
NODE_ENV=development
DEV_SIMULATE_TOKEN_EXPIRY=true
DEV_SIMULATE_RATE_LIMIT_HIT=false
DEV_SIMULATE_NETWORK_FAILURE=false
```

### Key Directories

```
.keys/              # Sensitive data (added to .gitignore)
  tokens.json       # Encrypted/serialized token payload
  logs/
    questrade-api.log

config/             # Configuration files
.env                # Environment variables
.env.example        # Template
```

## Usage

### Basic Setup

```typescript
import { QuestradeClient } from './src/client';

const client = new QuestradeClient(
  {
    clientId: process.env.QUESTRADE_CLIENT_ID!,
    clientSecret: process.env.QUESTRADE_CLIENT_SECRET,
    redirectUri: process.env.QUESTRADE_REDIRECT_URI!,
  },
  {
    logLevel: 'info',
    logFile: '.keys/logs/questrade-api.log',
    tokenStoragePath: '.keys/tokens.json',
  }
);
```

### OAuth Flow

```typescript
// Get authorization URL
const authUrl = client.getAuthorizationUrl(['PlaceTrades', 'AccountAccess']);

// After user authorizes, exchange code for token
await client.initialize(authorizationCode);

// Token is now persisted and will auto-refresh
```

### Account Operations

```typescript
// Get all accounts
const accounts = await client.getAccounts();

// Get balance
const balance = await client.getAccountBalance(accountId);

// Get positions
const positions = await client.getPositions(accountId);

// Place order (high priority)
const result = await client.placeOrder(accountId, {
  symbol: 'AAPL',
  quantity: 100,
  side: 'Buy',
  type: 'Limit',
  price: 150.00,
});

// Cancel order
await client.cancelOrder(accountId, orderId);
```

### Market Data

```typescript
// Search symbols
const results = await client.searchSymbols('AAPL', 10);

// Get quote
const quote = await client.getQuote(8049);

// Quote contains: symbol, bid, ask, last, volume, isRealTime
```

### WebSocket Streaming

```typescript
// Connect stream
const sessionId = 'session-123';
await client.connectStream(sessionId, 'level1');

// Subscribe to quotes
client.subscribeToQuotes(sessionId, ['AAPL', 'GOOGL']);

// Listen for messages
client.on('stream-message', ({ sessionId: id, message }) => {
  if (id === sessionId) {
    console.log('Quote update:', message);
  }
});

client.on('stream-disconnected', ({ sessionId: id }) => {
  if (id === sessionId) {
    console.log('Stream disconnected, will auto-reconnect');
  }
});

// Close stream
await client.closeStream(sessionId);
```

## Event System

The client emits events for observability:

```typescript
// Request lifecycle
client.on('request-completed', ({ requestId, duration, category }) => {
  console.log(`${category} request took ${duration}ms`);
});

client.on('request-failed', ({ requestId, category, error }) => {
  console.log(`Request failed: ${error.code}`);
});

// Rate limiting
client.on('rate-limit-exceeded', ({ category, waitMs }) => {
  console.log(`Rate limited, waiting ${waitMs}ms`);
});

// Token lifecycle
client.on('token-refreshed', ({ expiresIn }) => {
  console.log(`Token refreshed, expires in ${expiresIn}s`);
});

client.on('token-refresh-failed', (error) => {
  console.log(`Token refresh failed: ${error.message}`);
});

// Streaming
client.on('stream-connected', ({ sessionId }) => {});
client.on('stream-message', ({ sessionId, message }) => {});
client.on('stream-error', ({ sessionId, error }) => {});
client.on('stream-disconnected', ({ sessionId }) => {});
```

## Metrics & Health

```typescript
// Get token status
const tokenInfo = client.getTokenInfo();
// { apiServer, expiresIn, refreshTokenExpiresIn, isExpired }

// Get queue statistics
const stats = client.getQueueStats();
// { accountQueueSize, marketQueueSize, totalProcessed, totalFailed, avgProcessingTime }

// Get rate limit state
const rateLimits = client.getRateLimitInfo();
// { account: { remaining, limit, resetIn }, market: { ... } }
```

## Development

### Mock API Server

For testing without a real Questrade account:

```bash
npm run dev
```

Starts mock API on `http://localhost:4000` with:
- OAuth endpoints
- Mock account/market data
- Rate limit header simulation
- Development token generation

### Testing

```bash
npm run test              # Run tests once
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

### Type Checking

```bash
npm run type-check
```

## Production Deployment

### Configuration Checklist

1. **Environment Variables**
   - Set `NODE_ENV=production`
   - Disable token simulation: `ENABLE_TOKEN_SIMULATION=false`
   - Use real OAuth credentials
   - Enable token encryption: `TOKEN_ENCRYPTION_ENABLED=true`

2. **Logging**
   - Use JSON output: `LOG_PRETTY=false`
   - Ensure log file rotation is configured
   - Set appropriate `LOG_LEVEL`

3. **Rate Limiting**
   - Verify limits match Questrade API (30 RPS account, 20 RPS market)
   - Monitor metrics for sustained near-limit traffic

4. **Token Storage**
   - Use encrypted storage on production
   - Restrict `.keys/` directory permissions (600)
   - Regular key rotation strategy

5. **Error Handling**
   - Implement error monitoring (Sentry, DataDog, etc.)
   - Emit metrics for failures and retries
   - Alert on repeated 401/429 errors

6. **Graceful Shutdown**
   - Call `client.shutdown()` on SIGTERM
   - Wait for queue drain before exit
   - Close all streams cleanly

### Example Production Setup

```typescript
const client = new QuestradeClient(config, {
  logLevel: 'warn',
  logFile: '/var/log/questrade-api.log',
  tokenStoragePath: '/etc/questrade/.keys/tokens.json',
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY,
});

// Initialize with stored token (from previous session)
await client.initialize();

// Listen for errors
client.on('request-failed', async ({ error }) => {
  if (error.code === 'UNAUTHORIZED') {
    // Re-authorize or alert
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down');
  await client.shutdown();
  process.exit(0);
});
```

## Type Safety

All API responses are fully typed:

```typescript
// Strongly-typed Order
const order = await client.placeOrder(accountId, {
  symbol: 'AAPL',
  quantity: 100,
  side: 'Buy', // Literal type: 'Buy' | 'Sell'
  type: 'Limit', // Literal type: 'Market' | 'Limit' | 'StopLoss' | ...
  price: 150.00,
});

// Full type inference
if (order.orderId) { // TypeScript knows this is string
  // ...
}

// Discriminated union errors
try {
  await client.placeOrder(accountId, order);
} catch (error) {
  if (error.code === 'RATE_LIMITED') {
    // error.context contains resetTimestamp
  } else if (error.code === 'UNPROCESSABLE_ENTITY') {
    // error.rejectedOrders is available
    error.rejectedOrders?.forEach(order => {
      console.log(`Order ${order.orderId} rejected: ${order.reason}`);
    });
  }
}
```

## Development/Production Parity

The wrapper achieves dev/prod parity through:

1. **Token Simulation** - Dev mode can simulate token expiry and refresh
2. **Mock API Server** - Mirrors production API responses
3. **Error Simulation** - Dev can simulate rate limits, network failures, disconnects
4. **Identical Code Paths** - Same modules run in dev and prod
5. **Configurable Behavior** - All simulations toggle via environment variables

Set `NODE_ENV=development` and `ENABLE_TOKEN_SIMULATION=true` for testing without production credentials.

## Performance Characteristics

- **Throughput**: 30 RPS (account) + 20 RPS (market) = 50 RPS combined
- **Latency**: P50 ~50ms, P99 ~200ms (depends on network)
- **Memory**: ~20MB baseline, grows with queue backlog
- **Token Refresh**: Automatic, transparent to caller
- **Queue Processing**: 100ms batch interval, configurable priority

## Security

- **Token Storage**: AES-256-CBC encryption (optional)
- **OAuth**: Authorization Code flow, no password exposure
- **Rate Limiting**: Prevents API abuse and account lockout
- **Error Details**: Stripped in production logs to prevent information leakage
- **File Permissions**: `.keys/` directory should be 700 (user only)

## Troubleshooting

### Token Keeps Expiring

- Check system time synchronization
- Verify refresh token isn't revoked (72-hour limit)
- Check logs for `token-refresh-failed` events

### Rate Limits Exceeded

- Monitor `rate-limit-exceeded` events
- Reduce request volume or implement request batching
- Check for multiple client instances

### WebSocket Disconnect

- Normal during market hours (liquidity checks)
- Auto-reconnection is built-in
- Check firewall/proxy for WebSocket support

## License

MIT
