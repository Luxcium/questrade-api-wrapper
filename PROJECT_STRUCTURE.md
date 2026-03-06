# Project Structure

```
questrade-api-wrapper/
├── src/
│   ├── client.ts                           # Main QuestradeClient orchestrator
│   ├── index.ts                            # Public API exports
│   ├── types/
│   │   └── index.ts                        # Complete type definitions (900+ lines)
│   │       ├── Authentication types
│   │       ├── Rate limiting types
│   │       ├── Error types with discriminated unions
│   │       ├── Account types (Account, Balance, Position, Order)
│   │       ├── Market data types (Quote, Candle, Option)
│   │       ├── Streaming types
│   │       └── Activity and Symbol types
│   │
│   ├── modules/
│   │   ├── authentication.ts                # OAuth 2.0 token manager
│   │   │   ├── Token exchange and refresh
│   │   │   ├── Concurrent request handling during refresh
│   │   │   ├── Secure encrypted storage
│   │   │   └── Token validation and expiry checking
│   │   │
│   │   ├── queue.ts                        # Rate limiting queue engine
│   │   │   ├── Dual-tier rate limiting (30 RPS / 20 RPS)
│   │   │   ├── Priority scheduling (0-10)
│   │   │   ├── Exponential backoff retry logic
│   │   │   ├── Per-category rate limit windows
│   │   │   └── Queue metrics and statistics
│   │   │
│   │   ├── error-handler.ts                # Centralized error interceptor
│   │   │   ├── HTTP status to error code mapping
│   │   │   ├── Order rejection details extraction
│   │   │   ├── Network error classification
│   │   │   ├── Retry eligibility classification
│   │   │   └── Error context preservation
│   │   │
│   │   ├── streaming.ts                    # WebSocket stream manager
│   │   │   ├── Stream connection with auth
│   │   │   ├── 30-minute heartbeat cycle
│   │   │   ├── Exponential backoff reconnection
│   │   │   ├── Multiple concurrent sessions
│   │   │   └── Message routing and events
│   │   │
│   │   └── logger.ts                       # Structured logging
│   │       ├── JSON and pretty-print modes
│   │       ├── File rotation support
│   │       ├── Context tracking
│   │       └── Request ID propagation
│   │
│   ├── examples/
│   │   └── oauth-flow.ts                   # Complete OAuth flow example
│   │       ├── Authorization URL generation
│   │       ├── Callback handler
│   │       ├── Token persistence
│   │       ├── Account operations
│   │       ├── Market data queries
│   │       ├── Order placement
│   │       ├── WebSocket streaming
│   │       └── Health check endpoint
│   │
│   ├── dev/
│   │   └── mock-api.ts                     # Development mock API server
│   │       ├── OAuth endpoints
│   │       ├── Account/Market API responses
│   │       ├── Rate limit simulation
│   │       ├── Network failure simulation
│   │       └── Token generation/refresh
│   │
│   └── __tests__/
│       └── client.test.ts                  # Integration test suite
│           ├── Authentication tests
│           ├── Account operations tests
│           ├── Market data tests
│           ├── Rate limiting tests
│           ├── Error handling tests
│           ├── Event emission tests
│           └── Metrics tests
│
├── config/
│   └── [configuration files if needed]
│
├── .keys/                                   # Sensitive data (in .gitignore)
│   ├── tokens.json                         # Encrypted token payload
│   └── logs/
│       └── questrade-api.log
│
├── dist/                                    # Compiled JavaScript (in .gitignore)
│   ├── client.js
│   ├── client.d.ts
│   ├── types/
│   ├── modules/
│   └── [other compiled files]
│
├── .env.example                             # Environment template
├── .env                                     # Environment variables (in .gitignore)
├── .gitignore                               # Git ignore rules
├── tsconfig.json                            # TypeScript configuration
├── package.json                             # Dependencies and scripts
├── package-lock.json                        # Locked versions
│
├── README.md                                # Main documentation
├── DEPLOYMENT.md                            # Production deployment guide
└── PROJECT_STRUCTURE.md                     # This file
```

