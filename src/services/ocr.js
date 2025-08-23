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

// Extract meter reading from OCR text with enhanced context validation
function extractMeterReading(text, context = {}) {
  logger.info(`Extracting reading from text: "${text}" with context:`, context);
  
  // Enhanced patterns for different display types
  const patterns = [
    {
      name: 'separated_digits_7',
      regex: /\b(\d\s+\d\s+\d\s+\d\s+\d\s+\d\s+\d)(?=\s*(?:KW\.?h|kw\.?h|кВт\.?год|$))/gi,
      handler: (match) => {
        const joined = match.replace(/\s+/g, '');
        // For meter readings like "0 0 5 0 7 7 3" -> "005077.3"
        if (joined.length === 7) return joined.substring(0, 6) + '.' + joined.substring(6);
        return joined;
      },
      priority: 98 // Highest priority for 7-digit separated format
    },
    {
      name: 'separated_digits_6',
      regex: /\b(\d\s+\d\s+\d\s+\d\s+\d\s+\d)(?=\s*(?:KW\.?h|kw\.?h|кВт\.?год|$))/gi,
      handler: (match) => {
        const joined = match.replace(/\s+/g, '');
        // For meter readings like "0 0 5 0 8 5" -> "005085.0" (assume .0 if no decimal)
        if (joined.length === 6) return joined + '.0';
        return joined;
      },
      priority: 95 // Very high priority for 6-digit separated format
    },
    {
      name: 'screen_kwh',
      regex: /(\d+\.\s*\d+)\s*kwh/gi,
      handler: (match) => match.replace(/\.\s+/, '.').replace(/kwh/gi, '').trim(),
      priority: 95 // Very high priority for screen readings with kWh
    },
    {
      name: 'meter_with_kwh',
      regex: /(\d{5,6})(?:[^\d]*kw\.?h)/gi,
      handler: (match) => {
        const num = match.match(/\d{5,6}/)[0];
        // Add decimal if missing for meter readings
        return num.length === 6 ? num.substring(0, 5) + '.' + num.substring(5) : num + '.0';
      },
      priority: 85 // High priority for meter readings with kWh context
    },
    {
      name: 'meter_split_decimal',
      regex: /\b(\d{5})\s*(?:--|—|\.|\s)\s*(\d)\s*(?:--|—|\s)\s*(\w)/gi,
      handler: (match) => {
        // Look for pattern like "00508 5 - W" or "00508 5 W"
        const parts = match.match(/(\d{5})\s*(?:--|—|\.|\s)\s*(\d)/);
        if (parts && parts[1] && parts[2]) {
          return parts[1] + '.' + parts[2];
        }
        return match;
      },
      priority: 97 // Very high priority for split decimal format
    },
    {
      name: 'meter_6digits_with_nearby',
      regex: /\b(\d{6})\s*(?:--|—|\.)\s*(\d)/gi,
      handler: (match) => {
        const parts = match.match(/(\d{6})\s*(?:--|—|\.)\s*(\d)/);
        if (parts && parts[1] && parts[2]) {
          return parts[1].substring(0, 5) + '.' + parts[2];
        }
        return match;
      },
      priority: 95 // Very high priority for 6-digit with nearby decimal
    },
    {
      name: 'meter_6digits_exact',
      regex: /\b(\d{6})(?=\s*(?:--|—|KW\.?h|kw\.?h|Wh|wh|кВт\.?год))/gi,
      handler: (match) => {
        // For 6-digit meter readings like "005085" -> "005085.0"
        if (match.length === 6) return match.substring(0, 5) + '.' + match.substring(5);
        return match + '.0';
      },
      priority: 90 // High priority for exact 6-digit meter format
    },
    {
      name: 'meter_with_nearby_decimal',
      regex: /\b(\d{6})\s*(?:--|—|\s+)\s*(\d)\b/gi,
      handler: (match) => {
        // Handle cases like "005085 -- 1" or "005085 1" where decimal digit is separated
        const parts = match.match(/(\d{6})\s*(?:--|—|\s+)\s*(\d)/);
        if (parts && parts[1] && parts[2]) {
          // Convert to proper decimal format: "005085" + "1" -> "005085.1"
          return parts[1].substring(0, 5) + '.' + parts[2];
        }
        return match;
      },
      priority: 96 // Very high priority for this specific meter format issue
    },
    {
      name: 'standard_meter',
      regex: /(\d{5,6}(?:[.,]\d{1,2})?)/g,
      handler: (match) => match.replace(',', '.'),
      priority: 70 // Medium priority for standard format
    },
    {
      name: 'screen_decimal', 
      regex: /(\d{1,2}[.,]\d{1,2})/g,
      handler: (match) => match.replace(',', '.'),
      priority: 60 // Lower priority, many false positives
    }
  ];
  
  let bestMatch = null;
  let bestConfidence = 0;
  let bestMethod = '';
  
  for (const pattern of patterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      logger.info(`Pattern '${pattern.name}' found matches:`, matches);
      
      for (const match of matches) {
        try {
          const processed = pattern.handler(match);
          const numValue = parseFloat(processed);
          
          if (isNaN(numValue)) continue;
          
          // Enhanced validation with context awareness
          let isValid = false;
          let confidence = pattern.priority;
          
          // Determine if this looks like a meter reading or screen reading
          const isMeterReading = numValue >= 1000 && numValue <= 999999;
          const isScreenReading = numValue >= 0.1 && numValue <= 50;
          
          // Context-based validation
          if (context.expectedType === 'ДО' || context.expectedType === 'ПІСЛЯ') {
            if (isMeterReading) {
              isValid = true;
              confidence += 20;
            }
          } else if (context.expectedType === 'ЕКРАН') {
            if (isScreenReading) {
              isValid = true;
              confidence += 25;
            }
          } else {
            // No context - accept both types but with lower confidence
            if (isMeterReading || isScreenReading) {
              isValid = true;
            }
          }
          
          // Pattern-specific bonuses
          if (pattern.name === 'separated_digits' && isMeterReading) confidence += 15;
          if (pattern.name.includes('kwh') && isScreenReading) confidence += 20;
          if (match.toLowerCase().includes('kwh')) confidence += 10;
          
          // Previous reading context bonus
          if (context.previousReading && isMeterReading) {
            const diff = Math.abs(numValue - parseFloat(context.previousReading));
            if (diff <= 50) confidence += 25; // Reasonable progression
          }
          
          logger.info(`  Match: "${match}" -> "${processed}" -> ${numValue} (valid: ${isValid}, confidence: ${confidence})`);
          
          if (isValid && confidence > bestConfidence) {
            bestMatch = numValue >= 100 ? numValue.toFixed(1) : numValue.toFixed(2);
            bestConfidence = confidence;
            bestMethod = pattern.name;
          }
        } catch (error) {
          logger.warn(`Error processing match "${match}": ${error.message}`);
        }
      }
    }
  }
  
  logger.info(`Best reading extracted: ${bestMatch} (confidence: ${bestConfidence}, method: ${bestMethod})`);
  
  // Post-processing: context-based decimal correction
  if (context && context.previousReading && bestMatch) {
    const previousValue = parseFloat(context.previousReading);
    const currentValue = parseFloat(bestMatch);
    
    if (!isNaN(previousValue) && !isNaN(currentValue)) {
      const difference = currentValue - previousValue;
      
      // Special case: if we have a whole number reading that should likely have a decimal
      // and the difference suggests a missing decimal digit
      if (bestMatch.toString().endsWith('.0')) {
        // Try adding 0.1 to see if it makes more sense
        const correctedValue = currentValue + 0.1;
        const correctedDifference = correctedValue - previousValue;
        
        // Check if the corrected difference is more reasonable (0.1-50 kWh range)
        if (correctedDifference >= 0.1 && correctedDifference <= 50 && 
            correctedDifference > difference && 
            bestMethod === 'standard_meter') {  // Only apply to standard_meter patterns that might miss decimals
          logger.info(`Context-based decimal correction applied: ${currentValue} -> ${correctedValue} (diff: ${difference.toFixed(1)} -> ${correctedDifference.toFixed(1)})`);
          bestMatch = correctedValue.toFixed(1);
          bestMethod += '_context_corrected';
        }
      }
    }
  }
  
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