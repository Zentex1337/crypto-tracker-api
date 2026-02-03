import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getHoldingsHandler,
  getHoldingHandler,
  getPortfolioSummaryHandler,
  createHoldingHandler,
  updateHoldingHandler,
  deleteHoldingHandler,
} from '../controllers/portfolioController.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware } from '../middleware/rateLimit.js';

export async function portfolioRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Apply authentication and rate limiting to all routes
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  // GET /portfolio - Get portfolio summary with current values
  fastify.get('/summary', {
    schema: {
      description: 'Get portfolio summary with current values and profit/loss',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                totalValue: { type: 'number' },
                totalCost: { type: 'number' },
                totalProfitLoss: { type: 'number' },
                totalProfitLossPercent: { type: 'number' },
                holdings: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      symbol: { type: 'string' },
                      amount: { type: 'number' },
                      currentPrice: { type: 'number' },
                      currentValue: { type: 'number' },
                      averageBuyPrice: { type: 'number' },
                      costBasis: { type: 'number' },
                      profitLoss: { type: 'number' },
                      profitLossPercent: { type: 'number' },
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
  }, getPortfolioSummaryHandler);

  // GET /portfolio/holdings - Get all holdings
  fastify.get('/holdings', {
    schema: {
      description: 'Get all portfolio holdings',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
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
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  symbol: { type: 'string' },
                  amount: { type: 'number' },
                  averageBuyPrice: { type: 'number' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
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
  }, getHoldingsHandler);

  // GET /portfolio/holdings/:id - Get single holding
  fastify.get<{ Params: { id: string } }>('/holdings/:id', {
    schema: {
      description: 'Get a specific portfolio holding',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Holding ID',
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
                id: { type: 'string' },
                userId: { type: 'string' },
                symbol: { type: 'string' },
                amount: { type: 'number' },
                averageBuyPrice: { type: 'number' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
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
              },
            },
          },
        },
      },
    },
  }, getHoldingHandler);

  // POST /portfolio/holdings - Create holding
  fastify.post('/holdings', {
    schema: {
      description: 'Add a new holding to portfolio (or update existing)',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['symbol', 'amount', 'buyPrice'],
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol (e.g., BTC, ETH)',
          },
          amount: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            description: 'Amount of cryptocurrency',
          },
          buyPrice: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            description: 'Purchase price per unit',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                userId: { type: 'string' },
                symbol: { type: 'string' },
                amount: { type: 'number' },
                averageBuyPrice: { type: 'number' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
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
  }, createHoldingHandler);

  // PATCH /portfolio/holdings/:id - Update holding
  fastify.patch<{
    Params: { id: string };
    Body: { amount?: number; averageBuyPrice?: number };
  }>('/holdings/:id', {
    schema: {
      description: 'Update a portfolio holding',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Holding ID',
          },
        },
      },
      body: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            description: 'New amount',
          },
          averageBuyPrice: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            description: 'New average buy price',
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
                id: { type: 'string' },
                userId: { type: 'string' },
                symbol: { type: 'string' },
                amount: { type: 'number' },
                averageBuyPrice: { type: 'number' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' },
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
              },
            },
          },
        },
      },
    },
  }, updateHoldingHandler);

  // DELETE /portfolio/holdings/:id - Delete holding
  fastify.delete<{ Params: { id: string } }>('/holdings/:id', {
    schema: {
      description: 'Remove a holding from portfolio',
      tags: ['portfolio'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Holding ID',
          },
        },
      },
      response: {
        204: {
          type: 'null',
          description: 'Holding deleted successfully',
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
              },
            },
          },
        },
      },
    },
  }, deleteHoldingHandler);
}

export default portfolioRoutes;