## Module Responsibilities

### QuestradeClient (`src/client.ts`)
- **Lines:** ~500
- **Responsibility:** Orchestrates all four sub-modules
- **Methods:**
  - Account operations: `getAccounts()`, `getAccountBalance()`, `getPositions()`, `getOrders()`, `placeOrder()`, `cancelOrder()`, `getExecutions()`, `getActivities()`
  - Market data: `getMarkets()`, `getQuote()`, `searchSymbols()`
  - Streaming: `connectStream()`, `subscribeToQuotes()`, `closeStream()`
  - Utilities: `getTokenInfo()`, `getQueueStats()`, `getRateLimitInfo()`, `shutdown()`

### AuthenticationManager (`src/modules/authentication.ts`)
- **Lines:** ~450
- **Dependencies:** `node-crypto`, `node-fs`, `EventEmitter`
- **Key Features:**
  - OAuth 2.0 Authorization Code and Implicit flows
  - Token refresh with concurrent request handling
  - Encrypted storage with AES-256-CBC
  - 30-minute expiry with 30-second refresh buffer
  - Event emission for token lifecycle
- **Performance:** Token refresh ~100-200ms

### RateLimitingQueue (`src/modules/queue.ts`)
- **Lines:** ~400
- **Dependencies:** `uuid`, `EventEmitter`
- **Key Features:**
  - Two independent rate limit queues
  - Priority scheduling (0-10 scale)
  - 100ms batch processing interval
  - Exponential backoff (1s, 2s, 4s)
  - Max 3 retries per request
  - Real-time rate limit header parsing
- **Throughput:** 30 + 20 = 50 RPS combined

### ErrorInterceptor (`src/modules/error-handler.ts`)
- **Lines:** ~250
- **Key Features:**
  - 12 distinct error codes
  - HTTP status to error mapping
  - Order rejection details extraction
  - Retry classification
  - Network error categorization
- **Error Categories:** Client (5), Server (3), Network (3), Custom (3)

### StreamingEngine (`src/modules/streaming.ts`)
- **Lines:** ~450
- **Dependencies:** `ws`, `EventEmitter`
- **Key Features:**
  - WebSocket connection management
  - Token authentication
  - 30-minute heartbeat cycle
  - Exponential backoff reconnection (5s base, 60s max)
  - 10 maximum reconnection attempts
  - Per-session subscription management
  - Message sequence numbering
- **Supported Streams:** Level 1, Level 2, Trades, Notifications

### Logger (`src/modules/logger.ts`)
- **Lines:** ~250
- **Features:**
  - 5 log levels (TRACE, DEBUG, INFO, WARN, ERROR)
  - JSON and pretty-print formatting
  - File stream with configurable path
  - Request context tracking
  - Structured metadata support

## Type System

### Core Type Hierarchies

```typescript
// Discriminated Union Errors
type QuestradeError = 
  | UnauthorizedError
  | RateLimitedError
  | NetworkError
  | OrderRejectionError
  | ...

// Strongly-typed Enums
enum EndpointCategory { ACCOUNT = 'account', MARKET_DATA = 'market' }
enum OrderType { MARKET, LIMIT, STOP_LOSS, STOP_LIMIT, TRAILING_STOP }
enum OrderSide { BUY, SELL }
enum OrderStatus { OPEN, CLOSED, PARTIAL, PENDING, REJECTED, CANCELLED, EXPIRED }
enum ErrorCode { ...12 distinct codes... }

// Generic Request/Response
interface HTTPResponse<T> { status, headers, body: T, timestamp }
interface QueuedRequest<T> { id, category, priority, method, path, body, retries }
```

## API Coverage

### Implemented Endpoints

