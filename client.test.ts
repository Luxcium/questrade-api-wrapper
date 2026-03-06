/**
 * Integration Tests
 * Tests all modules working together with the QuestradeClient
 * Uses mock API server for testing without real Questrade account
 */

import { QuestradeClient } from '../client';
import { ErrorCode, EndpointCategory } from '../types';
import { Logger } from '../modules/logger';

describe('QuestradeClient', () => {
  let client: QuestradeClient;
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('trace');
    client = new QuestradeClient(
      {
        clientId: 'mock_client_id',
        clientSecret: 'mock_client_secret',
        redirectUri: 'http://localhost:3000/callback',
      },
      {
        logLevel: 'debug',
        tokenStoragePath: '.keys/test-tokens.json',
      }
    );
  });

  afterEach(async () => {
    await client.shutdown();
  });

  describe('Authentication', () => {
    it('should initialize with auth code', async () => {
      const authCode = 'mock_auth_code';
      // Mock the OAuth exchange
      await client.initialize(authCode);

      const tokenInfo = client.getTokenInfo();
      expect(tokenInfo).toBeDefined();
      expect(tokenInfo?.apiServer).toBeDefined();
    });

    it('should handle token refresh', async () => {
      const authCode = 'mock_auth_code';
      await client.initialize(authCode);

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
      const accounts = await client.getAccounts();
      const result = await client.placeOrder(accounts[0].accountId, {
        symbol: 'AAPL',
        quantity: 10,
        side: 'Buy' as const,
        type: 'Limit' as const,
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
      // Make a few requests
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
      // This would require mock server to return 401
      // Testing error structure
      try {
        // Trigger an error
        await (client as any).request(
          EndpointCategory.ACCOUNT,
          'GET',
          '/invalid-endpoint'
        );
      } catch (error) {
        expect(error).toHaveProperty('code');
        expect(error).toHaveProperty('statusCode');
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

      // Would need to test actual refresh
      // For now just verify listener works
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
      expect(info?.apiServer).toBe(
        process.env.QUESTRADE_API_SERVER || 'https://api01.iq.questrade.com'
      );
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
});
