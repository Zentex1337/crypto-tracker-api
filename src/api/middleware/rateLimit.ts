import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import Redis from 'ioredis';
import { env } from '../../config/env.js';
import type { RateLimitInfo } from '../../types/index.js';

let redis: Redis | null = null;

// Initialize Redis connection
export function initializeRateLimitRedis(redisInstance: Redis): void {
  redis = redisInstance;
}

// Rate limit configuration by tier
const tierLimits: Record<string, { requests: number; windowMs: number }> = {
  free: { requests: 100, windowMs: 60000 },
  pro: { requests: 1000, windowMs: 60000 },
  enterprise: { requests: 10000, windowMs: 60000 },
};

// Sliding window rate limiter using Redis
async function checkRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; reset: number }> {
  if (!redis) {
    // Fallback: allow request if Redis is unavailable
    console.warn('Rate limit Redis not available, allowing request');
    return { allowed: true, remaining: limit, reset: Date.now() + windowMs };
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${identifier}`;

  try {
    // Use Redis transaction for atomic operations
    const pipeline = redis.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);

    // Count requests in current window
    pipeline.zcard(key);

    // Add current request
    pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);

    // Set expiry on the key
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();

    if (!results) {
      return { allowed: true, remaining: limit, reset: now + windowMs };
    }

    // Get count from results (index 1 is the zcard result)
    const countResult = results[1];
    const currentCount = countResult ? (countResult[1] as number) : 0;

    const remaining = Math.max(0, limit - currentCount - 1);
    const reset = now + windowMs;
    const allowed = currentCount < limit;

    // If not allowed, remove the request we just added
    if (!allowed) {
      await redis.zremrangebyscore(key, now, now);
    }

    return { allowed, remaining, reset };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // Fail open on errors
    return { allowed: true, remaining: limit, reset: now + windowMs };
  }
}

export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Determine rate limit based on user tier or default
  const user = request.user;
  let limit: number;
  let windowMs: number;
  let identifier: string;

  if (user) {
    const tierConfig = tierLimits[user.tier] || tierLimits['free'];
    limit = user.rateLimit || tierConfig.requests;
    windowMs = tierConfig.windowMs;
    identifier = `user:${user.id}`;
  } else {
    // Use IP-based rate limiting for unauthenticated requests
    limit = env.RATE_LIMIT_MAX;
    windowMs = env.RATE_LIMIT_WINDOW_MS;
    identifier = `ip:${request.ip}`;
  }

  const result = await checkRateLimit(identifier, limit, windowMs);

  // Set rate limit headers
  const rateLimitInfo: RateLimitInfo = {
    remaining: result.remaining,
    reset: result.reset,
    limit,
  };

  request.rateLimitInfo = rateLimitInfo;

  reply.header('X-RateLimit-Limit', limit.toString());
  reply.header('X-RateLimit-Remaining', result.remaining.toString());
  reply.header('X-RateLimit-Reset', Math.ceil(result.reset / 1000).toString());

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
    reply.header('Retry-After', retryAfter.toString());

    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        details: {
          retryAfter,
          limit,
          windowMs,
        },
      },
    });
  }
}

// Stricter rate limit for expensive operations
export async function strictRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const user = request.user;
  const limit = user ? Math.ceil((user.rateLimit || 100) / 10) : 10;
  const windowMs = 60000;
  const identifier = user ? `strict:user:${user.id}` : `strict:ip:${request.ip}`;

  const result = await checkRateLimit(identifier, limit, windowMs);

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.reset - Date.now()) / 1000);
    reply.header('Retry-After', retryAfter.toString());

    return reply.status(429).send({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded for this operation. Please try again later.',
        details: { retryAfter },
      },
    });
  }
}

// Register rate limit plugin
export async function registerRateLimitPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('rateLimit', rateLimitMiddleware);
  fastify.decorate('strictRateLimit', strictRateLimitMiddleware);
}

declare module 'fastify' {
  interface FastifyInstance {
    rateLimit: typeof rateLimitMiddleware;
    strictRateLimit: typeof strictRateLimitMiddleware;
  }
}
