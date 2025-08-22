import { createWorker } from 'tesseract.js';
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { ApiKeyCredentials } from '@azure/ms-rest-js';
import { logger } from '../utils/logger.js';
import sharp from 'sharp';

let worker = null;
let azureVisionClient = null;

// Initialize Azure Computer Vision client
function initAzureVision() {
  if (!azureVisionClient && process.env.AZURE_VISION_KEY && process.env.AZURE_VISION_ENDPOINT) {
    try {
      logger.info('Initializing Azure Computer Vision client...');
      azureVisionClient = new ComputerVisionClient(
        new ApiKeyCredentials({ inHeader: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_VISION_KEY } }), 
        process.env.AZURE_VISION_ENDPOINT
      );
      logger.info('Azure Computer Vision client initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize Azure Vision client:', error);
      return false;
    }
  }
  return !!azureVisionClient;
}

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

// Enhanced OCR for utility meters with Azure AI and Tesseract fallback
export async function processUtilityMeterOCR(imageBuffer, options = {}) {
  try {
    logger.info('Starting utility meter OCR processing...');
    
    // Try Azure Computer Vision first if available
    if (initAzureVision()) {
      try {
        logger.info('Using Azure Computer Vision OCR for enhanced accuracy...');
        const azureResult = await processAzureVisionOCR(imageBuffer, options);
        if (azureResult.success && azureResult.reading) {
          logger.info(`Azure OCR successful: ${azureResult.reading}`);
          return azureResult;
        }
        logger.warn('Azure OCR did not return valid reading, falling back to Tesseract...');
      } catch (azureError) {
        logger.error('Azure OCR failed:', azureError.message);
        logger.info('Falling back to Tesseract OCR...');
      }
    } else {
      logger.info('Azure Computer Vision not configured, using Tesseract OCR...');
    }
    
    // Enhanced Tesseract.js fallback with number-focused configuration
    logger.info('Using enhanced Tesseract.js OCR with number focus...');
    return processImageOCREnhanced(imageBuffer, options);
    
  } catch (error) {
    logger.error('Utility meter OCR processing failed:', error);
    return {
      success: false,
      error: error.message,
      reading: null,
      method: 'ocr-failed'
    };
  }
}

// Process OCR using Azure Computer Vision
async function processAzureVisionOCR(imageBuffer, options = {}) {
  try {
    if (!azureVisionClient) {
      throw new Error('Azure Vision client not initialized');
    }
    
    logger.info('Starting Azure Computer Vision OCR...');
    
    // Convert image to base64 data URL for Azure API
    const base64Image = imageBuffer.toString('base64');
    const imageStream = Buffer.from(base64Image, 'base64');
    
    // Use Read API for better accuracy on printed text
    const readResult = await azureVisionClient.readInStream(imageStream);
    const operationId = readResult.operationLocation.split('/').slice(-1)[0];
    
    // Wait for the read operation to complete
    let result;
    let status = 'running';
    let attempts = 0;
    const maxAttempts = 10;
    
    while (status === 'running' || status === 'notStarted') {
      if (attempts >= maxAttempts) {
        throw new Error('Azure OCR timeout - operation took too long');
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      result = await azureVisionClient.getReadResult(operationId);
      status = result.status;
      attempts++;
      logger.info(`Azure OCR status: ${status} (attempt ${attempts})`);
    }
    
    if (status === 'failed') {
      throw new Error('Azure OCR operation failed');
    }
    
    // Extract text from results
    let fullText = '';
    let confidence = 0;
    let wordCount = 0;
    
    if (result.analyzeResult && result.analyzeResult.readResults) {
      for (const page of result.analyzeResult.readResults) {
        for (const line of page.lines) {
          fullText += line.text + ' ';
          // Calculate average confidence from words
          for (const word of line.words) {
            confidence += word.confidence;
            wordCount++;
          }
        }
      }
    }
    
    const avgConfidence = wordCount > 0 ? (confidence / wordCount) * 100 : 0;
    
    logger.info(`Azure OCR completed. Average confidence: ${avgConfidence.toFixed(1)}%`);
    logger.info(`Azure OCR raw text: ${fullText.trim()}`);
    
    // Extract meter reading using the same logic as Tesseract
    const reading = extractMeterReading(fullText.trim(), options.context);
    
    return {
      success: true,
      rawText: fullText.trim(),
      confidence: avgConfidence,
      reading: reading,
      method: 'azure-computer-vision',
      operationId: operationId
    };
    
  } catch (error) {
    logger.error('Azure Computer Vision OCR failed:', error);
    return {
      success: false,
      error: error.message,
      reading: null,
      method: 'azure-computer-vision-failed'
    };
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