/**
 * Example: OAuth 2.0 Authorization Flow
 * Shows how to handle redirect callback and initialize client
 */

import express, { Request, Response } from 'express';
import { QuestradeClient } from '../client';

// Initialize Express for OAuth callback
const app = express();

// Initialize client (tokens will be loaded from disk if available)
const client = new QuestradeClient(
  {
    clientId: process.env.QUESTRADE_CLIENT_ID!,
    clientSecret: process.env.QUESTRADE_CLIENT_SECRET,
    redirectUri: process.env.QUESTRADE_REDIRECT_URI!,
  },
  {
    logLevel: 'info',
    logFile: '.keys/logs/questrade-api.log',
    tokenStoragePath: '.keys/tokens.json',
  }
);

/**
 * Route: Initiate OAuth flow
 * GET /auth
 */
app.get('/auth', (req: Request, res: Response) => {
  const authUrl = client.getAuthorizationUrl([
    'PlaceTrades', // Required for order placement
    'AccountAccess', // Required for account operations
    'MoveMoney', // Required for deposits/withdrawals
  ]);

  res.redirect(authUrl);
});

/**
 * Route: OAuth callback handler
 * GET /callback?code=...
 */
app.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.status(400).send('Missing authorization code');
    }

    // Initialize client with auth code
    await client.initialize(code);

    // Token is now stored securely in .keys/tokens.json
    // Subsequent requests will automatically use and refresh it

    res.send('Authorization successful! You can now use the API.');
  } catch (error) {
    console.error('Authorization failed:', error);
    res.status(500).send('Authorization failed');
  }
});

/**
 * Route: Get account information
 * GET /api/accounts
 */
app.get('/api/accounts', async (req: Request, res: Response) => {
  try {
    const accounts = await client.getAccounts();
    res.json(accounts);
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

/**
 * Route: Get account balance
 * GET /api/accounts/:id/balance
 */
app.get('/api/accounts/:id/balance', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const balance = await client.getAccountBalance(accountId);
    res.json(balance);
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

/**
 * Route: Get positions
 * GET /api/accounts/:id/positions
 */
app.get('/api/accounts/:id/positions', async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const positions = await client.getPositions(accountId);
    res.json(positions);
  } catch (error) {
    console.error('Error fetching positions:', error);
    res.status(500).json({ error: 'Failed to fetch positions' });
  }
});

/**
 * Route: Place order
 * POST /api/accounts/:id/orders
 */
app.post('/api/accounts/:id/orders', express.json(), async (req: Request, res: Response) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const order = req.body;

    const result = await client.placeOrder(accountId, order);
    res.json(result);
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

/**
 * Route: Quote lookup
 * GET /api/markets/quotes/:symbolId
 */
app.get('/api/markets/quotes/:symbolId', async (req: Request, res: Response) => {
  try {
    const symbolId = parseInt(req.params.symbolId, 10);
    const quote = await client.getQuote(symbolId);
    res.json(quote);
  } catch (error) {
    console.error('Error fetching quote:', error);
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

/**
 * Route: Symbol search
 * GET /api/symbols/search?query=...
 */
app.get('/api/symbols/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = '10' } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).send('Missing query parameter');
    }

    const results = await client.searchSymbols(query, parseInt(limit as string, 10));
    res.json(results);
  } catch (error) {
    console.error('Error searching symbols:', error);
    res.status(500).json({ error: 'Failed to search symbols' });
  }
});

/**
 * Route: WebSocket stream for real-time market data
 * GET /stream
 */
app.get('/stream', async (req: Request, res: Response) => {
  try {
    const sessionId = `session-${Date.now()}`;

    // Connect to stream
    await client.connectStream(sessionId, 'level1');

    // Subscribe to quotes
    client.subscribeToQuotes(sessionId, ['AAPL', 'GOOGL', 'MSFT']);

    // Listen for messages
    client.on('stream-message', ({ sessionId: id, message }) => {
      if (id === sessionId) {
        console.log('Received stream message:', message);
      }
    });

    res.json({ message: 'Stream connected', sessionId });
  } catch (error) {
    console.error('Error connecting stream:', error);
    res.status(500).json({ error: 'Failed to connect stream' });
  }
});

/**
 * Route: Health check with metrics
 * GET /health
 */
app.get('/health', (req: Request, res: Response) => {
  const tokenInfo = client.getTokenInfo();
  const queueStats = client.getQueueStats();
  const rateLimitInfo = client.getRateLimitInfo();

  res.json({
    status: 'healthy',
    token: tokenInfo,
    queue: queueStats,
    rateLimit: rateLimitInfo,
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await client.shutdown();
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
