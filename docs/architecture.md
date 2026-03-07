# Architecture

## Overview

`QuestradeClient` is the public entry point. It coordinates four core modules through an event-driven design. All modules extend `EventEmitter` and communicate via events rather than direct calls.

```
QuestradeClient (EventEmitter)
├── AuthenticationManager  — OAuth lifecycle
├── RateLimitingQueue      — Request scheduling
├── ErrorInterceptor       — Error parsing
└── StreamingEngine        — WebSocket management
```

## Request Lifecycle

```
client.getAccounts()
  └─ request(category, method, path)
       ├─ queue.enqueue()          → assigns request ID
       ├─ queue.registerHandler()  → attaches executor callback
       └─ queue processes interval → executeRequest()
            └─ auth.executeWithAuth()
                 ├─ validateAndRefreshIfNeeded()
                 ├─ get Authorization header
                 └─ performRequest(method, path, authHeader)
                      ├─ fetch(url, { signal: AbortController })  ← 30s timeout
                      └─ handleResponse()
                           ├─ errorHandler.parseResponse()        ← throws on 4xx/5xx
                           └─ return response.body                ← returns T on 2xx
```

## Module Details

### AuthenticationManager (`src/modules/authentication.ts`)

Manages the OAuth 2.0 token lifecycle:

- `initialize(authCode?)` — loads token from disk or exchanges auth code
- `executeWithAuth(fn)` — injects `Authorization: Bearer <token>` header; retries once on 401
- `refreshToken()` — deduplicates concurrent refresh requests using a shared promise
- Token storage: JSON file at `tokenStoragePath`; optionally AES-256-CBC encrypted

### RateLimitingQueue (`src/modules/queue.ts`)

Dual-tier request queue with independent rate limiting per endpoint category:

- `EndpointCategory.ACCOUNT` — default 30 RPS (overridable via `RATE_LIMIT_ACCOUNT_RPS`)
- `EndpointCategory.MARKET_DATA` — default 20 RPS (overridable via `RATE_LIMIT_MARKET_RPS`)
- Processes requests every 100 ms in priority order (0 = lowest, 10 = highest)
- Exponential backoff retry: up to 3 attempts with 1s / 2s / 4s delays
- Handlers are cleaned up after execution to prevent memory leaks

### ErrorInterceptor (`src/modules/error-handler.ts`)

Converts raw HTTP responses to typed errors:

- `parseResponse<T>(HTTPResponse<T>)` — returns the response on 2xx, throws `QuestradeError` otherwise
- `handleNetworkError(Error)` — classifies fetch-level exceptions (timeout, ECONNREFUSED, etc.)
- `QuestradeError` is a proper class extending `Error`; `instanceof` checks work correctly

### StreamingEngine (`src/modules/streaming.ts`)

WebSocket connection manager:

- One session = one WebSocket connection identified by a `sessionId`
- Authentication: sends the access token as a plain-text message immediately after `open`
- Heartbeat: sends a `ping` every 30 minutes to keep the connection alive
- Reconnection: exponential backoff from 5 s up to 60 s, max 10 attempts
- Old listeners are removed before reconnecting to prevent duplicate event handlers

### Logger (`src/modules/logger.ts`)

Structured logger with two output modes:

- **Pretty** (development): colorized console output; ANSI codes are stripped before writing to file
- **JSON** (production): `{ timestamp, level, message, context, requestId }` per line
- Log writes that arrive before the file stream is ready are buffered and flushed when the stream opens

## Event Wiring

```
queue ──► request-completed ──► client ──► external listeners
      ──► request-failed    ──►
      ──► rate-limit-exceeded ──►

auth  ──► token-refreshed        ──► client ──►
      ──► token-refresh-failed   ──►

stream ──► stream-connected      ──► client ──►
       ──► stream-message        ──►
       ──► stream-disconnected   ──►
       ──► stream-error          ──►
```