```
Accounts:
  GET    /accounts
  GET    /accounts/{id}/balances
  GET    /accounts/{id}/positions
  GET    /accounts/{id}/orders
  POST   /accounts/{id}/orders
  DELETE /accounts/{id}/orders/{orderId}
  GET    /accounts/{id}/executions
  GET    /accounts/{id}/activities

Markets:
  GET    /markets
  GET    /markets/quotes/{symbolId}
  GET    /symbols/search

Streaming:
  GET    /notifications/stream (returns stream port)
  WS     :{streamPort} (WebSocket connection)
```

## Configuration Hierarchy

1. **Environment Variables** (.env)
   - Production credentials and secrets
   - Rate limit overrides
   - Feature flags

2. **Code Defaults** (src/modules/*)
   - Reasonable production defaults
   - Conservative retry/backoff settings
   - Safe timeout values

3. **Constructor Options** (QuestradeClient)
   - Runtime overrides
   - Development-specific settings
   - Custom logging paths

## Development/Production Parity

- **Simulations Disabled in Production**
  - `ENABLE_TOKEN_SIMULATION=false`
  - `ENABLE_MOCK_STREAMS=false`
  
- **Simulations Available in Development**
  - Token expiry/refresh simulation
  - Rate limit hitting
  - Network failure injection
  - WebSocket disconnect simulation

## Testing Strategy

- **Unit Tests:** Each module independently
- **Integration Tests:** Full client with mock API
- **Mock API Server:** Development/testing
- **Coverage Target:** >85%

## Build & Deployment

```bash
# Development
npm install
npm run dev          # Start mock API
npm run dev:client   # Start example client
npm run test:watch   # Watch tests

# Production
npm run build        # Compile TypeScript
npm run type-check   # Verify types
docker build .       # Build container
docker run ...       # Deploy
```

## Performance Characteristics

| Metric | Value |
|--------|-------|
| Max Throughput | 50 RPS (30 account + 20 market) |
| Token Refresh | <500ms (mostly network) |
| Queue Processing | 100ms batches |
| Memory Baseline | ~20MB |
| WebSocket Reconnect | 5-60s (exponential backoff) |
| Heartbeat Interval | 30 minutes |
| Request Timeout | 30s (configurable) |
| Max Retries | 3 (with backoff) |

## Security Features

- AES-256-CBC token encryption (optional)
- No credentials in logs
- OAuth 2.0 Authorization Code flow
- Token auto-refresh with zero downtime
- Rate limiting prevents abuse
- Retry logic prevents hammering
- Graceful error handling
- Audit logging available

## Dependencies

### Runtime
- `express` - HTTP framework (examples)
- `node-fetch` - HTTP client
- `ws` - WebSocket client
- `uuid` - ID generation
- `dotenv` - Environment loading

### DevDependencies
- `typescript` - Language
- `ts-node` - TS execution
- `jest` - Testing
- `eslint` - Linting
- `prettier` - Formatting

## File Sizes

| File | Lines | Size |
|------|-------|------|
| types/index.ts | 450 | ~15KB |
| modules/authentication.ts | 450 | ~14KB |
| modules/queue.ts | 400 | ~13KB |
| modules/streaming.ts | 450 | ~14KB |
| modules/error-handler.ts | 250 | ~8KB |
| modules/logger.ts | 250 | ~8KB |
| client.ts | 500 | ~16KB |
| **Total** | **2750** | **~88KB** |

## Development Workflow

1. Copy `.env.example` to `.env`
2. Run `npm install`
3. Run `npm run dev` to start mock API
4. Run `npm run dev:client` in another terminal
5. Create OAuth flow to get initial token
6. Token persists in `.keys/tokens.json`
7. Client automatically uses and refreshes token
8. Monitor logs in `.keys/logs/questrade-api.log`
9. Check health at `GET /health`

## Production Workflow

1. Compile: `npm run build`
2. Copy `dist/` to production
3. Set environment variables
4. Create `.keys/` directory (mode 700)
5. Start service via systemd
6. Monitor at `/health` endpoint
7. View logs via `journalctl -u questrade-api`
8. Alert on error rates and token refresh failures
