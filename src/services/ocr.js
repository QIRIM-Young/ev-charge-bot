import { createWorker } from 'tesseract.js';
import tesseract from 'node-tesseract-ocr';
import { logger } from '../utils/logger.js';
import sharp from 'sharp';

let worker = null;

// Initialize Tesseract worker
async function initOCR() {
  if (!worker) {
    try {
      logger.info('Initializing Tesseract OCR worker...');
      worker = await createWorker('ukr');
      logger.info('Tesseract OCR worker initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize OCR worker:', error);
      throw error;
    }
  }
  return worker;
}

// Enhanced OCR for utility meters with number-only recognition
export async function processUtilityMeterOCR(imageBuffer, options = {}) {
  try {
    logger.info('Starting utility meter OCR processing...');
    
    // Convert HEIC/HEIF to JPG using Sharp with enhanced preprocessing for meters
    let processedBuffer = imageBuffer;
    try {
      logger.info('Converting image format for OCR compatibility...');
      processedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 95 })
        .grayscale() // Convert to grayscale for better contrast
        .normalize() // Normalize contrast
        .sharpen() // Sharpen for better digit recognition
        .toBuffer();
      logger.info('Image converted and enhanced successfully');
    } catch (conversionError) {
      logger.warn('Image conversion failed, trying original:', conversionError.message);
    }
    
    // DISABLED: node-tesseract-ocr causes crashes - fallback immediately to tesseract.js
    logger.warn('node-tesseract-ocr disabled due to stability issues, using enhanced tesseract.js');
    throw new Error('node-tesseract-ocr disabled - using fallback');
    
  } catch (error) {
    logger.error('Utility meter OCR processing failed:', error);
    
    // Enhanced Tesseract.js fallback with number-focused configuration
    logger.info('Using enhanced Tesseract.js OCR with number focus...');
    return processImageOCREnhanced(imageBuffer, options);
  }
}

// Enhanced version of regular OCR with better preprocessing for meters
async function processImageOCREnhanced(imageBuffer, options = {}) {
  try {
    const ocrWorker = await initOCR();
    
    logger.info('Starting enhanced OCR processing for utility meters...');
    
    // Convert HEIC/HEIF to JPG using Sharp with meter-specific enhancements
    let processedBuffer = imageBuffer;
    try {
      logger.info('Converting image format for OCR compatibility...');
      processedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 95 })
        .grayscale() // Convert to grayscale
        .normalize() // Normalize contrast  
        .sharpen() // Sharpen for digit clarity
        .toBuffer();
      logger.info('Image converted and enhanced successfully');
    } catch (conversionError) {
      logger.warn('Image conversion failed, trying original:', conversionError.message);
      // If conversion fails, try original buffer
    }
    
    // Set enhanced parameters for number recognition
    await ocrWorker.setParameters({
      tessedit_char_whitelist: '0123456789.,-', // Only digits and separators
      tessedit_pageseg_mode: '6', // Uniform block of text
      preserve_interword_spaces: '0'
    });
    
    const { data } = await ocrWorker.recognize(processedBuffer);
    
    logger.info(`Enhanced OCR completed. Confidence: ${data.confidence}%`);
    logger.info(`Raw text: ${data.text}`);
    
    // Extract meter readings from text
    const reading = extractMeterReading(data.text, options.context);
    
    return {
      success: true,
      rawText: data.text,
      confidence: data.confidence,
      reading: reading,
      method: 'enhanced-tesseract',
      words: data.words
    };
    
  } catch (error) {
    logger.error('Enhanced OCR processing failed:', error);
    return {
      success: false,
      error: error.message,
      reading: null,
      method: 'enhanced-tesseract-failed'
    };
  }
}

