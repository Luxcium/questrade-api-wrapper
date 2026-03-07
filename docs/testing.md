# Testing

## Test file location

```
tests/
  client.test.ts   — Jest integration tests
```

> Note: `tsconfig.json` excludes `tests/` from the build output. Tests are type-checked separately via `tsconfig.test.json` when you run `npm run type-check`.

## Running tests

```bash
npm test            # run all tests once
npm run test:watch  # watch mode
npm run test:coverage
```

## Network isolation

All tests mock `node-fetch` at the module boundary:

```typescript
jest.mock('node-fetch', () => {
  const mockFetch = jest.fn();
  return mockFetch;
});
```

This means tests run entirely offline — no real Questrade credentials are required and no HTTP requests are made.

## Test categories

| Test suite | What it covers |
|---|---|
| Authentication | Token exchange via mocked OAuth endpoint |
| Account Operations | `getAccounts`, `getAccountBalance`, `getPositions`, `getOrders`, `placeOrder` |
| Market Data | `getMarkets`, `getQuote`, `searchSymbols` |
| Rate Limiting | Queue statistics, rate limit state tracking |
| Error Handling | 401/404 responses throw typed `QuestradeError` instances |
| Event Emission | `request-completed` and `token-refreshed` events |
| Health and Metrics | `getTokenInfo`, `getQueueStats`, `getRateLimitInfo` |
| `getAuthorizationUrl` | Uses constructor config, not `process.env` |
| `QuestradeError` | `instanceof QuestradeError` works |

## Mock API server (manual / integration testing)

For manual exploratory testing without real credentials, start the dev mock server:

```bash
npm run dev
```

This starts an Express server on port 4000 that simulates Questrade API responses. It also provides a mock OAuth token endpoint so you can run the example flow.

The mock server is **not** required for `npm test` — tests use in-process jest mocks.

## Adding a new test

1. Add your test case inside `tests/client.test.ts` in the relevant `describe` block.
2. Use `mockFetch.mockImplementation(...)` to return the specific response shape you need.
3. Use enum values (`OrderSide.BUY`) instead of raw strings.
