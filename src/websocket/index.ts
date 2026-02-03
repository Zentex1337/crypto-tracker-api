import { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { env } from '../config/env.js';
import {
  handleConnection,
  handleDisconnection,
  handleMessage,
  handlePing,
  cleanupStaleConnections,
  getConnectionCount,
} from './handlers/priceHandler.js';

let heartbeatInterval: NodeJS.Timeout | null = null;

export async function registerWebSocket(fastify: FastifyInstance): Promise<void> {
  // Register WebSocket plugin
  await fastify.register(websocket, {
    options: {
      maxPayload: 1024 * 16, // 16KB max message size
      clientTracking: true,
    },
  });

  // WebSocket route
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    // Get user ID from query or auth (simplified - in production use proper auth)
    const userId = request.query
      ? (request.query as Record<string, string>)['userId']
      : undefined;

    // Handle connection
    handleConnection(socket, userId);

    // Handle incoming messages
    socket.on('message', (data: Buffer) => {
      const message = data.toString();

      // Handle ping/pong
      if (message === 'ping') {
        handlePing(socket);
        socket.send('pong');
        return;
      }

      handleMessage(socket, message).catch((error) => {
        console.error('Error handling WebSocket message:', error);
      });
    });

    // Handle close
    socket.on('close', () => {
      handleDisconnection(socket);
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('WebSocket error:', error);
      handleDisconnection(socket);
    });
  });

  // Start heartbeat interval for cleaning stale connections
  heartbeatInterval = setInterval(() => {
    const maxAge = env.WS_HEARTBEAT_INTERVAL_MS * 3; // 3 missed heartbeats
    cleanupStaleConnections(maxAge);
  }, env.WS_HEARTBEAT_INTERVAL_MS);

  // Log WebSocket setup
  fastify.log.info('WebSocket server registered at /ws');
}

// Stop heartbeat interval (for graceful shutdown)
export function stopWebSocketHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Export for external use
export { broadcastPriceUpdate, broadcastAlertTriggered } from './handlers/priceHandler.js';
export { getConnectionCount };
