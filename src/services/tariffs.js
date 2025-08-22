import { logger } from '../utils/logger.js';
import { getPool } from '../database/setup.js';

// In-memory tariffs for development mode
const memoryTariffs = new Map();

// Check if should use database
function shouldUseDatabase() {
  // Only use database if explicitly in production AND we have a database URL
  return process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.startsWith('postgresql://');
}

// Set tariff for a specific month
export async function setTariff(yearMonth, priceUahPerKwh, sourceNote = '') {
  try {
    // Check if should use database
    if (!shouldUseDatabase()) {
      // Fallback to in-memory storage for development
      logger.info(`Setting tariff in memory: ${yearMonth} = ${priceUahPerKwh} UAH/kWh`);
      
      // Validate year-month format
      if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
        throw new Error('Invalid year-month format. Use YYYY-MM');
      }
      
      // Validate price
      if (priceUahPerKwh <= 0 || priceUahPerKwh > 100) {
        throw new Error('Price must be between 0.01 and 100.00 UAH/kWh');
      }
      
      const tariff = {
        yearMonth,
        priceUahPerKwh: parseFloat(priceUahPerKwh.toFixed(2)),
        sourceNote: sourceNote || 'Встановлено власником',
        updatedAt: new Date()
      };
      
      memoryTariffs.set(yearMonth, tariff);
      logger.info(`Tariff set in memory for ${yearMonth}: ${priceUahPerKwh} UAH/kWh`);
      return tariff;
    }

    const pool = getPool();
    if (!pool) {
      throw new Error('Database pool not available');
    }
    
    // Validate year-month format
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new Error('Invalid year-month format. Use YYYY-MM');
    }
    
    // Validate price
    if (priceUahPerKwh <= 0 || priceUahPerKwh > 100) {
      throw new Error('Price must be between 0.01 and 100.00 UAH/kWh');
    }
    
    const query = `
      INSERT INTO tariffs (ym, currency, price_uah_per_kwh, source_note, updated_at)
      VALUES ($1, 'UAH', $2, $3, NOW())
      ON CONFLICT (ym) 
      DO UPDATE SET 
        price_uah_per_kwh = $2,
        source_note = $3,
        updated_at = NOW()
      RETURNING *
    `;
    
    const result = await pool.query(query, [yearMonth, priceUahPerKwh, sourceNote]);
    
    logger.info(`Tariff set for ${yearMonth}: ${priceUahPerKwh} UAH/kWh`);
    return result.rows[0];
    
  } catch (error) {
    logger.error('Error setting tariff:', error);
    throw error;
  }
}

// Get tariff for a specific month
export async function getTariff(yearMonth) {
  try {
    // Check if should use database
    if (!shouldUseDatabase()) {
      // Fallback to in-memory storage for development
      const tariff = memoryTariffs.get(yearMonth);
      if (!tariff) {
        return null;
      }
      return tariff;
    }

    const pool = getPool();
    if (!pool) {
      throw new Error('Database pool not available');
    }
    
    const query = `
      SELECT * FROM tariffs 
      WHERE ym = $1
    `;
    
    const result = await pool.query(query, [yearMonth]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return {
      yearMonth: result.rows[0].ym,
      priceUahPerKwh: parseFloat(result.rows[0].price_uah_per_kwh),
      sourceNote: result.rows[0].source_note,
      updatedAt: result.rows[0].updated_at
    };
    
  } catch (error) {
    logger.error('Error getting tariff:', error);
    throw error;
  }
}

// Get all available tariffs
export async function getAllTariffs() {
  try {
    // Check if should use database
    if (!shouldUseDatabase()) {
      // Fallback to in-memory storage for development
      const tariffs = Array.from(memoryTariffs.values());
      // Sort by year-month in descending order
      return tariffs.sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
    }

    const pool = getPool();
    if (!pool) {
      throw new Error('Database pool not available');
    }
    
    const query = `
      SELECT * FROM tariffs 
      ORDER BY ym DESC
    `;
    
    const result = await pool.query(query);
    
    return result.rows.map(row => ({
      yearMonth: row.ym,
      priceUahPerKwh: parseFloat(row.price_uah_per_kwh),
      sourceNote: row.source_note,
      updatedAt: row.updated_at
    }));
    
  } catch (error) {
    logger.error('Error getting all tariffs:', error);
    throw error;
  }
}

// Get current month tariff
export async function getCurrentMonthTariff() {
  const currentYearMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  return await getTariff(currentYearMonth);
}