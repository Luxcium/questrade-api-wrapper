# Production Deployment Guide

## Pre-Deployment Checklist

### 1. Security Hardening

- [ ] Generate strong `TOKEN_ENCRYPTION_KEY` (32 bytes hex)
  ```bash
  openssl rand -hex 32
  ```
- [ ] Set `.keys/` directory permissions to `700` (owner only)
- [ ] Enable token encryption: `TOKEN_ENCRYPTION_ENABLED=true`
- [ ] Use HTTPS for OAuth redirect URI
- [ ] Rotate `QUESTRADE_CLIENT_SECRET` regularly
- [ ] Never commit `.env` or `.keys/` directory
- [ ] Use environment variable management (not .env file in prod)

### 2. Configuration Validation

```bash
# Type check
npm run type-check

# Build
npm run build

# Test with mock API
npm run test
```

### 3. Environment Setup

Copy `.env.example` to production environment:

```bash
# OAuth (from Questrade API Console)
QUESTRADE_CLIENT_ID=your_production_id
QUESTRADE_CLIENT_SECRET=your_production_secret
QUESTRADE_REDIRECT_URI=https://your-domain.com/callback

# Storage
TOKEN_STORAGE_PATH=/etc/questrade/.keys/tokens.json
TOKEN_ENCRYPTION_KEY=<generated-32-byte-hex>

# Logging
NODE_ENV=production
LOG_LEVEL=warn
LOG_FILE=/var/log/questrade-api.log
LOG_PRETTY=false

# Rate Limiting (match Questrade API limits)
RATE_LIMIT_ACCOUNT_RPS=30
RATE_LIMIT_MARKET_RPS=20

# Streaming
STREAM_HEARTBEAT_INTERVAL_MS=1800000
STREAM_RECONNECT_MAX_ATTEMPTS=10

# Features (disable simulations in production)
ENABLE_TOKEN_SIMULATION=false
ENABLE_MOCK_STREAMS=false
ENABLE_METRICS=true
```

### 4. Directory Structure

```
/etc/questrade/
  .keys/
    tokens.json          # Encrypted token (mode 600)
    logs/
      questrade-api.log  # Rotated by logrotate

/var/log/
  questrade-api.log      # Application logs

/var/run/
  questrade-api.pid      # Process ID (for systemd)
```

### 5. Systemd Service Configuration

Create `/etc/systemd/system/questrade-api.service`:

```ini
[Unit]
Description=Questrade API Service
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=simple
User=questrade
Group=questrade
WorkingDirectory=/opt/questrade-api

Environment="NODE_ENV=production"
EnvironmentFile=/etc/questrade/.env

ExecStart=/usr/bin/node /opt/questrade-api/dist/server.js

# Auto-restart on failure
Restart=always
RestartSec=30

# Resource limits
MemoryMax=512M
CPUQuota=50%

# Graceful shutdown
KillMode=mixed
KillSignal=SIGTERM
TimeoutStopSec=30

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/log /etc/questrade/.keys

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable questrade-api
sudo systemctl start questrade-api
```

### 6. Log Rotation

Create `/etc/logrotate.d/questrade-api`:

```
/var/log/questrade-api.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 640 questrade questrade
    sharedscripts
    postrotate
        systemctl reload questrade-api > /dev/null 2>&1 || true
    endscript
}
```

### 7. Monitoring & Alerting

#### Prometheus Metrics

Export metrics at `/metrics` endpoint:

```typescript
import express from 'express';
import { register } from 'prom-client';

app.get('/metrics', (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(register.metrics());
});
```

Key metrics to expose:
- `questrade_api_requests_total` - Counter by category/status
- `questrade_api_request_duration_ms` - Histogram
- `questrade_api_rate_limit_remaining` - Gauge by category
- `questrade_api_queue_size` - Gauge by category
- `questrade_api_token_expiry_seconds` - Gauge
- `questrade_api_errors_total` - Counter by error code

#### Alerting Rules

```yaml
groups:
  - name: questrade-api
    rules:
      - alert: QuestradeTokenAboutToExpire
        expr: questrade_api_token_expiry_seconds < 300
        for: 5m

      - alert: QuestradeRateLimitExceeded
        expr: questrade_api_rate_limit_exceeded_total > 0
        for: 1m

      - alert: QuestradeQueueBacklog
        expr: questrade_api_queue_size > 100
        for: 5m

      - alert: QuestradeHighErrorRate
        expr: rate(questrade_api_errors_total[5m]) > 0.1
        for: 5m

      - alert: QuestradeStreamDisconnected
        expr: questrade_api_stream_connected == 0
        for: 2m
```

