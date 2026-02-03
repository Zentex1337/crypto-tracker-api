import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { portfolioHoldings, type PortfolioHolding as DbPortfolioHolding } from '../../db/schema.js';
import { getPrices } from '../../services/priceService.js';
import type { ApiResponse, PortfolioHolding, PortfolioSummary, CreateHolding, UpdateHolding } from '../../types/index.js';

// Request schemas
const CreateHoldingSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  amount: z.number().positive(),
  buyPrice: z.number().positive(),
});

const UpdateHoldingSchema = z.object({
  amount: z.number().positive().optional(),
  averageBuyPrice: z.number().positive().optional(),
}).refine((data) => data.amount !== undefined || data.averageBuyPrice !== undefined, {
  message: 'At least one of amount or averageBuyPrice must be provided',
});

const HoldingIdParamsSchema = z.object({
  id: z.string().uuid(),
});

// Convert DB holding to API type
function toApiHolding(dbHolding: DbPortfolioHolding): PortfolioHolding {
  return {
    id: dbHolding.id,
    userId: dbHolding.userId,
    symbol: dbHolding.symbol,
    amount: Number(dbHolding.amount),
    averageBuyPrice: Number(dbHolding.averageBuyPrice),
    createdAt: dbHolding.createdAt.toISOString(),
    updatedAt: dbHolding.updatedAt.toISOString(),
  };
}

// Get all holdings for a user
export async function getHoldingsHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

    const holdings = await db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId))
      .orderBy(portfolioHoldings.symbol);

    return reply.send({
      success: true,
      data: holdings.map(toApiHolding),
      meta: {
        total: holdings.length,
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PortfolioHolding[]>);
  } catch (error) {
    request.log.error(error, 'Error fetching holdings');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch holdings',
      },
    } satisfies ApiResponse<never>);
  }
}

// Get portfolio summary with current values
export async function getPortfolioSummaryHandler(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
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

    const holdings = await db
      .select()
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId));

    if (holdings.length === 0) {
      return reply.send({
        success: true,
        data: {
          totalValue: 0,
          totalCost: 0,
          totalProfitLoss: 0,
          totalProfitLossPercent: 0,
          holdings: [],
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PortfolioSummary>);
    }

    // Get current prices for all held symbols
    const symbols = holdings.map((h) => h.symbol);
    const prices = await getPrices(symbols);
    const priceMap = new Map(prices.map((p) => [p.symbol, p]));

    let totalValue = 0;
    let totalCost = 0;

    const holdingsSummary = holdings.map((holding) => {
      const amount = Number(holding.amount);
      const avgBuyPrice = Number(holding.averageBuyPrice);
      const currentPrice = priceMap.get(holding.symbol)?.price ?? avgBuyPrice;

      const currentValue = amount * currentPrice;
      const costBasis = amount * avgBuyPrice;
      const profitLoss = currentValue - costBasis;
      const profitLossPercent = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

      totalValue += currentValue;
      totalCost += costBasis;

      return {
        symbol: holding.symbol,
        amount,
        currentPrice,
        currentValue,
        averageBuyPrice: avgBuyPrice,
        costBasis,
        profitLoss,
        profitLossPercent,
      };
    });

    const totalProfitLoss = totalValue - totalCost;
    const totalProfitLossPercent = totalCost > 0 ? (totalProfitLoss / totalCost) * 100 : 0;

    return reply.send({
      success: true,
      data: {
        totalValue,
        totalCost,
        totalProfitLoss,
        totalProfitLossPercent,
        holdings: holdingsSummary,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PortfolioSummary>);
  } catch (error) {
    request.log.error(error, 'Error fetching portfolio summary');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch portfolio summary',
      },
    } satisfies ApiResponse<never>);
  }
}