// Process image and extract text
export async function processImageOCR(imageBuffer, options = {}) {
  try {
    const ocrWorker = await initOCR();
    
    logger.info('Starting OCR processing...');
    
    // Convert HEIC/HEIF to JPG using Sharp
    let processedBuffer = imageBuffer;
    try {
      logger.info('Converting image format for OCR compatibility...');
      processedBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 90 })
        .toBuffer();
      logger.info('Image converted successfully');
    } catch (conversionError) {
      logger.warn('Image conversion failed, trying original:', conversionError.message);
      // If conversion fails, try original buffer
    }
    
    const { data } = await ocrWorker.recognize(processedBuffer);
    
    logger.info(`OCR completed. Confidence: ${data.confidence}%`);
    logger.info(`Raw text: ${data.text}`);
    
    // Extract meter readings from text
    const reading = extractMeterReading(data.text, options.context);
    
    return {
      success: true,
      rawText: data.text,
      confidence: data.confidence,
      reading: reading,
      words: data.words
    };
    
  } catch (error) {
    logger.error('OCR processing failed:', error);
    return {
      success: false,
      error: error.message,
      reading: null
    };
  }
}

// Extract meter reading from OCR text with context validation
function extractMeterReading(text, context = {}) {
  // Enhanced patterns for different display types
  const patterns = [
    // Standard meter format: 12345.67 or 12345,67 (white on black)
    /(\d{4,6}[.,]\d{1,2})/g,
    // Screen display format: small numbers like 6.07, 9.45 (white on blue)
    /(\d{1,2}[.,]\d{1,2})/g,
    // Large integers without decimals: 123456
    /(\d{5,6})/g,
    // With spaces: 12 345.67 or 12 345,67  
    /(\d{2,3}\s\d{3}[.,]\d{1,2})/g,
    // Alternative: 12345 67
    /(\d{4,6}\s\d{1,2})/g,
    // Very precise decimals: 1234.567
    /(\d{4,6}[.,]\d{1,3})/g
  ];
  
  let bestMatch = null;
  let bestConfidence = 0;
  
  for (const pattern of patterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        // Clean and normalize the reading
        const cleanMatch = match.replace(/\s/g, '').replace(',', '.');
        const numValue = parseFloat(cleanMatch);
        
        // Enhanced validation for different types of displays with context
        let isValid = false;
        let contextBonus = 0;
        
        // Context-aware validation
        if (context.previousReading) {
          const prevReading = parseFloat(context.previousReading);
          const diff = Math.abs(numValue - prevReading);
          
          // For meter readings, expect reasonable progression (0-50 kWh per session)
          if (numValue >= 1000 && numValue <= 999999) {
            if (diff >= 0 && diff <= 50) {
              isValid = true;
              contextBonus = 30; // Strong context match
            } else if (diff <= 100) {
              isValid = true;
              contextBonus = 10; // Possible but less likely
            }
          }
        } else {
          // Fallback to original validation when no context
          if (numValue >= 1000 && numValue <= 999999) {
            // Large numbers: meter readings
            isValid = true;
          } else if (numValue >= 0.1 && numValue <= 50) {
            // Small numbers: screen readings (kWh consumed)
            isValid = true;
          }
        }
        
        if (isValid) {
          const confidence = calculateReadingConfidence(match, text, numValue) + contextBonus;
          if (confidence > bestConfidence) {
            bestMatch = numValue >= 100 ? numValue.toFixed(1) : numValue.toFixed(2);
            bestConfidence = confidence;
          }
        }
      }
    }
  }
  
  logger.info(`Best reading extracted: ${bestMatch} (confidence: ${bestConfidence})`);
  return bestMatch;
}

// Calculate confidence for meter reading
function calculateReadingConfidence(match, fullText, numValue) {
  let confidence = 50; // Base confidence
  
  // Higher confidence for certain contexts
  if (fullText.toLowerCase().includes('квт')) confidence += 20;
  if (fullText.toLowerCase().includes('kwh')) confidence += 20;
  if (fullText.toLowerCase().includes('показани')) confidence += 15;
  if (fullText.toLowerCase().includes('лічильник')) confidence += 15;
  
  // Format bonuses
  if (match.includes('.') || match.includes(',')) confidence += 10;
  if (match.length >= 6) confidence += 10;
  
  return Math.min(confidence, 100);
}

// Cleanup worker
export async function cleanupOCR() {
  if (worker) {
    try {
      await worker.terminate();
      worker = null;
      logger.info('OCR worker terminated');
    } catch (error) {
      logger.error('Error terminating OCR worker:', error);
    }
  }
}

// Handle process shutdown
process.on('SIGINT', cleanupOCR);
process.on('SIGTERM', cleanupOCR);