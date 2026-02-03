import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getPriceHandler,
  getPricesHandler,
  getPriceHistoryHandler,
  getSupportedSymbolsHandler,
} from '../controllers/priceController.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';
import { optionalAuthMiddleware } from '../middleware/auth.js';

export async function pricesRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Apply optional auth and rate limiting to all routes
  fastify.addHook('preHandler', optionalAuthMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  // GET /prices - Get all prices or filter by symbols
  fastify.get('/', {
    schema: {
      description: 'Get cryptocurrency prices. Optionally filter by symbols.',
      tags: ['prices'],
      querystring: {
        type: 'object',
        properties: {
          symbols: {
            type: 'string',
            description: 'Comma-separated list of symbols (e.g., BTC,ETH,SOL)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  symbol: { type: 'string' },
                  price: { type: 'number' },
                  change24h: { type: 'number' },
                  changePercent24h: { type: 'number' },
                  volume24h: { type: 'number' },
                  marketCap: { type: 'number' },
                  lastUpdated: { type: 'string' },
                },
              },
            },
            meta: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, getPricesHandler);

  // GET /prices/symbols - Get list of supported symbols
  fastify.get('/symbols', {
    schema: {
      description: 'Get list of supported cryptocurrency symbols',
      tags: ['prices'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'array',
              items: { type: 'string' },
            },
            meta: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, getSupportedSymbolsHandler);

  // GET /prices/:symbol - Get single price
  fastify.get<{ Params: { symbol: string } }>('/:symbol', {
    schema: {
      description: 'Get price for a specific cryptocurrency',
      tags: ['prices'],
      params: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol (e.g., BTC, ETH)',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                price: { type: 'number' },
                change24h: { type: 'number' },
                changePercent24h: { type: 'number' },
                volume24h: { type: 'number' },
                marketCap: { type: 'number' },
                lastUpdated: { type: 'string' },
              },
            },
            meta: {
              type: 'object',
              properties: {
                timestamp: { type: 'string' },
              },
            },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
                details: { type: 'object' },
              },
            },
          },
        },
      },
    },
  }, getPriceHandler);

  // GET /prices/:symbol/history - Get price history
  fastify.get<{
    Params: { symbol: string };
    Querystring: { days?: string };
  }>('/:symbol/history', {
    schema: {
      description: 'Get historical price data for a cryptocurrency',
      tags: ['prices'],
      params: {
        type: 'object',
        required: ['symbol'],
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol (e.g., BTC, ETH)',
          },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          days: {
            type: 'string',
            description: 'Number of days of history (1-365, default: 7)',
            default: '7',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                symbol: { type: 'string' },
                prices: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      timestamp: { type: 'string' },
                      price: { type: 'number' },
                    },
                  },
                },
              },
            },
            meta: {
              type: 'object',
              properties: {
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, getPriceHistoryHandler);
}

export default pricesRoutes;
