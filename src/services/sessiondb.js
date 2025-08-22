import { getPool } from '../database/setup.js';
import { logger } from '../utils/logger.js';

// Session states - keep consistent with in-memory version
export const SESSION_STATES = {
  STARTED: 'started',
  BEFORE_PHOTO_UPLOADED: 'before_photo_uploaded', 
  FINISHED: 'finished',
  AFTER_PHOTOS_UPLOADED: 'after_photos_uploaded',
  COMPLETED: 'completed'
};

// Mapping between internal states and database status
const STATE_TO_STATUS = {
  [SESSION_STATES.STARTED]: 'draft',
  [SESSION_STATES.BEFORE_PHOTO_UPLOADED]: 'draft',
  [SESSION_STATES.FINISHED]: 'draft',
  [SESSION_STATES.AFTER_PHOTOS_UPLOADED]: 'draft',
  [SESSION_STATES.COMPLETED]: 'confirmed'
};

// Check if should use database
function shouldUseDatabase() {
  // Only use database if explicitly in production AND we have a database URL
  return process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.startsWith('postgresql://');
}

// Create new charging session in database
export async function createSession(ownerId) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { createSession: memCreateSession } = await import('./sessions.js');
    return memCreateSession(ownerId);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `INSERT INTO sessions (owner_user_id, started_at, status) 
       VALUES ($1, NOW(), 'draft') 
       RETURNING *`,
      [ownerId]
    );
    
    const session = dbRowToSession(result.rows[0]);
    logger.info(`Database session created: ${session.id} for user ${ownerId}`);
    return session;
    
  } catch (error) {
    logger.error('Error creating session in database:', error);
    throw error;
  }
}

