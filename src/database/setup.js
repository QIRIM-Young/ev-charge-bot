import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

// Database connection pool
let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

export async function setupDatabase() {
  // Skip database setup in development if no DATABASE_URL
  if (process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL?.startsWith('postgresql://')) {
    logger.warn('No DATABASE_URL configured, skipping database setup for development');
    return;
  }

  const client = getPool();
  
  try {
    // Test connection
    await client.query('SELECT NOW()');
    logger.info('Database connection successful');
    
    // Create tables
    await createTables(client);
    logger.info('Database tables created/verified');
    
  } catch (error) {
    logger.error('Database setup failed:', error);
    throw error;
  }
}

async function createTables(client) {
  // Sessions table
  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      started_at TIMESTAMP WITH TIME ZONE NOT NULL,
      finished_at TIMESTAMP WITH TIME ZONE,
      meter_before DECIMAL(10,2),
      meter_after DECIMAL(10,2),
      kwh_calc DECIMAL(10,2),
      kwh_screen DECIMAL(10,2),
      kwh_agreed DECIMAL(10,2),
      kwh_source VARCHAR(20) CHECK (kwh_source IN ('meter', 'screen', 'manual')),
      tariff_month VARCHAR(7), -- YYYY-MM format
      tariff_value DECIMAL(10,2),
      amount_uah DECIMAL(10,2),
      location_lat DECIMAL(10,6),
      location_lon DECIMAL(10,6),
      comment TEXT,
      status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
      owner_user_id BIGINT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Files table
  await client.query(`
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL CHECK (kind IN ('before', 'after', 'screen')),
      blob_url TEXT NOT NULL,
      sha256 VARCHAR(64) NOT NULL,
      width INTEGER,
      height INTEGER,
      exif_json JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Tariffs table
  await client.query(`
    CREATE TABLE IF NOT EXISTS tariffs (
      ym VARCHAR(7) PRIMARY KEY, -- YYYY-MM format
      currency VARCHAR(3) DEFAULT 'UAH',
      price_uah_per_kwh DECIMAL(10,2) NOT NULL,
      source_note TEXT,
      attachment_blob_url TEXT,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Neighbors table
  await client.query(`
    CREATE TABLE IF NOT EXISTS neighbors (
      id SERIAL PRIMARY KEY,
      display_name VARCHAR(100) NOT NULL,
      phone_e164 VARCHAR(20) UNIQUE NOT NULL,
      tg_chat_id BIGINT UNIQUE,
      viber_user_id VARCHAR(50) UNIQUE,
      is_active BOOLEAN DEFAULT true,
      roles TEXT[] DEFAULT ARRAY['NEIGHBOR'],
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // OTP links table
  await client.query(`
    CREATE TABLE IF NOT EXISTS otp_links (
      id SERIAL PRIMARY KEY,
      ym VARCHAR(7) NOT NULL, -- YYYY-MM format
      token VARCHAR(64) UNIQUE NOT NULL,
      role VARCHAR(20) DEFAULT 'VIEW' CHECK (role IN ('VIEW', 'CONFIRM')),
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      used_at TIMESTAMP WITH TIME ZONE,
      issued_to VARCHAR(100),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Audit log table
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      actor VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL,
      object_type VARCHAR(50) NOT NULL,
      object_id VARCHAR(50) NOT NULL,
      meta_json JSONB
    )
  `);

  // Create indexes
  await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_ym ON sessions(tariff_month)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_user_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_neighbors_phone ON neighbors(phone_e164)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_neighbors_tg_chat ON neighbors(tg_chat_id)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_otp_token ON otp_links(token)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_otp_ym ON otp_links(ym)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor)');
  await client.query('CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_log(object_type, object_id)');
}