-- =============================================================================
-- Crypto Tracker API - Database Initialization
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Users table for API key management
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    api_key_hash VARCHAR(128) NOT NULL,
    tier VARCHAR(20) NOT NULL DEFAULT 'free',
    rate_limit DECIMAL(10, 0) NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_api_key_idx ON users(api_key);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

-- -----------------------------------------------------------------------------
-- Portfolio holdings table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_holdings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(10) NOT NULL,
    amount DECIMAL(20, 8) NOT NULL,
    average_buy_price DECIMAL(20, 8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS portfolio_user_id_idx ON portfolio_holdings(user_id);
CREATE INDEX IF NOT EXISTS portfolio_symbol_idx ON portfolio_holdings(symbol);
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_user_symbol_idx ON portfolio_holdings(user_id, symbol);

-- -----------------------------------------------------------------------------
-- Price alerts table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(10) NOT NULL,
    condition VARCHAR(20) NOT NULL, -- 'above', 'below', 'percent_change'
    target_price DECIMAL(20, 8),
    percent_change DECIMAL(10, 4),
    base_price DECIMAL(20, 8), -- Price when alert was created (for percent change)
    is_triggered BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS alerts_user_id_idx ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS alerts_symbol_idx ON price_alerts(symbol);
CREATE INDEX IF NOT EXISTS alerts_active_idx ON price_alerts(is_active);

-- -----------------------------------------------------------------------------
-- Price history table (for sparklines and charts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(10) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(30, 2),
    market_cap DECIMAL(30, 2),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS price_history_symbol_idx ON price_history(symbol);
CREATE INDEX IF NOT EXISTS price_history_timestamp_idx ON price_history(timestamp);
CREATE INDEX IF NOT EXISTS price_history_symbol_timestamp_idx ON price_history(symbol, timestamp);

-- -----------------------------------------------------------------------------
-- Function to update updated_at timestamp
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_portfolio_holdings_updated_at ON portfolio_holdings;
CREATE TRIGGER update_portfolio_holdings_updated_at
    BEFORE UPDATE ON portfolio_holdings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Insert a demo user for testing
-- -----------------------------------------------------------------------------
INSERT INTO users (email, api_key, api_key_hash, tier, rate_limit)
VALUES (
    'demo@crypto-tracker.local',
    'demo-api-key-12345678901234567890123456789012',
    'demo-hash',
    'pro',
    1000
) ON CONFLICT (email) DO NOTHING;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO crypto;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crypto;