// Create a new holding
export async function createHoldingHandler(
  request: FastifyRequest<{ Body: CreateHolding }>,
  reply: FastifyReply
): Promise<void> {
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

    const body = CreateHoldingSchema.parse(request.body);

    // Check if holding already exists
    const existing = await db
      .select()
      .from(portfolioHoldings)
      .where(and(
        eq(portfolioHoldings.userId, userId),
        eq(portfolioHoldings.symbol, body.symbol)
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing holding with weighted average
      const existingHolding = existing[0]!;
      const existingAmount = Number(existingHolding.amount);
      const existingAvgPrice = Number(existingHolding.averageBuyPrice);

      const totalAmount = existingAmount + body.amount;
      const newAvgPrice = ((existingAmount * existingAvgPrice) + (body.amount * body.buyPrice)) / totalAmount;

      const [updated] = await db
        .update(portfolioHoldings)
        .set({
          amount: totalAmount.toString(),
          averageBuyPrice: newAvgPrice.toString(),
          updatedAt: new Date(),
        })
        .where(eq(portfolioHoldings.id, existingHolding.id))
        .returning();

      return reply.status(200).send({
        success: true,
        data: toApiHolding(updated!),
        meta: {
          timestamp: new Date().toISOString(),
        },
      } satisfies ApiResponse<PortfolioHolding>);
    }

    // Create new holding
    const [created] = await db
      .insert(portfolioHoldings)
      .values({
        userId,
        symbol: body.symbol,
        amount: body.amount.toString(),
        averageBuyPrice: body.buyPrice.toString(),
      })
      .returning();

    return reply.status(201).send({
      success: true,
      data: toApiHolding(created!),
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PortfolioHolding>);
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

    request.log.error(error, 'Error creating holding');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create holding',
      },
    } satisfies ApiResponse<never>);
  }
}

// Update a holding
export async function updateHoldingHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateHolding }>,
  reply: FastifyReply
): Promise<void> {
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

    const params = HoldingIdParamsSchema.parse(request.params);
    const body = UpdateHoldingSchema.parse(request.body);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (body.amount !== undefined) {
      updateData['amount'] = body.amount.toString();
    }

    if (body.averageBuyPrice !== undefined) {
      updateData['averageBuyPrice'] = body.averageBuyPrice.toString();
    }

    const [updated] = await db
      .update(portfolioHoldings)
      .set(updateData)
      .where(and(
        eq(portfolioHoldings.id, params.id),
        eq(portfolioHoldings.userId, userId)
      ))
      .returning();

    if (!updated) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Holding not found',
        },
      } satisfies ApiResponse<never>);
    }

    return reply.send({
      success: true,
      data: toApiHolding(updated),
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PortfolioHolding>);
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

    request.log.error(error, 'Error updating holding');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update holding',
      },
    } satisfies ApiResponse<never>);
  }
}

// Delete a holding
export async function deleteHoldingHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
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

    const params = HoldingIdParamsSchema.parse(request.params);

    const [deleted] = await db
      .delete(portfolioHoldings)
      .where(and(
        eq(portfolioHoldings.id, params.id),
        eq(portfolioHoldings.userId, userId)
      ))
      .returning({ id: portfolioHoldings.id });

    if (!deleted) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Holding not found',
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

    request.log.error(error, 'Error deleting holding');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to delete holding',
      },
    } satisfies ApiResponse<never>);
  }
}

// Get a single holding
export async function getHoldingHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
): Promise<void> {
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

    const params = HoldingIdParamsSchema.parse(request.params);

    const [holding] = await db
      .select()
      .from(portfolioHoldings)
      .where(and(
        eq(portfolioHoldings.id, params.id),
        eq(portfolioHoldings.userId, userId)
      ))
      .limit(1);

    if (!holding) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Holding not found',
        },
      } satisfies ApiResponse<never>);
    }

    return reply.send({
      success: true,
      data: toApiHolding(holding),
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PortfolioHolding>);
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

    request.log.error(error, 'Error fetching holding');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch holding',
      },
    } satisfies ApiResponse<never>);
  }
}
