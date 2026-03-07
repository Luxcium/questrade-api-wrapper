# Contributing

Thank you for contributing! Please read this guide before opening a PR.

## Branch workflow

1. Fork the repository (or create a branch from `main` if you have write access)
2. Name your branch descriptively: `fix/handle-response-body`, `feat/add-candles-endpoint`, etc.
3. Open a pull request against `main`

## Development setup

```bash
git clone https://github.com/Luxcium/questrade-api-wrapper.git
cd questrade-api-wrapper
npm install
cp .env.example .env   # fill in credentials if you plan to test live
```

## Coding standards

- **TypeScript strict mode** is enabled — all code must type-check without errors
- Use existing module patterns (see `src/modules/`) for new features
- Keep modules focused: one responsibility per file
- Export everything through `src/index.ts`

## Running checks

```bash
npm run build        # must pass before opening a PR
npm run type-check   # checks src/ and tests/
npm run lint         # ESLint
npm run format       # Prettier (run this before committing)
npm test             # all 19 tests must pass
```

## Adding a new API endpoint

1. Add the type definitions to `src/types/index.ts`
2. Add the method to `QuestradeClient` in `src/client.ts` using the `request<T>()` helper
3. Export the new types from `src/index.ts`
4. Add a test in `tests/client.test.ts` with a mocked fetch response

Example:

```typescript
// In src/client.ts
async getCandles(symbolId: number, interval: string): Promise<Candle[]> {
  const response = await this.request<{ candles: Candle[] }>(
    EndpointCategory.MARKET_DATA,
    'GET',
    `/markets/candles/${symbolId}?interval=${interval}`
  );
  return response.candles;
}
```

## Adding a test

All tests live in `tests/client.test.ts`. Tests must not make real network calls — use `mockFetch.mockImplementation(...)` to provide responses:

```typescript
it('should get candles', async () => {
  mockFetch.mockImplementation((url: RequestInfo) => {
    if (url.toString().includes('/candles/')) {
      return mockResponse({ candles: [...] });
    }
    return defaultMockImpl(url);
  });

  const candles = await client.getCandles(8049, 'OneDay');
  expect(Array.isArray(candles)).toBe(true);
});
```

## PR checklist

- [ ] `npm run build` passes
- [ ] `npm run type-check` passes
- [ ] `npm test` passes
- [ ] New/changed types exported from `src/index.ts`
- [ ] `CONTRIBUTING.md` or `docs/` updated if workflow changed
- [ ] No secrets or credentials committed
