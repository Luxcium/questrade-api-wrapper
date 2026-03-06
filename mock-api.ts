/**
 * Development Server
 * Provides development/testing capabilities with simulated tokens and mock endpoints
 * - Token simulation for testing without real OAuth
 * - Mock API endpoints that simulate Questrade API responses
 * - Rate limit simulation for testing backoff logic
 * - Stream simulation for testing WebSocket handling
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';

interface MockToken {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  api_server: string;
}

const app = express();
app.use(express.json());

// Token storage directory
const TOKEN_DIR = '.keys';
const TOKENS_FILE = path.join(TOKEN_DIR, 'tokens.json');

/**
 * Generate mock token
 */
function generateMockToken(): MockToken {
  return {
    access_token: `mock_access_${uuidv4()}`,
    token_type: 'Bearer',
    expires_in: process.env.NODE_ENV === 'development' ? 3600 : 300,
    refresh_token: `mock_refresh_${uuidv4()}`,
    api_server: 'http://localhost:4000',
  };
}

/**
 * Save mock token to disk
 */
async function saveMockToken(token: MockToken): Promise<void> {
  await fs.mkdir(TOKEN_DIR, { recursive: true });
  const payload = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    apiServer: token.api_server,
    expiresAt: Date.now() + token.expires_in * 1000,
    refreshTokenExpiresAt: Date.now() + 72 * 60 * 60 * 1000,
  };
  await fs.writeFile(TOKENS_FILE, JSON.stringify(payload, null, 2));
}

/**
 * OAuth: Exchange auth code for token
 */
app.post('/oauth2/token', async (req: express.Request, res: express.Response) => {
  const { code, grant_type, refresh_token } = req.body;

  if (grant_type === 'authorization_code' && code) {
    const token = generateMockToken();
    await saveMockToken(token);
    return res.json(token);
  }

  if (grant_type === 'refresh_token' && refresh_token) {
    const token = generateMockToken();
    await saveMockToken(token);
    return res.json(token);
  }

  res.status(400).json({ error: 'Invalid request' });
});

/**
 * OAuth: Authorization endpoint
 */
app.get('/oauth2/authorize', (req: express.Request, res: express.Response) => {
  const { redirect_uri, client_id } = req.query;
  const authCode = `mock_auth_code_${uuidv4()}`;

  // Redirect back with code (in real flow, user would login first)
  res.redirect(
    `${redirect_uri}?code=${authCode}&state=${req.query.state || ''}`
  );
});

/**
 * Middleware: Verify Bearer token
 */
const authMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Apply auth to all API routes
app.use('/v1', authMiddleware);

/**
 * Account: Get all accounts
 */
app.get('/v1/accounts', (req: express.Request, res: express.Response) => {
  res.json({
    accounts: [
      {
        number: 'ACC123456',
        type: 'Margin',
        status: 'Active',
        isFunded: true,
        isChart: true,
        canPlaceTrades: true,
        accountId: 26970014,
      },
      {
        number: 'ACC789012',
        type: 'RRSP',
        status: 'Active',
        isFunded: true,
        isChart: false,
        canPlaceTrades: true,
        accountId: 26970015,
      },
    ],
  });
});

/**
 * Account: Get account balance
 */
app.get('/v1/accounts/:id/balances', (req: express.Request, res: express.Response) => {
  res.set('X-RateLimit-Remaining', '29');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'account');

  res.json({
    cash: 50000,
    marketValue: 150000,
    totalEquity: 200000,
    buyingPower: 400000,
    maintenanceExcess: 150000,
    isDayTrader: false,
    maxBuyingPower: 400000,
    currency: 'CAD',
    accountType: 'Margin',
  });
});

/**
 * Account: Get positions
 */