// Get active session for user from database
export async function getActiveSession(ownerId) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { getActiveSession: memGetActiveSession } = await import('./sessions.js');
    return memGetActiveSession(ownerId);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `SELECT s.*, 
        array_agg(
          json_build_object(
            'id', f.id,
            'kind', f.kind,
            'blob_url', f.blob_url,
            'sha256', f.sha256,
            'width', f.width,
            'height', f.height,
            'exif_json', f.exif_json,
            'created_at', f.created_at
          ) ORDER BY f.created_at
        ) FILTER (WHERE f.id IS NOT NULL) as files
       FROM sessions s
       LEFT JOIN files f ON s.id = f.session_id
       WHERE s.owner_user_id = $1 AND s.status = 'draft'
       GROUP BY s.id
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [ownerId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const session = dbRowToSession(result.rows[0]);
    logger.info(`Active session found: ${session.id} for user ${ownerId}`);
    return session;
    
  } catch (error) {
    logger.error('Error getting active session from database:', error);
    throw error;
  }
}

// Update session in database
export async function updateSession(sessionId, updates) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { updateSession: memUpdateSession } = await import('./sessions.js');
    return memUpdateSession(sessionId, updates);
  }

  const pool = getPool();
  
  try {
    // Build dynamic update query
    const setClause = [];
    const values = [];
    let paramIndex = 1;
    
    // Map state to database status if needed
    if (updates.state) {
      updates.status = STATE_TO_STATUS[updates.state] || 'draft';
    }
    
    // Map session properties to database columns
    const fieldMapping = {
      finishedAt: 'finished_at',
      meterBefore: 'meter_before',
      meterAfter: 'meter_after',
      kwhCalculated: 'kwh_calc',
      kwhScreen: 'kwh_screen',
      kwhAgreed: 'kwh_agreed',
      tariffValue: 'tariff_value',
      amountUah: 'amount_uah',
      status: 'status'
    };
    
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'state') continue; // Skip state as it's mapped to status
      
      const dbField = fieldMapping[key] || key;
      setClause.push(`${dbField} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
    
    if (setClause.length === 0) {
      throw new Error('No valid fields to update');
    }
    
    // Always update updated_at
    setClause.push(`updated_at = NOW()`);
    values.push(sessionId);
    
    const query = `
      UPDATE sessions 
      SET ${setClause.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const session = dbRowToSession(result.rows[0]);
    logger.info(`Database session updated: ${sessionId}`, updates);
    return session;
    
  } catch (error) {
    logger.error('Error updating session in database:', error);
    throw error;
  }
}

// Add photo to session in database
export async function addPhotoToSession(sessionId, photo) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { addPhotoToSession: memAddPhotoToSession } = await import('./sessions.js');
    return memAddPhotoToSession(sessionId, photo);
  }

  const pool = getPool();
  
  try {
    // For now, store file info as JSON in the files table
    // In production, we'd upload to Azure Blob Storage and store the URL
    const blobUrl = `temp://file_${photo.fileId}`;
    const sha256 = photo.fileId; // Temporary
    
    await pool.query(
      `INSERT INTO files (session_id, kind, blob_url, sha256, exif_json, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [sessionId, photo.type, blobUrl, sha256, JSON.stringify(photo)]
    );
    
    // Get updated session
    const session = await getSession(sessionId);
    logger.info(`Photo added to database session ${sessionId}:`, photo.type);
    return session;
    
  } catch (error) {
    logger.error('Error adding photo to session in database:', error);
    throw error;
  }
}

// Set meter reading in database
export async function setMeterReading(sessionId, type, value, source = 'manual') {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { setMeterReading: memSetMeterReading } = await import('./sessions.js');
    return memSetMeterReading(sessionId, type, value, source);
  }

  const pool = getPool();
  
  try {
    const updates = {};
    
    if (type === 'before') {
      updates.meterBefore = value;
      updates.state = SESSION_STATES.BEFORE_PHOTO_UPLOADED;
    } else if (type === 'after') {
      updates.meterAfter = value;
      updates.state = SESSION_STATES.AFTER_PHOTOS_UPLOADED;
      
      // Calculate kWh if both readings are available
      const sessionResult = await pool.query('SELECT meter_before FROM sessions WHERE id = $1', [sessionId]);
      if (sessionResult.rows.length > 0 && sessionResult.rows[0].meter_before) {
        const meterBefore = parseFloat(sessionResult.rows[0].meter_before);
        const calculated = value - meterBefore;
        updates.kwhCalculated = Math.max(0, calculated);
      }
    } else if (type === 'screen') {
      // Screen reading - kWh consumed from charging station display
      updates.kwhScreen = value;
      // Don't change state for screen readings, they are supplementary
    }
    
    return updateSession(sessionId, updates);
    
  } catch (error) {
    logger.error('Error setting meter reading in database:', error);
    throw error;
  }
}

// Finish session in database
export async function finishSession(sessionId) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { finishSession: memFinishSession } = await import('./sessions.js');
    return memFinishSession(sessionId);
  }

  return updateSession(sessionId, {
    state: SESSION_STATES.FINISHED,
    finishedAt: new Date()
  });
}

// Complete session with final calculations in database
export async function completeSession(sessionId, tariffValue) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { completeSession: memCompleteSession } = await import('./sessions.js');
    return memCompleteSession(sessionId, tariffValue);
  }

  const pool = getPool();
  
  try {
    // Get current session data
    const sessionResult = await pool.query('SELECT kwh_calc FROM sessions WHERE id = $1', [sessionId]);
    if (sessionResult.rows.length === 0) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    const kwhCalculated = parseFloat(sessionResult.rows[0].kwh_calc);
    if (!kwhCalculated || !tariffValue) {
      throw new Error('Missing kWh or tariff data for session completion');
    }
    
    const amountUah = (kwhCalculated * tariffValue).toFixed(2);
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    return updateSession(sessionId, {
      state: SESSION_STATES.COMPLETED,
      tariffValue: tariffValue,
      kwhAgreed: kwhCalculated,
      amountUah: parseFloat(amountUah),
      tariff_month: currentMonth
    });
    
  } catch (error) {
    logger.error('Error completing session in database:', error);
    throw error;
  }
}

// Get session by ID from database
export async function getSession(sessionId) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { getSession: memGetSession } = await import('./sessions.js');
    return memGetSession(sessionId);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `SELECT s.*, 
        array_agg(
          json_build_object(
            'id', f.id,
            'kind', f.kind,
            'blob_url', f.blob_url,
            'sha256', f.sha256,
            'width', f.width,
            'height', f.height,
            'exif_json', f.exif_json,
            'created_at', f.created_at
          ) ORDER BY f.created_at
        ) FILTER (WHERE f.id IS NOT NULL) as files
       FROM sessions s
       LEFT JOIN files f ON s.id = f.session_id
       WHERE s.id = $1
       GROUP BY s.id`,
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return dbRowToSession(result.rows[0]);
    
  } catch (error) {
    logger.error('Error getting session from database:', error);
    throw error;
  }
}

// Get all sessions for user from database
export async function getUserSessions(ownerId, limit = 10) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { getUserSessions: memGetUserSessions } = await import('./sessions.js');
    return memGetUserSessions(ownerId, limit);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `SELECT * FROM sessions 
       WHERE owner_user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [ownerId, limit]
    );
    
    return result.rows.map(dbRowToSession);
    
  } catch (error) {
    logger.error('Error getting user sessions from database:', error);
    throw error;
  }
}

