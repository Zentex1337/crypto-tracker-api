import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closeDatabaseConnection } from './db/index.js';
import { stopWebSocketHeartbeat } from './websocket/index.js';
import { shutdownPriceUpdater } from './jobs/priceUpdater.js';

let isShuttingDown = false;

async function main(): Promise<void> {
  console.log('Starting Crypto Tracker API...');
  console.log(`Environment: ${env.NODE_ENV}`);

  const { app, redis } = await buildApp();

  // Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      console.log('Shutdown already in progress...');
      return;
    }

    isShuttingDown = true;
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

    // Give active requests time to complete
    const shutdownTimeout = setTimeout(() => {
      console.error('Shutdown timed out, forcing exit');
      process.exit(1);
    }, 30000);

    try {
      // Stop accepting new connections
      await app.close();
      console.log('HTTP server closed');

      // Stop WebSocket heartbeat
      stopWebSocketHeartbeat();
      console.log('WebSocket heartbeat stopped');

      // Shutdown price updater
      await shutdownPriceUpdater();

      // Close Redis connection
      await redis.quit();
      console.log('Redis connection closed');

      // Close database connection
      await closeDatabaseConnection();

      clearTimeout(shutdownTimeout);
      console.log('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    shutdown('uncaughtException').catch(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection').catch(() => process.exit(1));
  });

  // Start the server
  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });

    console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║                   Crypto Tracker API                      ║
  ╠═══════════════════════════════════════════════════════════╣
  ║  HTTP Server:    http://${env.HOST}:${env.PORT}                    ║
  ║  WebSocket:      ws://${env.HOST}:${env.PORT}/ws                   ║
  ║  Health Check:   http://${env.HOST}:${env.PORT}/health             ║
  ║  Ready Check:    http://${env.HOST}:${env.PORT}/ready              ║
  ║  Environment:    ${env.NODE_ENV.padEnd(38)}║
  ╚═══════════════════════════════════════════════════════════╝
    `);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
