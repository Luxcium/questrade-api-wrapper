# Status

## Summary

This library is a **feature-complete prototype**. All core modules have been implemented and unit-tested with mocked network calls. It has **not** been validated against a live Questrade environment.

## What is implemented

| Feature | Status |
|---|---|
| OAuth 2.0 token exchange | ✅ Implemented |
| Automatic token refresh | ✅ Implemented |
| Encrypted token storage (AES-256-CBC) | ✅ Implemented |
| Rate-limiting queue (dual-tier) | ✅ Implemented |
| Env-configurable rate limit ceiling | ✅ Implemented |
| `QuestradeError` class with `instanceof` | ✅ Implemented |
| Account endpoints (8 methods) | ✅ Implemented |
| Market data endpoints (3 methods) | ✅ Implemented |
| WebSocket streaming | ✅ Implemented |
| Heartbeat / auto-reconnect | ✅ Implemented |
| Structured logging to file | ✅ Implemented |
| Request timeout (30 s via AbortController) | ✅ Implemented |
| Jest tests (fetch mocked) | ✅ 19 tests passing |

## Known gaps

| Gap | Notes |
|---|---|
| Live environment validation | Not tested against real Questrade servers |
| Streaming auth format | Needs verification — may differ from plain-text token send |
| Health / metrics endpoints | Documented in early drafts but not implemented |
| Prometheus / Redis integration | Not implemented; was a design aspiration |
| PM2 / systemd config | Not provided |
| `dist/server.js` deployable binary | Library is importable only; no standalone binary |

## Packaging note

`express` (used only by the dev mock server) was previously listed as a production dependency. It has been moved to `devDependencies`. Consumers of the library will not pull in `express`.

## Next steps before production use

1. Validate OAuth flow and token refresh against live Questrade credentials
2. Validate streaming WebSocket authentication against the live API
3. Add integration tests that run against the live sandbox (optional Questrade sandbox environment)
4. Load-test rate limiting against real API limits
5. Add retry logic for network transients (currently only retries on 5xx / 429)
