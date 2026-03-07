# questrade-api-wrapper

A TypeScript wrapper for the [Questrade API](https://www.questrade.com/api) providing OAuth 2.0 authentication, rate limiting, structured error handling, and WebSocket streaming.

## Status

**Feature-complete prototype / pre-production.**  
The library has not been validated against live Questrade environments. Use it as a starting point and test thoroughly with your own credentials before relying on it in production.

---

## Quick Start

### Prerequisites

- Node.js ≥ 16
- A [Questrade API application](https://www.questrade.com/api/documentation/getting-started) (Client ID and optional Client Secret)

### Install

```bash
npm install questrade-api-wrapper
```

### Configure environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```dotenv
QUESTRADE_CLIENT_ID=your_client_id
QUESTRADE_REDIRECT_URI=http://localhost:3000/callback
# Optional but recommended
TOKEN_ENCRYPTION_KEY=your_32_byte_hex_key
```

### Start the mock API (for local development / tests)

```bash
npm run dev
# Mock API server starts on http://localhost:4000
```

### Run tests

```bash
npm test
```

Tests use `jest.mock('node-fetch')` and do **not** require network access or real credentials.

---

## Usage

```typescript
import { QuestradeClient, OrderSide, OrderType } from 'questrade-api-wrapper';

const client = new QuestradeClient({
  clientId: process.env.QUESTRADE_CLIENT_ID!,
  redirectUri: process.env.QUESTRADE_REDIRECT_URI!,
});

// Step 1: Direct user to the authorization URL
const authUrl = client.getAuthorizationUrl();
console.log('Visit:', authUrl);

// Step 2: After user grants access, exchange the code
await client.initialize(authorizationCode);

// Fetch accounts
const accounts = await client.getAccounts();
console.log(accounts);

// Get a quote
const quote = await client.getQuote(8049); // AAPL symbol ID
console.log(quote.bid, quote.ask);

// Place an order
const { orderId } = await client.placeOrder(accounts[0].accountId, {
  symbol: 'AAPL',
  quantity: 10,
  side: OrderSide.BUY,
  type: OrderType.LIMIT,
  price: 150.00,
});
```

### Streaming

```typescript
await client.connectStream('my-session', 'level1');
client.subscribeToQuotes('my-session', ['AAPL', 'MSFT']);

client.on('stream-message', ({ sessionId, message }) => {
  console.log('Quote update:', message);
});
```

### Events

| Event | Payload |
|---|---|
| `request-completed` | `{ requestId, duration, category }` |
| `request-failed` | `{ requestId, category, error }` |
| `rate-limit-exceeded` | `{ category, waitMs }` |
| `token-refreshed` | `{ timestamp, expiresIn }` |
| `token-refresh-failed` | `error` |
| `stream-connected` | `{ sessionId }` |
| `stream-message` | `{ sessionId, message }` |
| `stream-disconnected` | `{ sessionId }` |
| `stream-error` | `{ sessionId, error }` |

---

## Development Workflow

### Common commands

```bash
npm run build        # Compile TypeScript → dist/
npm run dev          # Start mock API server (port 4000)
npm test             # Run unit tests (no network required)
npm run type-check   # Type-check src/ and tests/
npm run lint         # ESLint
npm run format       # Prettier
```

### Project layout

```
src/
  client.ts             Main QuestradeClient orchestrator
  index.ts              Public barrel export
  types/
    index.ts            All type definitions and enums
  modules/
    authentication.ts   OAuth token lifecycle
    queue.ts            Rate-limiting request queue
    error-handler.ts    HTTP error parsing and classification
    streaming.ts        WebSocket stream management
    logger.ts           Structured logging
  dev/
    mock-api.ts         Development mock server (requires express)
  examples/
    oauth-flow.ts       Complete OAuth flow example
tests/
  client.test.ts        Jest tests (all fetch calls mocked)
docs/                   Additional documentation
```

### Key modules

| Module | Responsibility |
|---|---|
| `AuthenticationManager` | OAuth 2.0 exchange, refresh, encrypted storage |
| `RateLimitingQueue` | Per-category request queue (30 RPS account / 20 RPS market) |
| `ErrorInterceptor` | Maps HTTP errors to typed `QuestradeError` instances |
| `StreamingEngine` | WebSocket connections with heartbeat and auto-reconnect |
| `Logger` | Structured JSON / pretty-print logging to console and file |

---

## Documentation

- [docs/architecture.md](docs/architecture.md) — module design and data flow
- [docs/quickstart.md](docs/quickstart.md) — shortest path to a working integration
- [docs/testing.md](docs/testing.md) — test structure and mock setup
- [docs/deployment.md](docs/deployment.md) — configuration and hardening notes
- [docs/status.md](docs/status.md) — current status and known gaps

---

## Known Gaps / Roadmap

- No live Questrade environment validation yet
- Streaming authentication format needs verification against live API
- No automatic token persistence between process restarts via env-only config

See [docs/status.md](docs/status.md) for the full status.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