// Get sessions for month from database
export async function getSessionsForMonth(ownerId, yearMonth) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { getSessionsForMonth: memGetSessionsForMonth } = await import('./sessions.js');
    return memGetSessionsForMonth(ownerId, yearMonth);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `SELECT * FROM sessions 
       WHERE owner_user_id = $1 
       AND tariff_month = $2
       ORDER BY created_at ASC`,
      [ownerId, yearMonth]
    );
    
    return result.rows.map(dbRowToSession);
    
  } catch (error) {
    logger.error('Error getting sessions for month from database:', error);
    throw error;
  }
}

// Calculate monthly statistics from database
export async function getMonthlyStats(ownerId, yearMonth) {
  // Check if database is available
  if (!shouldUseDatabase()) {
    // Fallback to in-memory session for development
    const { getMonthlyStats: memGetMonthlyStats } = await import('./sessions.js');
    return memGetMonthlyStats(ownerId, yearMonth);
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_sessions,
        COUNT(*) FILTER (WHERE meter_before IS NOT NULL AND meter_after IS NOT NULL) as completed_sessions,
        COALESCE(SUM(kwh_calc) FILTER (WHERE kwh_calc IS NOT NULL), 0) as total_kwh,
        COALESCE(SUM(amount_uah) FILTER (WHERE amount_uah IS NOT NULL), 0) as total_amount,
        COALESCE(AVG(tariff_value) FILTER (WHERE tariff_value IS NOT NULL), 0) as average_tariff
       FROM sessions 
       WHERE owner_user_id = $1 AND (tariff_month = $2 OR DATE_TRUNC('month', created_at) = DATE_TRUNC('month', ($2 || '-01')::date))`,
      [ownerId, yearMonth]
    );
    
    if (result.rows.length === 0) {
      return {
        totalSessions: 0,
        completedSessions: 0,
        totalKwh: 0,
        totalAmount: 0,
        averageTariff: 0
      };
    }
    
    const row = result.rows[0];
    return {
      totalSessions: parseInt(row.total_sessions) || 0,
      completedSessions: parseInt(row.completed_sessions) || 0,
      totalKwh: parseFloat(row.total_kwh).toFixed(2),
      totalAmount: parseFloat(row.total_amount).toFixed(2),
      averageTariff: parseFloat(row.average_tariff).toFixed(2)
    };
    
  } catch (error) {
    logger.error('Error getting monthly stats from database:', error);
    throw error;
  }
}

// Helper function to convert database row to session object
function dbRowToSession(row) {
  // Determine state from database status and data
  let state = SESSION_STATES.STARTED;
  if (row.status === 'confirmed') {
    state = SESSION_STATES.COMPLETED;
  } else if (row.meter_after && row.kwh_calc) {
    state = SESSION_STATES.AFTER_PHOTOS_UPLOADED;
  } else if (row.finished_at) {
    state = SESSION_STATES.FINISHED;
  } else if (row.meter_before) {
    state = SESSION_STATES.BEFORE_PHOTO_UPLOADED;
  }
  
  return {
    id: row.id,
    ownerId: row.owner_user_id,
    state: state,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    meterBefore: row.meter_before ? parseFloat(row.meter_before) : null,
    meterAfter: row.meter_after ? parseFloat(row.meter_after) : null,
    kwhCalculated: row.kwh_calc ? parseFloat(row.kwh_calc) : null,
    kwhScreen: row.kwh_screen ? parseFloat(row.kwh_screen) : null,
    kwhAgreed: row.kwh_agreed ? parseFloat(row.kwh_agreed) : null,
    tariffValue: row.tariff_value ? parseFloat(row.tariff_value) : null,
    amountUah: row.amount_uah ? parseFloat(row.amount_uah) : null,
    photos: row.files || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}