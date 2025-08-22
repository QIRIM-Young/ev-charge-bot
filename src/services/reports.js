import PDFDocument from 'pdfkit';
import { createObjectCsvStringifier } from 'csv-writer';
import { logger } from '../utils/logger.js';
import { getSessionsForMonth, getMonthlyStats } from './sessiondb.js';
import fs from 'fs';
import path from 'path';

// Generate monthly report in PDF format
export async function generateMonthlyPDF(ownerId, yearMonth) {
  try {
    const sessions = await getSessionsForMonth(ownerId, yearMonth);
    const stats = await getMonthlyStats(ownerId, yearMonth);
    
    // Create PDF document
    const doc = new PDFDocument({ margin: 50 });
    
    // Title
    doc.fontSize(20)
       .text('Звіт про витрати на електроенергію для зарядки електромобіля', 50, 50);
    
    doc.fontSize(14)
       .text(`Період: ${yearMonth}`, 50, 80)
       .text(`Дата створення: ${new Date().toLocaleDateString('uk-UA')}`, 50, 100);
    
    // Summary statistics
    doc.fontSize(16)
       .text('Загальна статистика', 50, 140);
    
    doc.fontSize(12)
       .text(`Загальна кількість сесій зарядки: ${stats.totalSessions}`, 70, 170)
       .text(`Завершених сесій: ${stats.completedSessions}`, 70, 190)
       .text(`Загальна кількість спожитої електроенергії: ${stats.totalKwh} кВт·год`, 70, 210)
       .text(`Загальна сума до сплати: ${stats.totalAmount} грн`, 70, 230)
       .text(`Середній тариф: ${stats.averageTariff} грн/кВт·год`, 70, 250);
    
    // Sessions table
    if (sessions.length > 0) {
      doc.fontSize(16)
         .text('Детальний перелік сесій зарядки', 50, 290);
      
      let yPosition = 320;
      
      // Table headers
      doc.fontSize(10)
         .text('Дата/час', 60, yPosition)
         .text('ДО (кВт·год)', 140, yPosition)
         .text('ПІСЛЯ (кВт·год)', 220, yPosition)
         .text('Спожито (кВт·год)', 310, yPosition)
         .text('Сума (грн)', 410, yPosition)
         .text('Статус', 480, yPosition);
      
      yPosition += 20;
      
      // Draw line under headers
      doc.moveTo(50, yPosition)
         .lineTo(550, yPosition)
         .stroke();
      
      yPosition += 10;
      
      // Session rows
      for (const session of sessions) {
        if (yPosition > 750) {
          doc.addPage();
          yPosition = 50;
        }
        
        const startDate = new Date(session.startedAt).toLocaleDateString('uk-UA');
        const startTime = new Date(session.startedAt).toLocaleTimeString('uk-UA', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });
        
        doc.fontSize(9)
           .text(`${startDate} ${startTime}`, 60, yPosition)
           .text(session.meterBefore?.toFixed(2) || '-', 140, yPosition)
           .text(session.meterAfter?.toFixed(2) || '-', 220, yPosition)
           .text(session.kwhCalculated?.toFixed(2) || '-', 310, yPosition)
           .text(session.amountUah?.toFixed(2) || '-', 410, yPosition)
           .text(session.state === 'completed' ? '✅' : '⏳', 480, yPosition);
        
        yPosition += 15;
      }
    }
    
    // Footer
    doc.fontSize(8)
       .text('🤖 Згенеровано автоматично системою обліку зарядки електромобіля', 50, 750)
       .text('📧 Додаткові питання: eldar@example.com', 50, 765);
    
    // End document and return buffer
    return new Promise((resolve, reject) => {
      const chunks = [];
      
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        logger.info(`PDF report generated for ${ownerId}, period ${yearMonth}`);
        resolve(pdfBuffer);
      });
      doc.on('error', reject);
      
      doc.end();
    });
    
  } catch (error) {
    logger.error('Error generating PDF report:', error);
    throw error;
  }
}

