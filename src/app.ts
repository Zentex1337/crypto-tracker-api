import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Redis from 'ioredis';
import { env, isDev } from './config/env.js';
import { checkDatabaseConnection } from './db/index.js';
import { registerAuthPlugin } from './api/middleware/auth.js';
import { registerRateLimitPlugin, initializeRateLimitRedis } from './api/middleware/rateLimit.js';
import { initializePriceServiceRedis } from './services/priceService.js';
import { registerWebSocket, getConnectionCount } from './websocket/index.js';
import { initializePriceUpdater, getQueueStats, isPriceUpdaterReady } from './jobs/priceUpdater.js';
import pricesRoutes from './api/routes/prices.js';
import portfolioRoutes from './api/routes/portfolio.js';
import alertsRoutes from './api/routes/alerts.js';

// Create Redis connection
function createRedisConnection(): Redis {
  const redis = new Redis(env.REDIS_URL, {
    password: env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        console.error('Redis connection failed after 3 retries');
        return null;
      }
      return Math.min(times * 200, 2000);
    },
  });

  redis.on('connect', () => {
    console.log('Redis connected');
  });

  redis.on('error', (error) => {
    console.error('Redis error:', error);
  });

  return redis;
}

// Build Fastify app
export async function buildApp(): Promise<{ app: FastifyInstance; redis: Redis }> {
  // Create Fastify instance
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: isDev()
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
    trustProxy: true,
  });

  // Create Redis connection
  const redis = createRedisConnection();

  // Initialize services with Redis
  initializeRateLimitRedis(redis);
  initializePriceServiceRedis(redis);

  // Register plugins
  await app.register(cors, {
    origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false, // Disable for API
  });

  await app.register(sensible);

  // Register custom middleware plugins
  await registerAuthPlugin(app);
  await registerRateLimitPlugin(app);

  // Register WebSocket
  await registerWebSocket(app);

  // Initialize price updater job queue
  await initializePriceUpdater(redis);

  // Health check endpoints
  app.get('/health', async (_request, reply) => {
    return reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_request, reply) => {
    const dbHealthy = await checkDatabaseConnection();
    const redisHealthy = redis.status === 'ready';
    const queueReady = isPriceUpdaterReady();

    const isReady = dbHealthy && redisHealthy && queueReady;

    return reply.status(isReady ? 200 : 503).send({
      status: isReady ? 'ready' : 'not_ready',
      checks: {
        database: dbHealthy ? 'healthy' : 'unhealthy',
        redis: redisHealthy ? 'healthy' : 'unhealthy',
        queue: queueReady ? 'ready' : 'not_ready',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Metrics endpoint
  app.get('/metrics', async (_request, reply) => {
    const queueStats = await getQueueStats();
    const wsConnections = getConnectionCount();

    return reply.send({
      websocket: {
        connections: wsConnections,
      },
      queue: queueStats,
      timestamp: new Date().toISOString(),
    });
  });

  // API info endpoint
  app.get('/', async (_request, reply) => {
    return reply.send({
      name: 'Crypto Tracker API',
      version: '1.0.0',
      description: 'Real-time cryptocurrency tracking API with WebSocket support',
      endpoints: {
        prices: '/prices',
        portfolio: '/portfolio',
        alerts: '/alerts',
        websocket: '/ws',
        health: '/health',
        ready: '/ready',
        metrics: '/metrics',
      },
      documentation: '/docs',
    });
  });

  // Register API routes
  await app.register(pricesRoutes, { prefix: '/prices' });
  await app.register(portfolioRoutes, { prefix: '/portfolio' });
  await app.register(alertsRoutes, { prefix: '/alerts' });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    // Handle validation errors
    if (error.validation) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
    }

    // Handle not found
    if (error.statusCode === 404) {
      return reply.status(404).send({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Resource not found',
        },
      });
    }

    // Handle other errors
    const statusCode = error.statusCode ?? 500;
    return reply.status(statusCode).send({
      success: false,
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: isDev() ? error.message : 'An unexpected error occurred',
        ...(isDev() && { stack: error.stack }),
      },
    });
  });

  // Not found handler
  app.setNotFoundHandler((_request, reply) => {
    return reply.status(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  return { app, redis };
}
