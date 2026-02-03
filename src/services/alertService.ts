import { eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { priceAlerts, type PriceAlert, type NewPriceAlert } from '../db/schema.js';
import { getPrice } from './priceService.js';
import type { CryptoPrice, PriceAlert as PriceAlertType } from '../types/index.js';

// Event emitter for alert notifications
type AlertCallback = (alert: PriceAlertType, price: CryptoPrice) => void;
const alertCallbacks: AlertCallback[] = [];

export function onAlertTriggered(callback: AlertCallback): void {
  alertCallbacks.push(callback);
}

function notifyAlertTriggered(alert: PriceAlertType, price: CryptoPrice): void {
  for (const callback of alertCallbacks) {
    try {
      callback(alert, price);
    } catch (error) {
      console.error('Alert callback error:', error);
    }
  }
}

// Convert DB alert to API type
function toApiAlert(dbAlert: PriceAlert): PriceAlertType {
  return {
    id: dbAlert.id,
    userId: dbAlert.userId,
    symbol: dbAlert.symbol,
    condition: dbAlert.condition as 'above' | 'below' | 'percent_change',
    targetPrice: Number(dbAlert.targetPrice),
    percentChange: dbAlert.percentChange ? Number(dbAlert.percentChange) : undefined,
    isTriggered: dbAlert.isTriggered,
    isActive: dbAlert.isActive,
    createdAt: dbAlert.createdAt.toISOString(),
    triggeredAt: dbAlert.triggeredAt?.toISOString() ?? null,
  };
}

// Create a new alert
export async function createAlert(
  userId: string,
  symbol: string,
  condition: 'above' | 'below' | 'percent_change',
  targetPrice?: number,
  percentChange?: number
): Promise<PriceAlertType> {
  // Get current price for base price (for percent change alerts)
  const currentPrice = await getPrice(symbol);
  const basePrice = currentPrice?.price;

  const newAlert: NewPriceAlert = {
    userId,
    symbol: symbol.toUpperCase(),
    condition,
    targetPrice: targetPrice?.toString() ?? null,
    percentChange: percentChange?.toString() ?? null,
    basePrice: basePrice?.toString() ?? null,
    isTriggered: false,
    isActive: true,
  };

  const [created] = await db.insert(priceAlerts).values(newAlert).returning();

  if (!created) {
    throw new Error('Failed to create alert');
  }

  return toApiAlert(created);
}

// Get alerts for a user
export async function getUserAlerts(userId: string): Promise<PriceAlertType[]> {
  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(eq(priceAlerts.userId, userId))
    .orderBy(priceAlerts.createdAt);

  return alerts.map(toApiAlert);
}

// Get active alerts for a user
export async function getActiveAlerts(userId: string): Promise<PriceAlertType[]> {
  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.userId, userId),
      eq(priceAlerts.isActive, true),
      eq(priceAlerts.isTriggered, false)
    ))
    .orderBy(priceAlerts.createdAt);

  return alerts.map(toApiAlert);
}

// Get alert by ID
export async function getAlert(alertId: string, userId: string): Promise<PriceAlertType | null> {
  const [alert] = await db
    .select()
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.id, alertId),
      eq(priceAlerts.userId, userId)
    ))
    .limit(1);

  return alert ? toApiAlert(alert) : null;
}

// Delete an alert
export async function deleteAlert(alertId: string, userId: string): Promise<boolean> {
  const result = await db
    .delete(priceAlerts)
    .where(and(
      eq(priceAlerts.id, alertId),
      eq(priceAlerts.userId, userId)
    ))
    .returning({ id: priceAlerts.id });

  return result.length > 0;
}

// Deactivate an alert
export async function deactivateAlert(alertId: string, userId: string): Promise<PriceAlertType | null> {
  const [updated] = await db
    .update(priceAlerts)
    .set({ isActive: false })
    .where(and(
      eq(priceAlerts.id, alertId),
      eq(priceAlerts.userId, userId)
    ))
    .returning();

  return updated ? toApiAlert(updated) : null;
}

// Check and trigger alerts for a price update
export async function checkAlertsForPrice(price: CryptoPrice): Promise<PriceAlertType[]> {
  // Get all active alerts for this symbol
  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.symbol, price.symbol),
      eq(priceAlerts.isActive, true),
      eq(priceAlerts.isTriggered, false)
    ));

  const triggeredAlerts: PriceAlertType[] = [];
  const alertIdsToTrigger: string[] = [];

  for (const alert of alerts) {
    let shouldTrigger = false;

    switch (alert.condition) {
      case 'above':
        if (alert.targetPrice && price.price >= Number(alert.targetPrice)) {
          shouldTrigger = true;
        }
        break;

      case 'below':
        if (alert.targetPrice && price.price <= Number(alert.targetPrice)) {
          shouldTrigger = true;
        }
        break;

      case 'percent_change':
        if (alert.basePrice && alert.percentChange) {
          const basePrice = Number(alert.basePrice);
          const targetPercent = Number(alert.percentChange);
          const actualPercent = ((price.price - basePrice) / basePrice) * 100;

          if (targetPercent > 0 && actualPercent >= targetPercent) {
            shouldTrigger = true;
          } else if (targetPercent < 0 && actualPercent <= targetPercent) {
            shouldTrigger = true;
          }
        }
        break;
    }

    if (shouldTrigger) {
      alertIdsToTrigger.push(alert.id);
      triggeredAlerts.push(toApiAlert(alert));
    }
  }

  // Batch update triggered alerts
  if (alertIdsToTrigger.length > 0) {
    await db
      .update(priceAlerts)
      .set({
        isTriggered: true,
        triggeredAt: new Date(),
      })
      .where(inArray(priceAlerts.id, alertIdsToTrigger));

    // Notify listeners
    for (const alert of triggeredAlerts) {
      notifyAlertTriggered(alert, price);
    }
  }

  return triggeredAlerts;
}

// Check all alerts (for background job)
export async function checkAllAlerts(prices: CryptoPrice[]): Promise<PriceAlertType[]> {
  const allTriggered: PriceAlertType[] = [];

  for (const price of prices) {
    const triggered = await checkAlertsForPrice(price);
    allTriggered.push(...triggered);
  }

  return allTriggered;
}

// Get alerts by symbol (for WebSocket notifications)
export async function getActiveAlertsBySymbol(symbol: string): Promise<PriceAlertType[]> {
  const alerts = await db
    .select()
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.symbol, symbol.toUpperCase()),
      eq(priceAlerts.isActive, true),
      eq(priceAlerts.isTriggered, false)
    ));

  return alerts.map(toApiAlert);
}

// Get count of active alerts for a user
export async function getAlertCount(userId: string): Promise<number> {
  const alerts = await db
    .select({ id: priceAlerts.id })
    .from(priceAlerts)
    .where(and(
      eq(priceAlerts.userId, userId),
      eq(priceAlerts.isActive, true)
    ));

  return alerts.length;
}

// Maximum alerts per user by tier
const MAX_ALERTS_BY_TIER: Record<string, number> = {
  free: 5,
  pro: 50,
  enterprise: 500,
};

export function getMaxAlerts(tier: string): number {
  return MAX_ALERTS_BY_TIER[tier] ?? MAX_ALERTS_BY_TIER['free'] ?? 5;
}
