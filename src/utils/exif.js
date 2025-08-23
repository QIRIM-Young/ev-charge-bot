// EXIF timestamp extraction and photo ordering utilities
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { logger } from './logger.js';

/**
 * Parse EXIF timestamp from buffer
 * @param {Buffer} exifBuffer - EXIF data buffer
 * @returns {Date|null} - Parsed timestamp or null
 */
export function parseExifTimestamp(exifBuffer) {
  try {
    const tags = exifReader(exifBuffer);
    
    // Look for common timestamp fields
    const dateTimeOriginal = tags.exif?.DateTimeOriginal || tags.image?.DateTime;
    const createDate = tags.exif?.CreateDate;
    const modifyDate = tags.image?.ModifyDate;
    
    logger.debug('EXIF timestamps found:', { dateTimeOriginal, createDate, modifyDate });
    
    // Return the best timestamp available
    const bestTimestamp = dateTimeOriginal || createDate || modifyDate;
    
    if (bestTimestamp) {
      // Convert EXIF timestamp to Date object
      if (typeof bestTimestamp === 'string') {
        // Format: "2025:08:06 17:45:07"
        const dateStr = bestTimestamp.replace(/:/g, '-', 2).replace(/ /, 'T');
        return new Date(dateStr);
      }
      return bestTimestamp;
    }
    
    return null;
  } catch (error) {
    logger.debug('EXIF parsing failed:', error.message);
    return null;
  }
}

/**
 * Parse timestamp from filename
 * @param {string} filename - Image filename
 * @returns {Date|null} - Parsed timestamp or null
 */
export function parseFilenameTimestamp(filename) {
  const match = filename.match(/(\d{8}_\d{6})/);
  if (match) {
    const timestamp = match[1]; // "20250806_174507"
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const hour = timestamp.substring(9, 11);
    const minute = timestamp.substring(11, 13);
    const second = timestamp.substring(13, 15);
    
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
  }
  return null;
}

/**
 * Extract timestamp from image using EXIF data or filename
 * @param {Buffer} imageBuffer - Image buffer
 * @param {string} filename - Image filename
 * @returns {Object} - Timestamp extraction result
 */
export async function extractImageTimestamp(imageBuffer, filename) {
  let photoTimestamp = null;
  let timestampSource = 'none';
  
  try {
    // Try to extract EXIF using Sharp
    const metadata = await sharp(imageBuffer).metadata();
    
    if (metadata.exif) {
      logger.debug('EXIF buffer available, parsing timestamps...');
      photoTimestamp = parseExifTimestamp(metadata.exif);
      if (photoTimestamp) {
        timestampSource = 'exif';
      }
    }
    
  } catch (sharpError) {
    logger.debug('Sharp metadata extraction failed:', sharpError.message);
  }
  
  // Fallback to filename if EXIF failed
  if (!photoTimestamp && filename) {
    logger.debug('Falling back to filename parsing...');
    photoTimestamp = parseFilenameTimestamp(filename);
    if (photoTimestamp) {
      timestampSource = 'filename';
    }
  }
  
  return {
    timestamp: photoTimestamp,
    source: timestampSource,
    success: !!photoTimestamp
  };
}

/**
 * Determine expected photo type based on timestamp order
 * @param {Array} photoMetas - Array of photo metadata with timestamps
 * @returns {Array} - Array of photo types in chronological order
 */
export function determinePhotoOrder(photoMetas) {
  if (photoMetas.length === 0) return [];
  
  // Sort photos by timestamp
  const sortedPhotos = [...photoMetas].sort((a, b) => {
    if (!a.timestamp || !b.timestamp) return 0;
    return a.timestamp - b.timestamp;
  });
  
  // Expected workflow: ДО → ЕКРАН → ПІСЛЯ
  const expectedTypes = ['ДО', 'ЕКРАН', 'ПІСЛЯ'];
  
  // Map chronological order to expected types
  return sortedPhotos.map((photo, index) => {
    if (index < expectedTypes.length) {
      return {
        ...photo,
        expectedType: expectedTypes[index],
        chronologicalIndex: index
      };
    }
    return {
      ...photo,
      expectedType: 'ДОДАТКОВЕ',
      chronologicalIndex: index
    };
  });
}

/**
 * Validate if photo order matches expected charging workflow
 * @param {Array} orderedPhotos - Photos in chronological order with expected types
 * @returns {Object} - Validation result
 */
export function validatePhotoWorkflow(orderedPhotos) {
  const expectedSequence = ['ДО', 'ЕКРАН', 'ПІСЛЯ'];
  const actualSequence = orderedPhotos.map(p => p.expectedType);
  
  const isCorrectOrder = JSON.stringify(actualSequence.slice(0, 3)) === JSON.stringify(expectedSequence);
  
  return {
    isValid: isCorrectOrder,
    expected: expectedSequence,
    actual: actualSequence,
    confidence: isCorrectOrder ? 'HIGH' : 'LOW',
    canAutoCorrect: orderedPhotos.every(p => p.timestamp) && orderedPhotos.length <= 3
  };
}

/**
 * Smart photo type detection based on timestamp and session state
 * @param {Object} sessionState - Current session state
 * @param {Date} photoTimestamp - Photo timestamp
 * @param {Array} existingPhotos - Existing photos with timestamps
 * @returns {string} - Detected photo type ('ДО', 'ЕКРАН', 'ПІСЛЯ')
 */
export function smartDetectPhotoType(sessionState, photoTimestamp, existingPhotos = []) {
  // If no timestamp, fallback to session state logic
  if (!photoTimestamp) {
    if (sessionState.state === 'started') return 'ДО';
    if (!sessionState.meterAfter) return 'ПІСЛЯ';
    return 'ЕКРАН';
  }
  
  // If this is the first photo, it's ДО
  if (existingPhotos.length === 0) {
    return 'ДО';
  }
  
  // Sort all photos including current one by timestamp
  const allPhotos = [...existingPhotos, { timestamp: photoTimestamp }];
  const sortedPhotos = allPhotos.sort((a, b) => a.timestamp - b.timestamp);
  
  // Find current photo position
  const currentIndex = sortedPhotos.findIndex(p => p.timestamp === photoTimestamp);
  
  // Map position to expected type
  const typeMapping = ['ДО', 'ЕКРАН', 'ПІСЛЯ'];
  return typeMapping[currentIndex] || 'ДОДАТКОВЕ';
}