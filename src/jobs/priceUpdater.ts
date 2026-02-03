import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../config/env.js';
import { updateAllPrices } from '../services/priceService.js';
import { checkAllAlerts, onAlertTriggered } from '../services/alertService.js';
import { broadcastPriceUpdate, broadcastAlertTriggered } from '../websocket/index.js';
import type { CryptoPrice } from '../types/index.js';

const QUEUE_NAME = 'price-updates';

let queue: Queue | null = null;
let worker: Worker | null = null;

interface PriceUpdateJobData {
  timestamp: number;
}

interface PriceUpdateJobResult {
  prices: CryptoPrice[];
  triggeredAlerts: number;
  timestamp: number;
}

// Initialize the price updater queue
export async function initializePriceUpdater(redisConnection: Redis): Promise<void> {
  // Create the queue
  queue = new Queue<PriceUpdateJobData, PriceUpdateJobResult>(QUEUE_NAME, {
    connection: redisConnection,
    defaultJobOptions: {
      removeOnComplete: {
        age: 3600, // Keep completed jobs for 1 hour
        count: 100, // Keep last 100 completed jobs
      },
      removeOnFail: {
        age: 86400, // Keep failed jobs for 24 hours
        count: 50, // Keep last 50 failed jobs
      },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    },
  });

  // Create the worker
  worker = new Worker<PriceUpdateJobData, PriceUpdateJobResult>(
    QUEUE_NAME,
    async (job: Job<PriceUpdateJobData>) => {
      console.log(`Processing price update job ${job.id}`);

      try {
        // Update all prices
        const prices = await updateAllPrices();

        // Broadcast updates via WebSocket
        for (const price of prices) {
          broadcastPriceUpdate(price);
        }

        // Check and trigger alerts
        const triggeredAlerts = await checkAllAlerts(prices);

        console.log(
          `Price update complete: ${prices.length} prices, ${triggeredAlerts.length} alerts triggered`
        );

        return {
          prices,
          triggeredAlerts: triggeredAlerts.length,
          timestamp: Date.now(),
        };
      } catch (error) {
        console.error('Price update job failed:', error);
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 1, // Only one job at a time
      limiter: {
        max: 1,
        duration: 5000, // Max 1 job per 5 seconds
      },
    }
  );

  // Set up alert notification callback
  onAlertTriggered((alert, price) => {
    broadcastAlertTriggered(alert, price);
  });

  // Worker event handlers
  worker.on('completed', (job, result) => {
    console.log(`Job ${job.id} completed. Updated ${result.prices.length} prices.`);
  });

  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id} failed:`, error);
  });

  worker.on('error', (error) => {
    console.error('Worker error:', error);
  });

  // Schedule recurring price updates
  await scheduleRecurringUpdates();

  console.log('Price updater initialized');
}

// Schedule recurring price updates
async function scheduleRecurringUpdates(): Promise<void> {
  if (!queue) {
    throw new Error('Queue not initialized');
  }

  // Remove existing repeatable jobs
  const repeatableJobs = await queue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await queue.removeRepeatableByKey(job.key);
  }

  // Add new repeatable job
  await queue.add(
    'price-update',
    { timestamp: Date.now() },
    {
      repeat: {
        every: env.PRICE_UPDATE_INTERVAL_MS,
      },
      jobId: 'recurring-price-update',
    }
  );

  console.log(`Scheduled price updates every ${env.PRICE_UPDATE_INTERVAL_MS}ms`);
}

// Manually trigger a price update
export async function triggerPriceUpdate(): Promise<void> {
  if (!queue) {
    throw new Error('Queue not initialized');
  }

  await queue.add('manual-price-update', { timestamp: Date.now() });
  console.log('Manual price update triggered');
}

// Get queue stats
export async function getQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  if (!queue) {
    throw new Error('Queue not initialized');
  }

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

// Pause the worker
export async function pausePriceUpdater(): Promise<void> {
  if (worker) {
    await worker.pause();
    console.log('Price updater paused');
  }
}

// Resume the worker
export async function resumePriceUpdater(): Promise<void> {
  if (worker) {
    await worker.resume();
    console.log('Price updater resumed');
  }
}

// Graceful shutdown
export async function shutdownPriceUpdater(): Promise<void> {
  console.log('Shutting down price updater...');

  if (worker) {
    await worker.close();
    worker = null;
  }

  if (queue) {
    await queue.close();
    queue = null;
  }

  console.log('Price updater shutdown complete');
}

// Check if queue is ready
export function isPriceUpdaterReady(): boolean {
  return queue !== null && worker !== null;
}
