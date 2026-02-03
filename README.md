# Crypto Tracker API

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript" />
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis" />
  <img src="https://img.shields.io/badge/WebSocket-010101?style=for-the-badge&logo=socket.io" />
</p>

<p align="center">
  <strong>Real-time cryptocurrency price tracker with WebSocket support and historical data</strong>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/rainbow.png" />
</p>

## Features

- **Real-time Prices** - WebSocket streaming for live price updates
- **REST API** - Traditional REST endpoints for all operations
- **Historical Data** - OHLCV data with configurable timeframes
- **Price Alerts** - Set price alerts with webhook notifications
- **Portfolio Tracking** - Track holdings and calculate P&L
- **Rate Limiting** - Redis-based rate limiting per API key
- **Caching** - Intelligent caching to reduce API calls

## API Endpoints

### Prices

```http
GET /api/v1/prices/:symbol
GET /api/v1/prices?symbols=BTC,ETH,SOL
GET /api/v1/prices/:symbol/history?timeframe=1d&limit=30
```

### Portfolio

```http
POST /api/v1/portfolio
GET /api/v1/portfolio/:id
PUT /api/v1/portfolio/:id/holdings
GET /api/v1/portfolio/:id/performance
```

### Alerts

```http
POST /api/v1/alerts
GET /api/v1/alerts
DELETE /api/v1/alerts/:id
```

### WebSocket

```javascript
// Connect to WebSocket
const ws = new WebSocket('wss://api.example.com/ws');

// Subscribe to price updates
ws.send(JSON.stringify({
  type: 'subscribe',
  channels: ['prices'],
  symbols: ['BTC', 'ETH', 'SOL']
}));

// Receive updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  // { symbol: 'BTC', price: 45000, change24h: 2.5, ... }
};
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20, TypeScript |
| Framework | Fastify |
| Database | PostgreSQL, TimescaleDB |
| Cache | Redis |
| WebSocket | Socket.io |
| Queue | BullMQ |
| Docs | Swagger/OpenAPI |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Zentex1337/crypto-tracker-api.git
cd crypto-tracker-api

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env

# Start Redis and PostgreSQL
docker-compose up -d

# Run migrations
pnpm db:migrate

# Start development server
pnpm dev
```

## Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/crypto_tracker

# Redis
REDIS_URL=redis://localhost:6379

# External APIs
COINGECKO_API_KEY=your_key
COINMARKETCAP_API_KEY=your_key

# Auth
JWT_SECRET=your_secret
API_KEY_SALT=your_salt
```

## Project Structure

```
├── src/
│   ├── api/
│   │   ├── routes/
│   │   ├── controllers/
│   │   └── middleware/
│   ├── services/
│   │   ├── price.service.ts
│   │   ├── portfolio.service.ts
│   │   └── alert.service.ts
│   ├── websocket/
│   │   └── handlers/
│   ├── jobs/
│   │   └── price-updater.ts
│   ├── db/
│   │   ├── migrations/
│   │   └── models/
│   └── utils/
├── test/
└── docker-compose.yml
```

## Response Format

### Success Response

```json
{
  "success": true,
  "data": {
    "symbol": "BTC",
    "price": 45000.50,
    "change24h": 2.5,
    "volume24h": 28000000000,
    "marketCap": 880000000000,
    "updatedAt": "2024-01-15T10:30:00Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests, please try again later",
    "retryAfter": 60
  }
}
```

## Rate Limits

| Plan | Requests/min | WebSocket Connections |
|------|-------------|----------------------|
| Free | 30 | 1 |
| Pro | 300 | 5 |
| Enterprise | Unlimited | Unlimited |

## Performance

- Average response time: <50ms
- WebSocket latency: <10ms
- Supports 10k+ concurrent connections
- 99.9% uptime SLA

## Supported Cryptocurrencies

- 500+ cryptocurrencies
- All major exchanges
- Real-time price aggregation

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Run e2e tests
pnpm test:e2e
```

## Deployment

```bash
# Build for production
pnpm build

# Start production server
pnpm start

# Or use Docker
docker build -t crypto-tracker-api .
docker run -p 3000:3000 crypto-tracker-api
```

## Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with ❤️ by <a href="https://github.com/Zentex1337">Zentex</a>
</p>