app.get('/v1/accounts/:id/positions', (req: express.Request, res: express.Response) => {
  res.set('X-RateLimit-Remaining', '28');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'account');

  res.json({
    positions: [
      {
        symbol: 'AAPL',
        symbolId: 8049,
        openQuantity: 100,
        closedQuantity: 0,
        currentMarketValue: 18500,
        currentPrice: 185,
        averageEntryPrice: 150,
        closedPnl: 0,
        openPnl: 3500,
        totalPnl: 3500,
        isRealTime: true,
        isUnderReorg: false,
      },
      {
        symbol: 'GOOGL',
        symbolId: 10001,
        openQuantity: 50,
        closedQuantity: 0,
        currentMarketValue: 7500,
        currentPrice: 150,
        averageEntryPrice: 140,
        closedPnl: 0,
        openPnl: 500,
        totalPnl: 500,
        isRealTime: true,
        isUnderReorg: false,
      },
    ],
  });
});

/**
 * Account: Get orders
 */
app.get('/v1/accounts/:id/orders', (req: express.Request, res: express.Response) => {
  res.set('X-RateLimit-Remaining', '27');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'account');

  res.json({
    orders: [
      {
        id: 'ORD123',
        symbol: 'MSFT',
        symbolId: 5000,
        side: 'Buy',
        type: 'Limit',
        quantity: 50,
        price: 320,
        status: 'Open',
        filledQuantity: 0,
        remainingQuantity: 50,
        timeInForce: 'Day',
        creationTime: Date.now() - 3600000,
        commission: 0,
      },
    ],
  });
});

/**
 * Account: Place order
 */
app.post('/v1/accounts/:id/orders', (req: express.Request, res: express.Response) => {
  // Simulate rate limit hit
  if (process.env.DEV_SIMULATE_RATE_LIMIT_HIT === 'true') {
    res.status(429);
    res.set('X-RateLimit-Remaining', '0');
    res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 60).toString());
    return res.json({ error: 'Rate limit exceeded' });
  }

  res.set('X-RateLimit-Remaining', '25');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'account');

  res.status(201).json({
    orderId: `ORD_${Date.now()}`,
  });
});

/**
 * Markets: Get quotes
 */
app.get('/v1/markets/quotes/:symbolId', (req: express.Request, res: express.Response) => {
  res.set('X-RateLimit-Remaining', '19');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'market-data');

  res.json({
    symbol: 'AAPL',
    symbolId: parseInt(req.params.symbolId, 10),
    bid: 184.5,
    ask: 185.2,
    last: 185,
    lastTradeTime: Date.now(),
    volume: 1000000,
    isRealTime: true,
  });
});

/**
 * Markets: Search symbols
 */
app.get('/v1/symbols/search', (req: express.Request, res: express.Response) => {
  const { prefix = '', limit = '10' } = req.query;

  res.set('X-RateLimit-Remaining', '18');
  res.set('X-RateLimit-Reset', Math.ceil(Date.now() / 1000 + 1).toString());
  res.set('X-RateLimit-Category', 'market-data');

  const mockSymbols = [
    { symbol: `${prefix}AAPL`, symbolId: 8049, name: 'Apple Inc.', currency: 'USD' },
    { symbol: `${prefix}GOOGL`, symbolId: 10001, name: 'Alphabet Inc.', currency: 'USD' },
    { symbol: `${prefix}MSFT`, symbolId: 5000, name: 'Microsoft Corp.', currency: 'USD' },
  ];

  res.json({
    symbols: mockSymbols.slice(0, parseInt(limit as string, 10)),
    total: mockSymbols.length,
    limit: parseInt(limit as string, 10),
    offset: 0,
  });
});

/**
 * Stream: Get stream port
 */
app.get('/v1/notifications/stream', (req: express.Request, res: express.Response) => {
  res.json({
    streamPort: process.env.STREAM_PORT || 4001,
    streamUri: 'localhost:4001',
  });
});

/**
 * Health check
 */
app.get('/health', (req: express.Request, res: express.Response) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

/**
 * Setup
 */
async function start() {
  const PORT = process.env.MOCK_API_PORT || 4000;

  // Generate initial mock token
  const token = generateMockToken();
  await saveMockToken(token);

  console.log(`Mock Questrade API running on http://localhost:${PORT}`);
  console.log(`Initial token saved to ${TOKENS_FILE}`);
  console.log(`Auth URL: http://localhost:${PORT}/oauth2/authorize?client_id=mock&redirect_uri=http://localhost:3000/callback`);

  app.listen(PORT);
}

start().catch(console.error);
