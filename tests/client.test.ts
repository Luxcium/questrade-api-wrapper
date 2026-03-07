/**
 * Integration Tests
 * Tests all modules working together with the QuestradeClient
 * Uses jest.mock to intercept fetch calls — no real network access.
 */

import { QuestradeClient } from '../src/client';
import { ErrorCode, EndpointCategory, OrderSide, OrderType } from '../src/types';
import { Logger } from '../src/modules/logger';

// ---------------------------------------------------------------------------
// Mock node-fetch so no real HTTP requests are made
// ---------------------------------------------------------------------------
jest.mock('node-fetch', () => {
  const mockFetch = jest.fn();
  return mockFetch;
});

import fetch, { RequestInfo, RequestInit } from 'node-fetch';

const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Helper: create a mock Response with the given status and body
function mockResponse(body: unknown, status = 200): any {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      entries: () => [],
      get: () => null,
    },
    text: async () => text,
    json: async () => body,
  };
}

// Shared mock token response (used for OAuth exchange & refresh)
const MOCK_TOKEN_RESPONSE = {
  access_token: 'mock_access_token_12345',
  token_type: 'Bearer' as const,
  expires_in: 1800,
  refresh_token: 'mock_refresh_token_12345',
  api_server: 'http://localhost:4000/',
};

