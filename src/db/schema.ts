import {
  pgTable,
  uuid,
  varchar,
  decimal,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Users table for API key management
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  apiKey: varchar('api_key', { length: 64 }).unique().notNull(),
  apiKeyHash: varchar('api_key_hash', { length: 128 }).notNull(),
  tier: varchar('tier', { length: 20 }).notNull().default('free'),
  rateLimit: decimal('rate_limit', { precision: 10, scale: 0 }).notNull().default('100'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  apiKeyIdx: uniqueIndex('users_api_key_idx').on(table.apiKey),
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
}));

// Portfolio holdings
export const portfolioHoldings = pgTable('portfolio_holdings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  amount: decimal('amount', { precision: 20, scale: 8 }).notNull(),
  averageBuyPrice: decimal('average_buy_price', { precision: 20, scale: 8 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('portfolio_user_id_idx').on(table.userId),
  symbolIdx: index('portfolio_symbol_idx').on(table.symbol),
  userSymbolIdx: uniqueIndex('portfolio_user_symbol_idx').on(table.userId, table.symbol),
}));

// Price alerts
export const priceAlerts = pgTable('price_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  condition: varchar('condition', { length: 20 }).notNull(), // 'above', 'below', 'percent_change'
  targetPrice: decimal('target_price', { precision: 20, scale: 8 }),
  percentChange: decimal('percent_change', { precision: 10, scale: 4 }),
  basePrice: decimal('base_price', { precision: 20, scale: 8 }), // Price when alert was created
  isTriggered: boolean('is_triggered').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  triggeredAt: timestamp('triggered_at', { withTimezone: true }),
}, (table) => ({
  userIdIdx: index('alerts_user_id_idx').on(table.userId),
  symbolIdx: index('alerts_symbol_idx').on(table.symbol),
  activeIdx: index('alerts_active_idx').on(table.isActive),
}));

// Price history (for sparklines and charts)
export const priceHistory = pgTable('price_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  price: decimal('price', { precision: 20, scale: 8 }).notNull(),
  volume: decimal('volume', { precision: 30, scale: 2 }),
  marketCap: decimal('market_cap', { precision: 30, scale: 2 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  symbolIdx: index('price_history_symbol_idx').on(table.symbol),
  timestampIdx: index('price_history_timestamp_idx').on(table.timestamp),
  symbolTimestampIdx: index('price_history_symbol_timestamp_idx').on(table.symbol, table.timestamp),
}));

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  portfolioHoldings: many(portfolioHoldings),
  priceAlerts: many(priceAlerts),
}));

export const portfolioHoldingsRelations = relations(portfolioHoldings, ({ one }) => ({
  user: one(users, {
    fields: [portfolioHoldings.userId],
    references: [users.id],
  }),
}));

export const priceAlertsRelations = relations(priceAlerts, ({ one }) => ({
  user: one(users, {
    fields: [priceAlerts.userId],
    references: [users.id],
  }),
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type PortfolioHolding = typeof portfolioHoldings.$inferSelect;
export type NewPortfolioHolding = typeof portfolioHoldings.$inferInsert;
export type PriceAlert = typeof priceAlerts.$inferSelect;
export type NewPriceAlert = typeof priceAlerts.$inferInsert;
export type PriceHistoryRecord = typeof priceHistory.$inferSelect;
export type NewPriceHistoryRecord = typeof priceHistory.$inferInsert;
