# Deployment Notes

This library is a **pre-production prototype**. The following notes describe configuration and hardening steps for eventual production use. They have not been fully validated against live Questrade environments.

## Environment variables

Copy `.env.example` to your deployment environment and fill in real values. Never commit `.env` or `.keys/` to version control.

| Variable | Required | Description |
|---|---|---|
| `QUESTRADE_CLIENT_ID` | ✅ | OAuth application client ID |
| `QUESTRADE_CLIENT_SECRET` | ❌ | OAuth application client secret (if confidential client) |
| `QUESTRADE_REDIRECT_URI` | ✅ | OAuth redirect URI (must match your app registration) |
| `TOKEN_STORAGE_PATH` | ❌ | Path to store encrypted token (default: `.keys/tokens.json`) |
| `TOKEN_ENCRYPTION_KEY` | ❌ | 32-byte hex key for AES-256-CBC token encryption |
| `NODE_ENV` | ❌ | Set to `production` to disable dev features |
| `LOG_LEVEL` | ❌ | `trace` \| `debug` \| `info` \| `warn` \| `error` (default: `info`) |
| `LOG_FILE` | ❌ | File path for log output |
| `LOG_PRETTY` | ❌ | `true` for human-readable output, `false` for JSON |
| `RATE_LIMIT_ACCOUNT_RPS` | ❌ | Account endpoint RPS ceiling (default: `30`) |
| `RATE_LIMIT_MARKET_RPS` | ❌ | Market data endpoint RPS ceiling (default: `20`) |

## Security checklist

- [ ] Generate a strong encryption key: `openssl rand -hex 32`
- [ ] Set `.keys/` directory permissions to `700` (owner only)
- [ ] Use HTTPS for the OAuth redirect URI
- [ ] Use environment variable management instead of `.env` files in production
- [ ] Rotate `QUESTRADE_CLIENT_SECRET` regularly
- [ ] Never log the access or refresh token

## Build and deploy

```bash
npm run build          # compile TypeScript → dist/
npm run type-check     # verify types before shipping
npm test               # confirm all tests pass
```

The compiled entry point is `dist/index.js`.

## Known gaps

- No health-check endpoint or Prometheus metrics endpoint — these were referenced in early documentation but are not implemented.
- No `dist/server.js` deployable binary — the library is meant to be imported, not run standalone.
- No PM2 / systemd configuration files are provided.
- Performance metrics (latency, memory baseline) in earlier documentation were design targets, not measured values.
