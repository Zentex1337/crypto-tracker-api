import { WebSocket } from 'ws';
import { z } from 'zod';
import { getPrice, getSupportedSymbols } from '../../services/priceService.js';
import type {
  WSClientMessage,
  WSServerMessage,
  CryptoPrice,
  PriceAlert as PriceAlertType,
} from '../../types/index.js';

// Client message validation
const WSSubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  symbols: z.array(z.string().min(1).max(10).toUpperCase()),
});

const WSUnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  symbols: z.array(z.string().min(1).max(10).toUpperCase()),
});

const WSClientMessageSchema = z.discriminatedUnion('type', [
  WSSubscribeMessageSchema,
  WSUnsubscribeMessageSchema,
]);

// Connection state
interface ClientConnection {
  socket: WebSocket;
  subscribedSymbols: Set<string>;
  userId?: string;
  lastPing: number;
}

// Global state for connections
const connections = new Map<WebSocket, ClientConnection>();
const symbolSubscribers = new Map<string, Set<WebSocket>>();

// Send message to a client
function sendToClient(socket: WebSocket, message: WSServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

// Send error to a client
function sendError(socket: WebSocket, message: string, code?: string): void {
  sendToClient(socket, {
    type: 'error',
    message,
    code,
  });
}

// Handle new connection
export function handleConnection(socket: WebSocket, userId?: string): void {
  const connection: ClientConnection = {
    socket,
    subscribedSymbols: new Set(),
    userId,
    lastPing: Date.now(),
  };

  connections.set(socket, connection);

  console.log(`WebSocket client connected. Total: ${connections.size}`);

  // Send welcome message with supported symbols
  sendToClient(socket, {
    type: 'subscribed',
    symbols: [],
  });
}

// Handle disconnection
export function handleDisconnection(socket: WebSocket): void {
  const connection = connections.get(socket);

  if (connection) {
    // Remove from all symbol subscriptions
    for (const symbol of connection.subscribedSymbols) {
      const subscribers = symbolSubscribers.get(symbol);
      if (subscribers) {
        subscribers.delete(socket);
        if (subscribers.size === 0) {
          symbolSubscribers.delete(symbol);
        }
      }
    }

    connections.delete(socket);
  }

  console.log(`WebSocket client disconnected. Total: ${connections.size}`);
}

// Handle incoming message
export async function handleMessage(socket: WebSocket, data: string): Promise<void> {
  const connection = connections.get(socket);

  if (!connection) {
    sendError(socket, 'Connection not found', 'CONNECTION_ERROR');
    return;
  }

  // Update last ping
  connection.lastPing = Date.now();

  try {
    const parsed = JSON.parse(data) as unknown;
    const result = WSClientMessageSchema.safeParse(parsed);

    if (!result.success) {
      sendError(socket, 'Invalid message format', 'INVALID_MESSAGE');
      return;
    }

    const message = result.data;

    switch (message.type) {
      case 'subscribe':
        await handleSubscribe(socket, connection, message.symbols);
        break;

      case 'unsubscribe':
        handleUnsubscribe(socket, connection, message.symbols);
        break;

      default:
        sendError(socket, 'Unknown message type', 'UNKNOWN_MESSAGE_TYPE');
    }
  } catch {
    sendError(socket, 'Failed to parse message', 'PARSE_ERROR');
  }
}

// Handle subscribe request
async function handleSubscribe(
  socket: WebSocket,
  connection: ClientConnection,
  symbols: string[]
): Promise<void> {
  const supportedSymbols = getSupportedSymbols();
  const validSymbols: string[] = [];
  const invalidSymbols: string[] = [];

  for (const symbol of symbols) {
    const upperSymbol = symbol.toUpperCase();
    if (supportedSymbols.includes(upperSymbol)) {
      validSymbols.push(upperSymbol);
    } else {
      invalidSymbols.push(symbol);
    }
  }

  if (invalidSymbols.length > 0) {
    sendError(
      socket,
      `Unsupported symbols: ${invalidSymbols.join(', ')}`,
      'INVALID_SYMBOLS'
    );
  }

  // Subscribe to valid symbols
  for (const symbol of validSymbols) {
    connection.subscribedSymbols.add(symbol);

    if (!symbolSubscribers.has(symbol)) {
      symbolSubscribers.set(symbol, new Set());
    }
    symbolSubscribers.get(symbol)!.add(socket);
  }

  // Send confirmation
  sendToClient(socket, {
    type: 'subscribed',
    symbols: Array.from(connection.subscribedSymbols),
  });

  // Send current prices for subscribed symbols
  for (const symbol of validSymbols) {
    const price = await getPrice(symbol);
    if (price) {
      sendToClient(socket, {
        type: 'price_update',
        data: price,
      });
    }
  }
}

// Handle unsubscribe request
function handleUnsubscribe(
  socket: WebSocket,
  connection: ClientConnection,
  symbols: string[]
): void {
  for (const symbol of symbols) {
    const upperSymbol = symbol.toUpperCase();
    connection.subscribedSymbols.delete(upperSymbol);

    const subscribers = symbolSubscribers.get(upperSymbol);
    if (subscribers) {
      subscribers.delete(socket);
      if (subscribers.size === 0) {
        symbolSubscribers.delete(upperSymbol);
      }
    }
  }

  // Send confirmation
  sendToClient(socket, {
    type: 'unsubscribed',
    symbols: symbols.map((s) => s.toUpperCase()),
  });
}

// Broadcast price update to all subscribers
export function broadcastPriceUpdate(price: CryptoPrice): void {
  const subscribers = symbolSubscribers.get(price.symbol);

  if (subscribers && subscribers.size > 0) {
    const message: WSServerMessage = {
      type: 'price_update',
      data: price,
    };

    for (const socket of subscribers) {
      sendToClient(socket, message);
    }
  }
}

// Broadcast alert triggered to specific user
export function broadcastAlertTriggered(alert: PriceAlertType, price: CryptoPrice): void {
  for (const [socket, connection] of connections) {
    if (connection.userId === alert.userId) {
      sendToClient(socket, {
        type: 'alert_triggered',
        data: alert,
      });

      // Also send the current price
      sendToClient(socket, {
        type: 'price_update',
        data: price,
      });
    }
  }
}

// Get connected client count
export function getConnectionCount(): number {
  return connections.size;
}

// Get subscribed symbols
export function getSubscribedSymbols(): string[] {
  return Array.from(symbolSubscribers.keys());
}

// Clean up stale connections
export function cleanupStaleConnections(maxAge: number): void {
  const now = Date.now();

  for (const [socket, connection] of connections) {
    if (now - connection.lastPing > maxAge) {
      console.log('Closing stale WebSocket connection');
      socket.close(1000, 'Connection timeout');
      handleDisconnection(socket);
    }
  }
}

// Handle ping from client
export function handlePing(socket: WebSocket): void {
  const connection = connections.get(socket);
  if (connection) {
    connection.lastPing = Date.now();
  }
}
