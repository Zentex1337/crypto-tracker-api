import Redis from 'ioredis';
import { env } from '../config/env.js';
import type { CryptoPrice, PriceHistory } from '../types/index.js';

let redis: Redis | null = null;

// Initialize Redis connection
export function initializePriceServiceRedis(redisInstance: Redis): void {
  redis = redisInstance;
}

// Supported cryptocurrencies (CoinGecko IDs mapped to symbols)
const CRYPTO_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  DOT: 'polkadot',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  LINK: 'chainlink',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  NEAR: 'near',
};

const SYMBOL_TO_ID = new Map(Object.entries(CRYPTO_MAP));
const ID_TO_SYMBOL = new Map(Object.entries(CRYPTO_MAP).map(([k, v]) => [v, k]));

// Cache keys
const PRICE_CACHE_KEY = 'prices:current';
const PRICE_SINGLE_PREFIX = 'price:';

// Fetch prices from CoinGecko API
async function fetchPricesFromAPI(coinIds: string[]): Promise<Map<string, CryptoPrice>> {
  const prices = new Map<string, CryptoPrice>();

  if (coinIds.length === 0) {
    return prices;
  }

  try {
    const ids = coinIds.join(',');
    const url = `${env.COINGECKO_API_URL}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_vol=true&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`;

    const headers: HeadersInit = {
      'Accept': 'application/json',
    };

    if (env.COINGECKO_API_KEY) {
      headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as Record<string, {
      usd: number;
      usd_24h_vol: number;
      usd_24h_change: number;
      usd_market_cap: number;
      last_updated_at: number;
    }>;

    for (const [coinId, priceData] of Object.entries(data)) {
      const symbol = ID_TO_SYMBOL.get(coinId);
      if (symbol && priceData) {
        prices.set(symbol, {
          symbol,
          price: priceData.usd,
          change24h: priceData.usd * (priceData.usd_24h_change / 100),
          changePercent24h: priceData.usd_24h_change,
          volume24h: priceData.usd_24h_vol,
          marketCap: priceData.usd_market_cap,
          lastUpdated: new Date(priceData.last_updated_at * 1000).toISOString(),
        });
      }
    }
  } catch (error) {
    console.error('Error fetching prices from CoinGecko:', error);
    throw error;
  }

  return prices;
}

// Get single price with caching
export async function getPrice(symbol: string): Promise<CryptoPrice | null> {
  const upperSymbol = symbol.toUpperCase();
  const coinId = SYMBOL_TO_ID.get(upperSymbol);

  if (!coinId) {
    return null;
  }

  // Check cache first
  if (redis) {
    try {
      const cached = await redis.get(`${PRICE_SINGLE_PREFIX}${upperSymbol}`);
      if (cached) {
        return JSON.parse(cached) as CryptoPrice;
      }
    } catch (error) {
      console.error('Redis cache read error:', error);
    }
  }

  // Fetch from API
  const prices = await fetchPricesFromAPI([coinId]);
  const price = prices.get(upperSymbol);

  if (price && redis) {
    try {
      await redis.setex(
        `${PRICE_SINGLE_PREFIX}${upperSymbol}`,
        env.PRICE_CACHE_TTL_SECONDS,
        JSON.stringify(price)
      );
    } catch (error) {
      console.error('Redis cache write error:', error);
    }
  }

  return price || null;
}

// Get all prices with caching
export async function getAllPrices(): Promise<CryptoPrice[]> {
  // Check cache first
  if (redis) {
    try {
      const cached = await redis.get(PRICE_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as CryptoPrice[];
      }
    } catch (error) {
      console.error('Redis cache read error:', error);
    }
  }

  // Fetch from API
  const coinIds = Array.from(SYMBOL_TO_ID.values());
  const pricesMap = await fetchPricesFromAPI(coinIds);
  const prices = Array.from(pricesMap.values());

  // Cache results
  if (redis && prices.length > 0) {
    try {
      await redis.setex(
        PRICE_CACHE_KEY,
        env.PRICE_CACHE_TTL_SECONDS,
        JSON.stringify(prices)
      );

      // Also cache individual prices
      const pipeline = redis.pipeline();
      for (const price of prices) {
        pipeline.setex(
          `${PRICE_SINGLE_PREFIX}${price.symbol}`,
          env.PRICE_CACHE_TTL_SECONDS,
          JSON.stringify(price)
        );
      }
      await pipeline.exec();
    } catch (error) {
      console.error('Redis cache write error:', error);
    }
  }

  return prices;
}

// Get multiple specific prices
export async function getPrices(symbols: string[]): Promise<CryptoPrice[]> {
  const upperSymbols = symbols.map((s) => s.toUpperCase());
  const validSymbols = upperSymbols.filter((s) => SYMBOL_TO_ID.has(s));

  if (validSymbols.length === 0) {
    return [];
  }

  const results: CryptoPrice[] = [];
  const missingSymbols: string[] = [];

  // Check cache for each symbol
  if (redis) {
    try {
      const pipeline = redis.pipeline();
      for (const symbol of validSymbols) {
        pipeline.get(`${PRICE_SINGLE_PREFIX}${symbol}`);
      }
      const cachedResults = await pipeline.exec();

      if (cachedResults) {
        for (let i = 0; i < validSymbols.length; i++) {
          const result = cachedResults[i];
          const symbol = validSymbols[i];
          if (result && result[1]) {
            results.push(JSON.parse(result[1] as string) as CryptoPrice);
          } else if (symbol) {
            missingSymbols.push(symbol);
          }
        }
      }
    } catch (error) {
      console.error('Redis cache read error:', error);
      missingSymbols.push(...validSymbols);
    }
  } else {
    missingSymbols.push(...validSymbols);
  }

  // Fetch missing prices from API
  if (missingSymbols.length > 0) {
    const coinIds = missingSymbols
      .map((s) => SYMBOL_TO_ID.get(s))
      .filter((id): id is string => id !== undefined);

    const fetchedPrices = await fetchPricesFromAPI(coinIds);

    // Cache and add to results
    if (redis) {
      const pipeline = redis.pipeline();
      for (const [, price] of fetchedPrices) {
        results.push(price);
        pipeline.setex(
          `${PRICE_SINGLE_PREFIX}${price.symbol}`,
          env.PRICE_CACHE_TTL_SECONDS,
          JSON.stringify(price)
        );
      }
      await pipeline.exec().catch(console.error);
    } else {
      for (const [, price] of fetchedPrices) {
        results.push(price);
      }
    }
  }

  return results;
}

// Get price history (placeholder - would need historical API)
export async function getPriceHistory(
  symbol: string,
  days: number = 7
): Promise<PriceHistory | null> {
  const upperSymbol = symbol.toUpperCase();
  const coinId = SYMBOL_TO_ID.get(upperSymbol);

  if (!coinId) {
    return null;
  }

  try {
    const url = `${env.COINGECKO_API_URL}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;

    const headers: HeadersInit = {
      'Accept': 'application/json',
    };

    if (env.COINGECKO_API_KEY) {
      headers['x-cg-demo-api-key'] = env.COINGECKO_API_KEY;
    }

    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`);
    }

    const data = await response.json() as { prices: [number, number][] };

    return {
      symbol: upperSymbol,
      prices: data.prices.map(([timestamp, price]) => ({
        timestamp: new Date(timestamp).toISOString(),
        price,
      })),
    };
  } catch (error) {
    console.error('Error fetching price history:', error);
    return null;
  }
}

// Check if symbol is supported
export function isSymbolSupported(symbol: string): boolean {
  return SYMBOL_TO_ID.has(symbol.toUpperCase());
}

// Get all supported symbols
export function getSupportedSymbols(): string[] {
  return Array.from(SYMBOL_TO_ID.keys());
}

// Update all prices (for background job)
export async function updateAllPrices(): Promise<CryptoPrice[]> {
  const coinIds = Array.from(SYMBOL_TO_ID.values());
  const pricesMap = await fetchPricesFromAPI(coinIds);
  const prices = Array.from(pricesMap.values());

  // Update cache
  if (redis && prices.length > 0) {
    try {
      const pipeline = redis.pipeline();

      pipeline.setex(
        PRICE_CACHE_KEY,
        env.PRICE_CACHE_TTL_SECONDS,
        JSON.stringify(prices)
      );

      for (const price of prices) {
        pipeline.setex(
          `${PRICE_SINGLE_PREFIX}${price.symbol}`,
          env.PRICE_CACHE_TTL_SECONDS,
          JSON.stringify(price)
        );
      }

      await pipeline.exec();
    } catch (error) {
      console.error('Redis cache update error:', error);
    }
  }

  return prices;
}
