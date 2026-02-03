import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import {
  createAlert,
  getUserAlerts,
  getActiveAlerts,
  getAlert,
  deleteAlert,
  deactivateAlert,
  getAlertCount,
  getMaxAlerts,
} from '../../services/alertService.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitMiddleware, strictRateLimitMiddleware } from '../middleware/rateLimit.js';
import { isSymbolSupported, getSupportedSymbols } from '../../services/priceService.js';
import type { ApiResponse, PriceAlert, CreateAlert } from '../../types/index.js';

// Request schemas
const CreateAlertSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  condition: z.enum(['above', 'below', 'percent_change']),
  targetPrice: z.number().positive().optional(),
  percentChange: z.number().optional(),
}).refine(
  (data) => {
    if (data.condition === 'percent_change') {
      return data.percentChange !== undefined;
    }
    return data.targetPrice !== undefined;
  },
  {
    message: 'targetPrice required for above/below conditions, percentChange required for percent_change',
  }
);

const AlertIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export async function alertsRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Apply authentication and rate limiting to all routes
  fastify.addHook('preHandler', authMiddleware);
  fastify.addHook('preHandler', rateLimitMiddleware);

  // GET /alerts - Get all alerts for user
  fastify.get('/', {
    schema: {
      description: 'Get all price alerts for the authenticated user',
      tags: ['alerts'],
      security: [{ apiKey: [] }],
      querystring: {
        type: 'object',
        properties: {
          active: {
            type: 'boolean',
            description: 'Filter to show only active (non-triggered) alerts',
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
                  id: { type: 'string' },
                  userId: { type: 'string' },
                  symbol: { type: 'string' },
                  condition: { type: 'string' },
                  targetPrice: { type: 'number' },
                  percentChange: { type: 'number' },
                  isTriggered: { type: 'boolean' },
                  isActive: { type: 'boolean' },
                  createdAt: { type: 'string' },
                  triggeredAt: { type: 'string', nullable: true },
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
  }, async (request, reply) => {
    try {
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ApiResponse<never>);
      }

      const query = request.query as { active?: boolean };
      const alerts = query.active
        ? await getActiveAlerts(userId)
        : await getUserAlerts(userId);

      return reply.send({
        success: true,
        data: alerts,
        meta: {
          total: alerts.length,
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PriceAlert[]>);
    } catch (error) {
      request.log.error(error, 'Error fetching alerts');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch alerts',
        },
      } satisfies ApiResponse<never>);
    }
  });

  // GET /alerts/:id - Get single alert
  fastify.get<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Get a specific price alert',
      tags: ['alerts'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Alert ID',
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
                condition: { type: 'string' },
                targetPrice: { type: 'number' },
                percentChange: { type: 'number' },
                isTriggered: { type: 'boolean' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'string' },
                triggeredAt: { type: 'string', nullable: true },
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
  }, async (request, reply) => {
    try {
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ApiResponse<never>);
      }

      const params = AlertIdParamsSchema.parse(request.params);
      const alert = await getAlert(params.id, userId);

      if (!alert) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Alert not found',
          },
        } satisfies ApiResponse<never>);
      }

      return reply.send({
        success: true,
        data: alert,
        meta: {
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PriceAlert>);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        } satisfies ApiResponse<never>);
      }

      request.log.error(error, 'Error fetching alert');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch alert',
        },
      } satisfies ApiResponse<never>);
    }
  });

  // POST /alerts - Create new alert
  fastify.post<{ Body: CreateAlert }>('/', {
    preHandler: strictRateLimitMiddleware,
    schema: {
      description: 'Create a new price alert',
      tags: ['alerts'],
      security: [{ apiKey: [] }],
      body: {
        type: 'object',
        required: ['symbol', 'condition'],
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol (e.g., BTC, ETH)',
          },
          condition: {
            type: 'string',
            enum: ['above', 'below', 'percent_change'],
            description: 'Alert condition',
          },
          targetPrice: {
            type: 'number',
            minimum: 0,
            exclusiveMinimum: true,
            description: 'Target price (required for above/below conditions)',
          },
          percentChange: {
            type: 'number',
            description: 'Percent change threshold (required for percent_change condition)',
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
                condition: { type: 'string' },
                targetPrice: { type: 'number' },
                percentChange: { type: 'number' },
                isTriggered: { type: 'boolean' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'string' },
                triggeredAt: { type: 'string', nullable: true },
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
  }, async (request, reply) => {
    try {
      const userId = request.user?.id;
      const tier = request.user?.tier ?? 'free';

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ApiResponse<never>);
      }

      const body = CreateAlertSchema.parse(request.body);

      // Validate symbol
      if (!isSymbolSupported(body.symbol)) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SYMBOL',
            message: `Symbol '${body.symbol}' is not supported`,
            details: {
              supportedSymbols: getSupportedSymbols(),
            },
          },
        } satisfies ApiResponse<never>);
      }

      // Check alert limit
      const currentCount = await getAlertCount(userId);
      const maxAlerts = getMaxAlerts(tier);

      if (currentCount >= maxAlerts) {
        return reply.status(403).send({
          success: false,
          error: {
            code: 'ALERT_LIMIT_REACHED',
            message: `You have reached the maximum number of alerts (${maxAlerts}) for your tier`,
            details: {
              currentCount,
              maxAlerts,
              tier,
            },
          },
        } satisfies ApiResponse<never>);
      }

      const alert = await createAlert(
        userId,
        body.symbol,
        body.condition,
        body.targetPrice,
        body.percentChange
      );

      return reply.status(201).send({
        success: true,
        data: alert,
        meta: {
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PriceAlert>);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: error.errors,
          },
        } satisfies ApiResponse<never>);
      }

      request.log.error(error, 'Error creating alert');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create alert',
        },
      } satisfies ApiResponse<never>);
    }
  });

  // PATCH /alerts/:id/deactivate - Deactivate alert
  fastify.patch<{ Params: { id: string } }>('/:id/deactivate', {
    schema: {
      description: 'Deactivate a price alert',
      tags: ['alerts'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Alert ID',
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
                condition: { type: 'string' },
                targetPrice: { type: 'number' },
                percentChange: { type: 'number' },
                isTriggered: { type: 'boolean' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'string' },
                triggeredAt: { type: 'string', nullable: true },
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
  }, async (request, reply) => {
    try {
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ApiResponse<never>);
      }

      const params = AlertIdParamsSchema.parse(request.params);
      const alert = await deactivateAlert(params.id, userId);

      if (!alert) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Alert not found',
          },
        } satisfies ApiResponse<never>);
      }

      return reply.send({
        success: true,
        data: alert,
        meta: {
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PriceAlert>);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        } satisfies ApiResponse<never>);
      }

      request.log.error(error, 'Error deactivating alert');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to deactivate alert',
        },
      } satisfies ApiResponse<never>);
    }
  });

  // DELETE /alerts/:id - Delete alert
  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      description: 'Delete a price alert',
      tags: ['alerts'],
      security: [{ apiKey: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            description: 'Alert ID',
          },
        },
      },
      response: {
        204: {
          type: 'null',
          description: 'Alert deleted successfully',
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
  }, async (request, reply) => {
    try {
      const userId = request.user?.id;

      if (!userId) {
        return reply.status(401).send({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
        } satisfies ApiResponse<never>);
      }

      const params = AlertIdParamsSchema.parse(request.params);
      const deleted = await deleteAlert(params.id, userId);

      if (!deleted) {
        return reply.status(404).send({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Alert not found',
          },
        } satisfies ApiResponse<never>);
      }

      return reply.status(204).send();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request parameters',
            details: error.errors,
          },
        } satisfies ApiResponse<never>);
      }

      request.log.error(error, 'Error deleting alert');
      return reply.status(500).send({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to delete alert',
        },
      } satisfies ApiResponse<never>);
    }
  });
}

export default alertsRoutes;