### 8. Health Check Endpoint

```typescript
app.get('/health', (req, res) => {
  const tokenInfo = client.getTokenInfo();
  const queueStats = client.getQueueStats();
  const rateLimitInfo = client.getRateLimitInfo();

  const isHealthy =
    tokenInfo && !tokenInfo.isExpired &&
    queueStats.totalFailed < 100 &&
    Object.values(rateLimitInfo).every(r => r.remaining > 0);

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    token: tokenInfo,
    queue: queueStats,
    rateLimit: rateLimitInfo,
  });
});
```

Use in health checks:
```bash
curl -f http://localhost:3000/health || systemctl restart questrade-api
```

### 9. Backup Strategy

#### Token Backup

Token is encrypted by default. Still, rotate it regularly:

```bash
# Automated token rotation (cron job daily)
0 2 * * * /opt/questrade-api/scripts/rotate-tokens.sh
```

#### Log Archival

```bash
# Archive logs older than 30 days
0 3 * * * find /var/log -name "questrade-api.log*" -mtime +30 -exec gzip {} \; -exec s3cmd put {} s3://backup-bucket/ \;
```

### 10. Performance Tuning

#### Node.js Optimization

```bash
# Increase file descriptors
ulimit -n 65536

# Use production mode
NODE_ENV=production

# Enable clustering (if using PM2)
pm2 start dist/server.js -i max --name "questrade-api"
```

#### Database Connection Pooling (if using for persistence)

```typescript
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});
```

### 11. Disaster Recovery

#### Failover Setup

1. **Primary/Secondary Deployment**
   - Active-passive setup with shared token storage
   - Shared Redis for request deduplication
   - Weighted DNS for failover

2. **Token Sync**
   ```typescript
   // Sync token across instances
   async function syncToken() {
     const token = await redis.get('questrade:token');
     if (token) {
       await client.loadToken(JSON.parse(token));
     }
   }
   ```

3. **Request Idempotency**
   ```typescript
   // Implement request deduplication
   app.post('/orders', async (req, res) => {
     const idempotencyKey = req.headers['idempotency-key'];
     
     const cached = await redis.get(`order:${idempotencyKey}`);
     if (cached) return res.json(JSON.parse(cached));
     
     const result = await client.placeOrder(...);
     await redis.setex(`order:${idempotencyKey}`, 3600, JSON.stringify(result));
     
     res.json(result);
   });
   ```

### 12. Rollback Procedure

If deployment introduces issues:

```bash
# Check status
systemctl status questrade-api

# View recent logs
journalctl -u questrade-api -n 100 --no-pager

# Rollback to previous version
cd /opt/questrade-api
git checkout previous-release
npm install
npm run build
systemctl restart questrade-api

# Verify health
curl http://localhost:3000/health
```

## Production Launch Checklist

- [ ] All environment variables configured
- [ ] Token encryption key generated and secured
- [ ] Systemd service created and tested
- [ ] Log rotation configured
- [ ] Health check endpoint responding
- [ ] Monitoring/alerting configured
- [ ] Backup strategy in place
- [ ] Disaster recovery tested
- [ ] Documentation updated
- [ ] Team trained on runbooks
- [ ] Incident response plan ready

## Post-Deployment

1. **Monitor Key Metrics**
   - Token refresh cycles
   - Rate limit behavior
   - Queue depths
   - Error rates by type

2. **Regular Reviews**
   - Weekly: Error patterns, rate limits
   - Monthly: Performance trends, scaling needs
   - Quarterly: Security audit, token rotation

3. **Maintenance Windows**
   - Schedule during low-liquidity periods (nights/weekends)
   - Drain queue before shutdown
   - Validate token before restart

## Troubleshooting Production Issues

### High Error Rates
```bash
# Check logs for patterns
tail -f /var/log/questrade-api.log | grep ERROR

# Check rate limit state
curl http://localhost:3000/health | jq .rateLimit

# Monitor queue backlog
curl http://localhost:3000/health | jq .queue
```

### Token Refresh Failures
```bash
# Check token validity
curl http://localhost:3000/health | jq .token

# Verify environment
echo $QUESTRADE_CLIENT_ID
echo $QUESTRADE_CLIENT_SECRET (should not print)

# Check system time
timedatectl
```

### Memory Growth
```bash
# Check for memory leaks
node --expose-gc dist/server.js

# Monitor with
watch -n 1 'ps aux | grep node'

# Use heap snapshot
node --inspect dist/server.js
# Then chrome://inspect
```
