import { logger } from '../utils/logger.js';

// In-memory storage for sessions (temporary, until DB is connected)
let sessions = new Map();
let currentSessionId = 1;

// Session states
export const SESSION_STATES = {
  STARTED: 'started',
  BEFORE_PHOTO_UPLOADED: 'before_photo_uploaded', 
  FINISHED: 'finished',
  AFTER_PHOTOS_UPLOADED: 'after_photos_uploaded',
  COMPLETED: 'completed'
};

// Create new charging session
export function createSession(ownerId) {
  const sessionId = currentSessionId++;
  const session = {
    id: sessionId,
    ownerId: ownerId,
    state: SESSION_STATES.STARTED,
    startedAt: new Date(),
    finishedAt: null,
    meterBefore: null,
    meterAfter: null,
    kwhCalculated: null,
    kwhScreen: null,
    kwhAgreed: null,
    tariffValue: null,
    amountUah: null,
    photos: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  sessions.set(sessionId, session);
  logger.info(`Session created: ${sessionId} for user ${ownerId}`);
  return session;
}

// Get active session for user
export function getActiveSession(ownerId) {
  for (const session of sessions.values()) {
    if (session.ownerId === ownerId && session.state !== SESSION_STATES.COMPLETED) {
      return session;
    }
  }
  return null;
}

// Update session
export function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  Object.assign(session, updates, { updatedAt: new Date() });
  sessions.set(sessionId, session);
  logger.info(`Session updated: ${sessionId}`, updates);
  return session;
}

// Add photo to session
export function addPhotoToSession(sessionId, photo) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  session.photos.push({
    ...photo,
    uploadedAt: new Date()
  });
  
  sessions.set(sessionId, session);
  logger.info(`Photo added to session ${sessionId}:`, photo.type);
  return session;
}

// Set meter reading
export function setMeterReading(sessionId, type, value, source = 'manual') {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  const updates = {};
  if (type === 'before') {
    updates.meterBefore = value;
    updates.state = SESSION_STATES.BEFORE_PHOTO_UPLOADED;
  } else if (type === 'after') {
    updates.meterAfter = value;
    
    // Calculate kWh if both readings are available
    if (session.meterBefore && value) {
      const calculated = value - session.meterBefore;
      updates.kwhCalculated = Math.max(0, calculated);
    }
    
    updates.state = SESSION_STATES.AFTER_PHOTOS_UPLOADED;
  }
  
  return updateSession(sessionId, updates);
}

// Finish session
export function finishSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  return updateSession(sessionId, {
    state: SESSION_STATES.FINISHED,
    finishedAt: new Date()
  });
}

// Complete session with final calculations
export function completeSession(sessionId, tariffValue) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }
  
  if (!session.kwhCalculated || !tariffValue) {
    throw new Error('Missing kWh or tariff data for session completion');
  }
  
  const amountUah = (session.kwhCalculated * tariffValue).toFixed(2);
  
  return updateSession(sessionId, {
    state: SESSION_STATES.COMPLETED,
    tariffValue: tariffValue,
    kwhAgreed: session.kwhCalculated,
    amountUah: parseFloat(amountUah)
  });
}

// Get session by ID
export function getSession(sessionId) {
  return sessions.get(sessionId);
}

// Get all sessions for user
export function getUserSessions(ownerId, limit = 10) {
  const userSessions = Array.from(sessions.values())
    .filter(session => session.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
    
  return userSessions;
}

// Get sessions for month 
export function getSessionsForMonth(ownerId, yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  
  return Array.from(sessions.values())
    .filter(session => {
      if (session.ownerId !== ownerId) return false;
      const sessionDate = new Date(session.createdAt);
      return sessionDate.getFullYear() === year && 
             sessionDate.getMonth() === month - 1;
    })
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Calculate monthly statistics
export function getMonthlyStats(ownerId, yearMonth) {
  const monthlySessions = getSessionsForMonth(ownerId, yearMonth);
  const completedSessions = monthlySessions.filter(s => s.state === SESSION_STATES.COMPLETED);
  
  if (completedSessions.length === 0) {
    return {
      totalSessions: monthlySessions.length,
      completedSessions: 0,
      totalKwh: 0,
      totalAmount: 0,
      averageTariff: 0
    };
  }
  
  const totalKwh = completedSessions.reduce((sum, s) => sum + (s.kwhAgreed || 0), 0);
  const totalAmount = completedSessions.reduce((sum, s) => sum + (s.amountUah || 0), 0);
  const averageTariff = totalAmount / totalKwh;
  
  return {
    totalSessions: monthlySessions.length,
    completedSessions: completedSessions.length,
    totalKwh: totalKwh.toFixed(2),
    totalAmount: totalAmount.toFixed(2),
    averageTariff: averageTariff.toFixed(2)
  };
}