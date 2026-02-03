import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getPrice,
  getAllPrices,
  getPrices,
  getPriceHistory,
  isSymbolSupported,
  getSupportedSymbols,
} from '../../services/priceService.js';
import type { ApiResponse, CryptoPrice, PriceHistory } from '../../types/index.js';

// Request schemas
const GetPriceParamsSchema = z.object({
  symbol: z.string().min(1).max(10),
});

const GetPricesQuerySchema = z.object({
  symbols: z.string().optional(), // comma-separated list
});

const GetPriceHistoryQuerySchema = z.object({
  days: z.string().transform(Number).pipe(z.number().min(1).max(365)).default('7'),
});

// Get single price
export async function getPriceHandler(
  request: FastifyRequest<{ Params: { symbol: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const params = GetPriceParamsSchema.parse(request.params);
    const symbol = params.symbol.toUpperCase();

    if (!isSymbolSupported(symbol)) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'SYMBOL_NOT_FOUND',
          message: `Symbol '${symbol}' is not supported`,
          details: {
            supportedSymbols: getSupportedSymbols(),
          },
        },
      } satisfies ApiResponse<never>);
    }

    const price = await getPrice(symbol);

    if (!price) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'PRICE_UNAVAILABLE',
          message: 'Price data is temporarily unavailable',
        },
      } satisfies ApiResponse<never>);
    }

    return reply.send({
      success: true,
      data: price,
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<CryptoPrice>);
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

    request.log.error(error, 'Error fetching price');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch price data',
      },
    } satisfies ApiResponse<never>);
  }
}

// Get all prices or specific symbols
export async function getPricesHandler(
  request: FastifyRequest<{ Querystring: { symbols?: string } }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const query = GetPricesQuerySchema.parse(request.query);

    let prices: CryptoPrice[];

    if (query.symbols) {
      const symbols = query.symbols.split(',').map((s) => s.trim().toUpperCase());
      const invalidSymbols = symbols.filter((s) => !isSymbolSupported(s));

      if (invalidSymbols.length > 0) {
        return reply.status(400).send({
          success: false,
          error: {
            code: 'INVALID_SYMBOLS',
            message: `Unsupported symbols: ${invalidSymbols.join(', ')}`,
            details: {
              invalidSymbols,
              supportedSymbols: getSupportedSymbols(),
            },
          },
        } satisfies ApiResponse<never>);
      }

      prices = await getPrices(symbols);
    } else {
      prices = await getAllPrices();
    }

    return reply.send({
      success: true,
      data: prices,
      meta: {
        total: prices.length,
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<CryptoPrice[]>);
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

    request.log.error(error, 'Error fetching prices');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch price data',
      },
    } satisfies ApiResponse<never>);
  }
}

// Get price history
export async function getPriceHistoryHandler(
  request: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { days?: string };
  }>,
  reply: FastifyReply
): Promise<void> {
  try {
    const params = GetPriceParamsSchema.parse(request.params);
    const query = GetPriceHistoryQuerySchema.parse(request.query);
    const symbol = params.symbol.toUpperCase();

    if (!isSymbolSupported(symbol)) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'SYMBOL_NOT_FOUND',
          message: `Symbol '${symbol}' is not supported`,
        },
      } satisfies ApiResponse<never>);
    }

    const history = await getPriceHistory(symbol, query.days);

    if (!history) {
      return reply.status(503).send({
        success: false,
        error: {
          code: 'HISTORY_UNAVAILABLE',
          message: 'Price history is temporarily unavailable',
        },
      } satisfies ApiResponse<never>);
    }

    return reply.send({
      success: true,
      data: history,
      meta: {
        timestamp: new Date().toISOString(),
      },
    } satisfies ApiResponse<PriceHistory>);
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

    request.log.error(error, 'Error fetching price history');
    return reply.status(500).send({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch price history',
      },
    } satisfies ApiResponse<never>);
  }
}

// Get supported symbols
export async function getSupportedSymbolsHandler(
  _request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const symbols = getSupportedSymbols();

  return reply.send({
    success: true,
    data: symbols,
    meta: {
      total: symbols.length,
      timestamp: new Date().toISOString(),
    },
  } satisfies ApiResponse<string[]>);
}