// Generate monthly report in CSV format
export async function generateMonthlyCSV(ownerId, yearMonth) {
  try {
    const sessions = await getSessionsForMonth(ownerId, yearMonth);
    const stats = await getMonthlyStats(ownerId, yearMonth);
    
    // CSV header with metadata as first rows
    const metadataRows = [
      ['Звіт про витрати на електроенергію для зарядки електромобіля'],
      [`Період: ${yearMonth}`],
      [`Дата створення: ${new Date().toLocaleDateString('uk-UA')}`],
      [''],
      ['Загальна статистика'],
      [`Загальна кількість сесій зарядки: ${stats.totalSessions}`],
      [`Завершених сесій: ${stats.completedSessions}`],
      [`Загальна кількість спожитої електроенергії: ${stats.totalKwh} кВт·год`],
      [`Загальна сума до сплати: ${stats.totalAmount} грн`],
      [`Середній тариф: ${stats.averageTariff} грн/кВт·год`],
      [''],
      ['Детальний перелік сесій зарядки'],
      ['']
    ];
    
    // Session data in CSV format
    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: 'date', title: 'Дата' },
        { id: 'time', title: 'Час' },
        { id: 'meterBefore', title: 'Показник ДО (кВт·год)' },
        { id: 'meterAfter', title: 'Показник ПІСЛЯ (кВт·год)' },
        { id: 'kwhUsed', title: 'Спожито (кВт·год)' },
        { id: 'tariff', title: 'Тариф (грн/кВт·год)' },
        { id: 'amount', title: 'Сума (грн)' },
        { id: 'status', title: 'Статус' }
      ]
    });
    
    const sessionData = sessions.map(session => ({
      date: new Date(session.startedAt).toLocaleDateString('uk-UA'),
      time: new Date(session.startedAt).toLocaleTimeString('uk-UA', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      meterBefore: session.meterBefore?.toFixed(2) || '',
      meterAfter: session.meterAfter?.toFixed(2) || '',
      kwhUsed: session.kwhCalculated?.toFixed(2) || '',
      tariff: session.tariffValue?.toFixed(2) || '',
      amount: session.amountUah?.toFixed(2) || '',
      status: session.state === 'completed' ? 'Завершено' : 'В процесі'
    }));
    
    // Create clean CSV format
    const metadataText = metadataRows.map(row => row.join(',')).join('\n');
    const csvDataPart = csvStringifier.getHeaderString() + 
                       csvStringifier.stringifyRecords(sessionData);
    
    const csvContent = metadataText + '\n\n' + csvDataPart;
    
    // Add BOM for proper UTF-8 encoding in Excel
    const utf8BOM = '\uFEFF';
    const finalContent = utf8BOM + csvContent;
    
    logger.info(`CSV report generated for ${ownerId}, period ${yearMonth}`);
    return Buffer.from(finalContent, 'utf8');
    
  } catch (error) {
    logger.error('Error generating CSV report:', error);
    throw error;
  }
}

// Generate simple text summary report
export async function generateMonthlySummary(ownerId, yearMonth) {
  try {
    const stats = await getMonthlyStats(ownerId, yearMonth);
    
    const summary = `📊 <b>Звіт за ${yearMonth}</b>\n\n` +
      `🔋 Сесій зарядки: ${stats.totalSessions}\n` +
      `✅ Завершено: ${stats.completedSessions}\n` +
      `⚡ Спожито: <b>${stats.totalKwh}</b> кВт·год\n` +
      `💰 До сплати: <b>${stats.totalAmount}</b> грн\n` +
      `💴 Середній тариф: ${stats.averageTariff} грн/кВт·год\n\n` +
      `📅 Згенеровано: ${new Date().toLocaleString('uk-UA')}`;
    
    logger.info(`Summary report generated for ${ownerId}, period ${yearMonth}`);
    return summary;
    
  } catch (error) {
    logger.error('Error generating summary report:', error);
    throw error;
  }
}

// Save report to temporary file and return file path
export async function saveReportToFile(buffer, filename) {
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    
    // Ensure temp directory exists
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, buffer);
    
    logger.info(`Report saved to file: ${filePath}`);
    return filePath;
    
  } catch (error) {
    logger.error('Error saving report to file:', error);
    throw error;
  }
}

// Clean up temporary files
export function cleanupTempFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Temporary file cleaned up: ${filePath}`);
    }
  } catch (error) {
    logger.error('Error cleaning up temporary file:', error);
  }
}

// Get available report months for user
export async function getAvailableReportMonths(ownerId) {
  try {
    // For now, we'll return the current month and previous 6 months
    const months = [];
    const now = new Date();
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = date.toISOString().slice(0, 7);
      months.push({
        yearMonth,
        displayName: date.toLocaleDateString('uk-UA', { 
          year: 'numeric', 
          month: 'long' 
        })
      });
    }
    
    return months;
    
  } catch (error) {
    logger.error('Error getting available report months:', error);
    throw error;
  }
}