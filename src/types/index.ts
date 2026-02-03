import { z } from 'zod';

// Price Types
export const CryptoPriceSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  price: z.number().positive(),
  change24h: z.number(),
  changePercent24h: z.number(),
  volume24h: z.number().nonnegative(),
  marketCap: z.number().nonnegative(),
  lastUpdated: z.string().datetime(),
});

export type CryptoPrice = z.infer<typeof CryptoPriceSchema>;

export const PriceHistorySchema = z.object({
  symbol: z.string(),
  prices: z.array(z.object({
    timestamp: z.string().datetime(),
    price: z.number().positive(),
  })),
});

export type PriceHistory = z.infer<typeof PriceHistorySchema>;

// Portfolio Types
export const PortfolioHoldingSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  symbol: z.string().min(1).max(10).toUpperCase(),
  amount: z.number().positive(),
  averageBuyPrice: z.number().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PortfolioHolding = z.infer<typeof PortfolioHoldingSchema>;

export const CreateHoldingSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  amount: z.number().positive(),
  buyPrice: z.number().positive(),
});

export type CreateHolding = z.infer<typeof CreateHoldingSchema>;

export const UpdateHoldingSchema = z.object({
  amount: z.number().positive().optional(),
  averageBuyPrice: z.number().positive().optional(),
});

export type UpdateHolding = z.infer<typeof UpdateHoldingSchema>;

export const PortfolioSummarySchema = z.object({
  totalValue: z.number(),
  totalCost: z.number(),
  totalProfitLoss: z.number(),
  totalProfitLossPercent: z.number(),
  holdings: z.array(z.object({
    symbol: z.string(),
    amount: z.number(),
    currentPrice: z.number(),
    currentValue: z.number(),
    averageBuyPrice: z.number(),
    costBasis: z.number(),
    profitLoss: z.number(),
    profitLossPercent: z.number(),
  })),
});

export type PortfolioSummary = z.infer<typeof PortfolioSummarySchema>;

// Alert Types
export const AlertConditionSchema = z.enum(['above', 'below', 'percent_change']);

export type AlertCondition = z.infer<typeof AlertConditionSchema>;

export const PriceAlertSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  symbol: z.string().min(1).max(10).toUpperCase(),
  condition: AlertConditionSchema,
  targetPrice: z.number().positive(),
  percentChange: z.number().optional(),
  isTriggered: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  triggeredAt: z.string().datetime().nullable(),
});

export type PriceAlert = z.infer<typeof PriceAlertSchema>;

export const CreateAlertSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  condition: AlertConditionSchema,
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

export type CreateAlert = z.infer<typeof CreateAlertSchema>;

// WebSocket Types
export const WSMessageTypeSchema = z.enum([
  'subscribe',
  'unsubscribe',
  'price_update',
  'alert_triggered',
  'error',
  'subscribed',
  'unsubscribed',
]);

export type WSMessageType = z.infer<typeof WSMessageTypeSchema>;

export const WSSubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  symbols: z.array(z.string().min(1).max(10).toUpperCase()),
});

export const WSUnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  symbols: z.array(z.string().min(1).max(10).toUpperCase()),
});

export const WSPriceUpdateMessageSchema = z.object({
  type: z.literal('price_update'),
  data: CryptoPriceSchema,
});

export const WSAlertTriggeredMessageSchema = z.object({
  type: z.literal('alert_triggered'),
  data: PriceAlertSchema,
});

export const WSErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

export const WSClientMessageSchema = z.discriminatedUnion('type', [
  WSSubscribeMessageSchema,
  WSUnsubscribeMessageSchema,
]);

export type WSClientMessage = z.infer<typeof WSClientMessageSchema>;

export const WSServerMessageSchema = z.discriminatedUnion('type', [
  WSPriceUpdateMessageSchema,
  WSAlertTriggeredMessageSchema,
  WSErrorMessageSchema,
  z.object({ type: z.literal('subscribed'), symbols: z.array(z.string()) }),
  z.object({ type: z.literal('unsubscribed'), symbols: z.array(z.string()) }),
]);

export type WSServerMessage = z.infer<typeof WSServerMessageSchema>;

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    timestamp: string;
  };
}

export interface PaginationParams {
  page?: number;
  limit?: number;
}

// Rate Limit Types
export interface RateLimitInfo {
  remaining: number;
  reset: number;
  limit: number;
}

// Auth Types
export interface AuthenticatedUser {
  id: string;
  apiKey: string;
  tier: 'free' | 'pro' | 'enterprise';
  rateLimit: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    rateLimitInfo?: RateLimitInfo;
  }
}
