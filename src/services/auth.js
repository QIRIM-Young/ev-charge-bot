import { getPool } from '../database/setup.js';
import { logger } from '../utils/logger.js';

// Check if user is owner based on environment variables
export function isOwner(userId, username) {
  const ownerChatId = process.env.OWNER_CHAT_ID;
  const ownerUsername = process.env.OWNER_USERNAME;
  
  logger.info(`Auth check: user ${userId} vs owner ${ownerChatId}`);
  
  // Main owner
  if (ownerChatId && userId.toString() === ownerChatId) {
    logger.info(`Owner recognized by chat_id: ${userId}`);
    return true;
  }
  
  // Test bot (temporary for testing)
  if (userId.toString() === '8476511612') {
    logger.info(`Test bot recognized as owner: ${userId}`);
    return true;
  }
  
  if (ownerUsername && username && `@${username}` === ownerUsername) {
    logger.info(`Owner recognized by username: ${username}`);
    return true;
  }
  
  logger.info(`User ${userId} not recognized as owner`);
  return false;
}

// Check if user is authorized neighbor
export async function isAuthorized(userId, phone = null) {
  // Skip database check in development without DB
  if (process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL?.startsWith('postgresql://')) {
    // For development, just check if the user's ID matches a known test ID
    // In real deployment this would check the database
    logger.debug(`Development mode: skipping database auth check for user ${userId}`);
    return null;
  }

  const pool = getPool();
  
  try {
    // Check by telegram chat_id
    const result = await pool.query(
      'SELECT * FROM neighbors WHERE tg_chat_id = $1 AND is_active = true',
      [userId]
    );
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    
    // If phone provided, check by phone
    if (phone) {
      const phoneResult = await pool.query(
        'SELECT * FROM neighbors WHERE phone_e164 = $1 AND is_active = true',
        [phone]
      );
      
      if (phoneResult.rows.length > 0) {
        // Update chat_id for this neighbor
        await pool.query(
          'UPDATE neighbors SET tg_chat_id = $1, updated_at = NOW() WHERE id = $2',
          [userId, phoneResult.rows[0].id]
        );
        
        return phoneResult.rows[0];
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Auth check failed:', error);
    return null;
  }
}

// Normalize phone to E.164 format
export function normalizePhone(phone) {
  // Remove all non-digits
  let cleaned = phone.replace(/\\D/g, '');
  
  // Handle Ukraine numbers
  if (cleaned.startsWith('380')) {
    return '+' + cleaned;
  }
  if (cleaned.startsWith('80')) {
    return '+3' + cleaned;
  }
  if (cleaned.startsWith('0')) {
    return '+38' + cleaned;
  }
  
  // If already with country code
  if (cleaned.length >= 10) {
    return '+' + cleaned;
  }
  
  return null;
}

// Check if phone is in allowed list
export function isPhoneAllowed(phoneE164) {
  const allowedPhones = process.env.ALLOWED_NEIGHBOR_PHONES?.split(',') || [];
  return allowedPhones.includes(phoneE164);
}

// Add neighbor to database
export async function addNeighbor(displayName, phoneE164, chatId = null) {
  // Skip database operations in development without DB
  if (process.env.NODE_ENV === 'development' && !process.env.DATABASE_URL?.startsWith('postgresql://')) {
    logger.info(`Development mode: would add neighbor ${displayName} (${phoneE164})`);
    return {
      id: 1,
      display_name: displayName,
      phone_e164: phoneE164,
      tg_chat_id: chatId,
      is_active: true
    };
  }

  const pool = getPool();
  
  try {
    const result = await pool.query(
      `INSERT INTO neighbors (display_name, phone_e164, tg_chat_id, is_active) 
       VALUES ($1, $2, $3, true) 
       ON CONFLICT (phone_e164) 
       DO UPDATE SET display_name = $1, tg_chat_id = $3, is_active = true, updated_at = NOW()
       RETURNING *`,
      [displayName, phoneE164, chatId]
    );
    
    return result.rows[0];
  } catch (error) {
    logger.error('Failed to add neighbor:', error);
    throw error;
  }
}