import Database from 'better-sqlite3';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';

let db;

export function getSQLiteDB() {
  if (!db) {
    const sqlitePath = process.env.SQLITE_PATH || './data/ev.db';
    
    // Ensure directory exists
    const dir = path.dirname(sqlitePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    db = new Database(sqlitePath);
    db.pragma('journal_mode = WAL');
    logger.info(`SQLite database initialized: ${sqlitePath}`);
  }
  return db;
}

export async function setupSQLite() {
  const database = getSQLiteDB();
  
  try {
    // Sessions table
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        meter_before REAL,
        meter_after REAL,
        kwh_calc REAL,
        kwh_screen REAL,
        kwh_agreed REAL,
        kwh_source TEXT CHECK (kwh_source IN ('meter', 'screen', 'manual')),
        tariff_month TEXT,
        tariff_value REAL,
        amount_uah REAL,
        location_lat REAL,
        location_lon REAL,
        comment TEXT,
        status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'cancelled')),
        owner_user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Files table
    database.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('before', 'after', 'screen')),
        file_path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        exif_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Tariffs table
    database.exec(`
      CREATE TABLE IF NOT EXISTS tariffs (
        ym TEXT PRIMARY KEY,
        currency TEXT DEFAULT 'UAH',
        price_uah_per_kwh REAL NOT NULL,
        source_note TEXT,
        attachment_file_path TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create indexes
    database.exec('CREATE INDEX IF NOT EXISTS idx_sessions_ym ON sessions(tariff_month)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_user_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id)');
    
    logger.info('SQLite database tables created/verified');
    
  } catch (error) {
    logger.error('SQLite setup failed:', error);
    throw error;
  }
}

export function closeSQLiteDB() {
  if (db) {
    db.close();
    db = null;
    logger.info('SQLite database closed');
  }
}