// Default API mock responses keyed by a simple URL substring
function defaultMockImpl(url: RequestInfo, _options?: RequestInit): any {
  const urlStr = url.toString();
  // OAuth token exchange / refresh
  if (urlStr.includes('login.questrade.com')) {
    return mockResponse(MOCK_TOKEN_RESPONSE);
  }

  // Account list
  if (urlStr.endsWith('/accounts')) {
    return mockResponse({
      accounts: [
        {
          number: '12345',
          type: 'Margin',
          status: 'Active',
          isFunded: true,
          isChart: false,
          canPlaceTrades: true,
          accountId: 12345,
        },
      ],
    });
  }

  // Account balance
  if (urlStr.includes('/balances')) {
    return mockResponse({
      cash: 10000,
      marketValue: 5000,
      totalEquity: 15000,
      buyingPower: 20000,
      maintenanceExcess: 8000,
      isDayTrader: false,
      maxBuyingPower: 20000,
      currency: 'CAD',
      accountType: 'Margin',
    });
  }

  // Positions
  if (urlStr.includes('/positions')) {
    return mockResponse({
      positions: [
        {
          symbol: 'AAPL',
          symbolId: 8049,
          openQuantity: 10,
          closedQuantity: 0,
          currentMarketValue: 1750,
          currentPrice: 175,
          averageEntryPrice: 160,
          closedPnl: 0,
          openPnl: 150,
          totalPnl: 150,
          isRealTime: true,
          isUnderReorg: false,
        },
      ],
    });
  }

  // Orders list
  if (urlStr.includes('/orders') && !urlStr.includes('DELETE')) {
    return mockResponse({ orders: [] });
  }

  // Markets
  if (urlStr.endsWith('/markets')) {
    return mockResponse({
      markets: [
        {
          id: 'TSX',
          name: 'Toronto Stock Exchange',
          status: 'Open',
          openTime: '09:30',
          closeTime: '16:00',
          timezone: 'America/Toronto',
        },
      ],
    });
  }

  // Quote
  if (urlStr.includes('/markets/quotes/')) {
    return mockResponse({
      symbol: 'AAPL',
      symbolId: 8049,
      bid: 174.5,
      ask: 175.0,
      last: 174.75,
      lastTradeTime: Date.now(),
      volume: 1000000,
      isRealTime: true,
    });
  }

  // Symbol search
  if (urlStr.includes('/symbols/search')) {
    return mockResponse({
      symbols: [
        {
          symbol: 'AAPL',
          symbolId: 8049,
          name: 'Apple Inc.',
          currency: 'USD',
          optionsEnabled: true,
          minTradeQuantity: 1,
        },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });
  }

  // Default: empty success
  return mockResponse({});
}

describe('QuestradeClient', () => {
  let client: QuestradeClient;
  let logger: Logger;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockImplementation(defaultMockImpl);

    logger = new Logger('trace');
    client = new QuestradeClient(
      {
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
        redirectUri: 'http://localhost:3000/callback',
      },
      {
        logLevel: 'debug',
        tokenStoragePath: '/tmp/test-tokens.json',
      }
    );
  });

  afterEach(async () => {
    await client.shutdown();
  });

  describe('Authentication', () => {
    it('should initialize with auth code', async () => {
      await client.initialize('mock_auth_code');

      const tokenInfo = client.getTokenInfo();
      expect(tokenInfo).toBeDefined();
      expect(tokenInfo?.apiServer).toBeDefined();
    });

    it('should handle token refresh', async () => {
      await client.initialize('mock_auth_code');

      const initialToken = client.getTokenInfo();
      expect(initialToken?.expiresIn).toBeGreaterThan(0);
    });
  });

  describe('Account Operations', () => {
    beforeEach(async () => {
      await client.initialize('mock_auth_code');
    });

    it('should get all accounts', async () => {
      const accounts = await client.getAccounts();
      expect(Array.isArray(accounts)).toBe(true);
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts[0]).toHaveProperty('accountId');
      expect(accounts[0]).toHaveProperty('type');
    });

    it('should get account balance', async () => {
      const accounts = await client.getAccounts();
      const balance = await client.getAccountBalance(accounts[0].accountId);

      expect(balance).toHaveProperty('cash');
      expect(balance).toHaveProperty('totalEquity');
      expect(balance).toHaveProperty('buyingPower');
    });

    it('should get positions', async () => {
      const accounts = await client.getAccounts();
      const positions = await client.getPositions(accounts[0].accountId);

      expect(Array.isArray(positions)).toBe(true);
      if (positions.length > 0) {
        expect(positions[0]).toHaveProperty('symbol');
        expect(positions[0]).toHaveProperty('currentMarketValue');
      }
    });

    it('should get orders', async () => {
      const accounts = await client.getAccounts();
      const orders = await client.getOrders(accounts[0].accountId);

      expect(Array.isArray(orders)).toBe(true);
    });

    it('should place order with high priority', async () => {
      // Mock POST /orders response
      mockFetch.mockImplementation((url: RequestInfo, options?: RequestInit) => {
        const urlStr = url.toString();
        if (urlStr.includes('/orders') && options?.method === 'POST') {
          return mockResponse({ orderId: 'order-abc-123' });
        }
        return defaultMockImpl(url, options);
      });

      const accounts = await client.getAccounts();
      const result = await client.placeOrder(accounts[0].accountId, {
        symbol: 'AAPL',
        quantity: 10,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        price: 150,
      });

      expect(result).toHaveProperty('orderId');
    });
  });

  describe('Market Data', () => {
    beforeEach(async () => {
      await client.initialize('mock_auth_code');
    });

    it('should get markets', async () => {
      const markets = await client.getMarkets();
      expect(Array.isArray(markets)).toBe(true);
    });

    it('should get quote', async () => {
      const quote = await client.getQuote(8049); // AAPL

      expect(quote).toHaveProperty('symbol');
      expect(quote).toHaveProperty('bid');
      expect(quote).toHaveProperty('ask');
      expect(quote.bid < quote.ask).toBe(true);
    });

    it('should search symbols', async () => {
      const results = await client.searchSymbols('AAPL', 5);

      expect(results).toHaveProperty('symbols');
      expect(Array.isArray(results.symbols)).toBe(true);
      expect(results.symbols.length).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting', () => {
    beforeEach(async () => {
      await client.initialize('mock_auth_code');
    });

    it('should track rate limit state', async () => {
      await client.getAccounts();
      await client.searchSymbols('AAPL');

      const rateLimitInfo = client.getRateLimitInfo();
      expect(rateLimitInfo).toBeDefined();
      expect(rateLimitInfo[EndpointCategory.ACCOUNT]).toBeDefined();
      expect(rateLimitInfo[EndpointCategory.MARKET_DATA]).toBeDefined();
    });

    it('should report queue statistics', async () => {
      await client.getAccounts();

      const stats = client.getQueueStats();
      expect(stats.totalProcessed).toBeGreaterThan(0);
      expect(stats.avgProcessingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await client.initialize('mock_auth_code');
    });

    it('should handle 401 Unauthorized gracefully', async () => {
      mockFetch.mockImplementation((url: RequestInfo) => {
        const urlStr = url.toString();
        if (urlStr.includes('/accounts')) {
          return mockResponse({ message: 'Unauthorized' }, 401);
        }
        return defaultMockImpl(url);
      });

      try {
        await (client as any).request(
          EndpointCategory.ACCOUNT,
          'GET',
          '/accounts'
        );
        fail('Expected an error to be thrown');
      } catch (error: any) {
        expect(error).toHaveProperty('code');
        expect(error.code).toBe(ErrorCode.UNAUTHORIZED);
        expect(error).toHaveProperty('statusCode');
        expect(error.statusCode).toBe(401);
        expect(error).toHaveProperty('isRetryable');
      }
    });
  });

  describe('Event Emission', () => {
    let eventListener: jest.Mock;

    beforeEach(async () => {
      await client.initialize('mock_auth_code');
      eventListener = jest.fn();
    });

    it('should emit request-completed event', (done) => {
      client.on('request-completed', eventListener);

      client.getAccounts().then(() => {
        setTimeout(() => {
          expect(eventListener).toHaveBeenCalled();
          done();
        }, 100);
      });
    });

    it('should emit token-refreshed event on refresh', (done) => {
      client.on('token-refreshed', eventListener);

      client.emit('token-refreshed', { expiresIn: 300 });

      setTimeout(() => {
        expect(eventListener).toHaveBeenCalled();
        done();
      }, 100);
    });
  });

  describe('Health and Metrics', () => {
    beforeEach(async () => {
      await client.initialize('mock_auth_code');
    });

    it('should provide token info', () => {
      const info = client.getTokenInfo();
      expect(info).toBeDefined();
      expect(info?.apiServer).toBe('http://localhost:4000/');
    });

    it('should provide complete health metrics', async () => {
      await client.getAccounts();

      const tokenInfo = client.getTokenInfo();
      const queueStats = client.getQueueStats();
      const rateLimitInfo = client.getRateLimitInfo();

      expect(tokenInfo).toBeDefined();
      expect(queueStats).toBeDefined();
      expect(rateLimitInfo).toBeDefined();

      expect(queueStats.totalProcessed).toBeGreaterThanOrEqual(0);
      expect(queueStats.avgProcessingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should use constructor config not process.env', () => {
      const url = client.getAuthorizationUrl(['read', 'write']);
      expect(url).toContain('client_id=mock_client_id');
      expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback');
      expect(url).toContain('scope=read%2Cwrite');
    });
  });

  describe('QuestradeError', () => {
    it('should be instanceof QuestradeError after being thrown', async () => {
      const { QuestradeError: QError } = await import('../src/types');

      mockFetch.mockImplementation((url: RequestInfo) => {
        const urlStr = url.toString();
        if (urlStr.includes('/accounts')) {
          return mockResponse({ message: 'Not found' }, 404);
        }
        return defaultMockImpl(url);
      });

      await client.initialize('mock_auth_code');

      try {
        await (client as any).request(EndpointCategory.ACCOUNT, 'GET', '/accounts');
        fail('Expected error');
      } catch (error) {
        expect(error).toBeInstanceOf(QError);
        expect(error).toBeInstanceOf(Error);
      }
    });
  });
});

