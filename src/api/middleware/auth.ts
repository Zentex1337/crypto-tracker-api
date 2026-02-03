import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { env } from '../../config/env.js';
import type { AuthenticatedUser } from '../../types/index.js';

// In-memory cache for API keys (in production, use Redis)
const apiKeyCache = new Map<string, { user: AuthenticatedUser; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function validateApiKey(apiKey: string): Promise<AuthenticatedUser | null> {
  // Check cache first
  const cached = apiKeyCache.get(apiKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }

  // Query database
  try {
    const result = await db
      .select({
        id: users.id,
        apiKey: users.apiKey,
        tier: users.tier,
        rateLimit: users.rateLimit,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.apiKey, apiKey))
      .limit(1);

    if (result.length === 0 || !result[0]?.isActive) {
      return null;
    }

    const user = result[0];
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      apiKey: user.apiKey,
      tier: user.tier as 'free' | 'pro' | 'enterprise',
      rateLimit: Number(user.rateLimit),
    };

    // Cache the result
    apiKeyCache.set(apiKey, {
      user: authenticatedUser,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    return authenticatedUser;
  } catch (error) {
    console.error('Error validating API key:', error);
    return null;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers[env.API_KEY_HEADER.toLowerCase()] as string | undefined;

  if (!apiKey) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'MISSING_API_KEY',
        message: `API key required. Include it in the ${env.API_KEY_HEADER} header.`,
      },
    });
  }

  const user = await validateApiKey(apiKey);

  if (!user) {
    return reply.status(401).send({
      success: false,
      error: {
        code: 'INVALID_API_KEY',
        message: 'Invalid or inactive API key.',
      },
    });
  }

  request.user = user;
}

// Optional auth - doesn't fail if no API key, but attaches user if present
export async function optionalAuthMiddleware(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers[env.API_KEY_HEADER.toLowerCase()] as string | undefined;

  if (apiKey) {
    const user = await validateApiKey(apiKey);
    if (user) {
      request.user = user;
    }
  }
}

// Register auth plugin
export async function registerAuthPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('authenticate', authMiddleware);
  fastify.decorate('optionalAuth', optionalAuthMiddleware);

  // Add hooks for protected routes
  fastify.addHook('onRequest', async (request, reply) => {
    // Skip auth for health check and public routes
    const publicPaths = ['/health', '/ready', '/docs', '/'];
    const isPublic = publicPaths.some((path) => request.url.startsWith(path));

    if (isPublic) {
      return;
    }

    // Check if route requires auth (can be configured per-route)
    const routeConfig = request.routeOptions?.config as { auth?: boolean } | undefined;
    if (routeConfig?.auth === false) {
      return;
    }
  });
}

// Utility to invalidate cached API key
export function invalidateApiKeyCache(apiKey: string): void {
  apiKeyCache.delete(apiKey);
}

// Clear entire cache
export function clearApiKeyCache(): void {
  apiKeyCache.clear();
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authMiddleware;
    optionalAuth: typeof optionalAuthMiddleware;
  }
}
