# Project Structure

```
questrade-api-wrapper/
├── src/
│   ├── client.ts                  QuestradeClient — main orchestrator
│   ├── index.ts                   Public exports (barrel)
│   ├── types/
│   │   └── index.ts               All TypeScript types, interfaces, and enums
│   ├── modules/
│   │   ├── authentication.ts      OAuth 2.0 token lifecycle (AuthenticationManager)
│   │   ├── error-handler.ts       HTTP error parsing (ErrorInterceptor)
│   │   ├── logger.ts              Structured logging (Logger)
│   │   ├── queue.ts               Rate-limiting request queue (RateLimitingQueue)
│   │   └── streaming.ts           WebSocket stream management (StreamingEngine)
│   ├── dev/
│   │   └── mock-api.ts            Development mock server (requires express)
│   └── examples/
│       └── oauth-flow.ts          OAuth flow example script
├── tests/
│   └── client.test.ts             Jest tests (all HTTP calls mocked)
├── docs/
│   ├── architecture.md            Module design and data flow
│   ├── quickstart.md              Shortest path to a working integration
│   ├── testing.md                 Test structure and mock setup
│   ├── deployment.md              Configuration and hardening notes
│   ├── project-structure.md       This file
│   └── status.md                  Current status and known gaps
├── .env.example                   Template for environment variables
├── .gitignore
├── CONTRIBUTING.md                Branch workflow and contribution guide
├── LICENSE                        MIT
├── README.md
├── jest.config.js
├── package.json
├── tsconfig.json                  Build config (excludes tests/)
└── tsconfig.test.json             Type-check config (includes tests/)
```

## Entry points

| File | Purpose |
|---|---|
| `src/index.ts` | Library public API — import from here |
| `src/dev/mock-api.ts` | `npm run dev` — starts mock server on port 4000 |
| `src/examples/oauth-flow.ts` | `npm run dev:client` — interactive OAuth example |
| `dist/index.js` | Compiled output — package `main` field |
