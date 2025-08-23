import { logger } from '../../utils/logger.js';
import { InputFile } from 'grammy';
import { normalizePhone, isPhoneAllowed, addNeighbor } from '../../services/auth.js';
import { processImageOCR, processUtilityMeterOCR } from '../../services/ocr.js';
import { extractImageTimestamp, smartDetectPhotoType, validatePhotoWorkflow } from '../../utils/exif.js';
import { 
  createSession, 
  getActiveSession, 
  updateSession, 
  addPhotoToSession, 
  setMeterReading, 
  finishSession, 
  completeSession,
  SESSION_STATES 
} from '../../services/sessiondb.js';

export function setupHandlers(bot) {
  // Handle contact sharing for authorization
  bot.on('message:contact', async (ctx) => {
    const contact = ctx.message.contact;
    const userId = ctx.from.id;
    
    if (!contact) {
      return ctx.reply('❌ Не вдалося отримати контактні дані.');
    }

    // Check if it's user's own contact
    if (contact.user_id !== userId) {
      return ctx.reply('❌ Будь ласка, поділіться своїм власним контактом.');
    }

    const phoneE164 = normalizePhone(contact.phone_number);
    
    if (!phoneE164) {
      return ctx.reply('❌ Невірний формат номера телефону.');
    }

    // Check if phone is in allowed list
    if (!isPhoneAllowed(phoneE164)) {
      logger.warn(`Unauthorized phone attempt: ${phoneE164} from user ${userId}`);
      return ctx.reply(
        '❌ Ваш номер телефону не знайдено в списку дозволених користувачів.\n\n' +
        'Зверніться до власника для додавання вашого номера до системи.'
      );
    }

    try {
      // Add neighbor to database
      const displayName = contact.first_name + (contact.last_name ? ` ${contact.last_name}` : '');
      const neighbor = await addNeighbor(displayName, phoneE164, userId);
      
      logger.info(`Neighbor authorized: ${displayName} (${phoneE164})`);
      
      await ctx.reply(
        `✅ Авторизація успішна!\n\n` +
        `Привіт, ${displayName}! Тепер ви можете переглядати звіти та підтверджувати витрати на електроенергію.\n\n` +
        'Доступні команди:\n' +
        '👀 /view YYYY-MM - Переглянути звіт\n' +
        '✅ /confirm YYYY-MM - Підтвердити звіт',
        {
          reply_markup: {
            keyboard: [
              [{ text: '👀 Переглянути звіт' }],
              [{ text: '✅ Підтвердити звіт' }]
            ],
            resize_keyboard: true
          }
        }
      );

    } catch (error) {
      logger.error('Failed to authorize neighbor:', error);
      await ctx.reply('❌ Виникла помилка при авторизації. Спробуйте ще раз.');
    }
  });

  // Handle photo uploads (documents)
  bot.on('message:document', async (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Завантаження фото доступне тільки власнику.');
    }

    const document = ctx.message.document;
    
    // Check if it's an image (including HEIC)
    const imageTypes = ['image/', 'image/heic', 'image/heif'];
    const isImage = imageTypes.some(type => document.mime_type?.startsWith(type));
    
    if (!isImage) {
      return ctx.reply('❌ Будь ласка, надішліть зображення.');
    }
    
    // HEIC/HEIF format is now supported via Azure Computer Vision
    let heicFormat = false;
    if (document.mime_type === 'image/heic' || document.mime_type === 'image/heif') {
      heicFormat = true;
      logger.info(`Processing HEIC format image: ${document.file_name}`);
    }

    await ctx.reply(
      `📸 <b>Фото отримано!</b>\n\n` +
      `📄 Файл: ${document.file_name || 'image'}\n` +
      `📊 Розмір: ${(document.file_size / 1024 / 1024).toFixed(2)} МБ\n\n` +
      `🔄 Обробляю зображення та розпізнаю показники лічильника...\n\n` +
      `⏳ Це може зайняти кілька секунд.`,
      { parse_mode: 'HTML' }
    );

    try {
      // Download and process image
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      
      // Download image buffer
      logger.info(`Downloading image from: ${fileUrl}`);
      const response = await fetch(fileUrl);
      const imageBuffer = await response.arrayBuffer();
      
      // Extract timestamp from image for smart ordering
      const imageBufferNode = Buffer.from(imageBuffer);
      const timestampResult = await extractImageTimestamp(imageBufferNode, document.file_name);
      
      if (timestampResult.success) {
        logger.info(`Photo timestamp extracted (${timestampResult.source}): ${timestampResult.timestamp.toLocaleString('uk-UA')}`);
      } else {
        logger.info('No timestamp found in photo, using session state for type detection');
      }
      
      // Get active session to determine photo type and choose appropriate OCR
      const activeSession = await getActiveSession(ctx.from.id);
      if (!activeSession) {
        await ctx.reply(
          '❌ <b>Немає активної сесії</b>\n\n' +
          'Почніть нову сесію з кнопки "🆕 Нова сесія"',
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Smart photo type detection using EXIF timestamps
      const existingPhotosWithTimestamps = activeSession.photos
        .filter(p => p.timestamp)
        .map(p => ({ timestamp: new Date(p.timestamp) }));
      
      const detectedPhotoType = timestampResult.success ? 
        smartDetectPhotoType(activeSession, timestampResult.timestamp, existingPhotosWithTimestamps) :
        (activeSession.state === SESSION_STATES.STARTED ? 'ДО' : 
         !activeSession.meterAfter ? 'ПІСЛЯ' : 'ЕКРАН');
      
      logger.info(`Smart photo type detection: ${detectedPhotoType}`);
      
      // Determine OCR approach based on detected type
      let isUtilityMeter = false;
      if (detectedPhotoType === 'ДО' || detectedPhotoType === 'ПІСЛЯ') {
        isUtilityMeter = true; // Utility meter photos need specialized OCR
      }
      
      // Choose appropriate OCR method with timeout
      let ocrResult;
      
      // Add timeout to prevent hanging
      const ocrTimeout = 30000; // 30 seconds timeout
      
      try {
        // Prepare context for OCR validation
        const ocrContext = {};
        if (isUtilityMeter && activeSession.meterBefore) {
          ocrContext.previousReading = activeSession.meterBefore;
          ocrContext.expectedRange = [activeSession.meterBefore, activeSession.meterBefore + 50];
        }
        
        if (isUtilityMeter) {
          logger.info('Using utility meter OCR for better number recognition');
          ocrResult = await Promise.race([
            processUtilityMeterOCR(imageBufferNode, { context: ocrContext }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('OCR timeout')), ocrTimeout)
            )
          ]);
        } else {
          logger.info('Using standard OCR');
          ocrResult = await Promise.race([
            processImageOCR(imageBufferNode, { context: ocrContext }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('OCR timeout')), ocrTimeout)
            )
          ]);
        }
      } catch (error) {
        logger.error('OCR processing failed or timed out:', error);
        ocrResult = {
          success: false,
          error: error.message,
          reading: null
        };
      }
      
      if (ocrResult.success && ocrResult.reading) {

        // Add photo to session with timestamp and detected type
        const photoMetadata = {
          type: detectedPhotoType === 'ДО' ? 'before' : 
                detectedPhotoType === 'ПІСЛЯ' ? 'after' : 'screen',
          fileId: document.file_id,
          fileName: document.file_name || 'image',
          fileSize: document.file_size,
          mimeType: document.mime_type,
          ocrResult: ocrResult,
          detectedType: detectedPhotoType,
          timestamp: timestampResult.success ? timestampResult.timestamp.toISOString() : null,
          timestampSource: timestampResult.source
        };
        
        await addPhotoToSession(activeSession.id, photoMetadata);

        // Prepare chronology info if timestamp available
        let chronologyInfo = '';
        if (timestampResult.success) {
          chronologyInfo = `\n📅 Час зйомки: ${timestampResult.timestamp.toLocaleString('uk-UA')} (${timestampResult.source})`;
          
          // Check workflow if we have multiple photos
          const updatedSession = await getActiveSession(ctx.from.id);
          if (updatedSession.photos.length > 1) {
            const photosWithTimestamps = updatedSession.photos
              .filter(p => p.timestamp)
              .map(p => ({
                timestamp: new Date(p.timestamp),
                detectedType: p.detectedType || 'НЕВІДОМО'
              }));
            
            if (photosWithTimestamps.length > 1) {
              const sortedPhotos = photosWithTimestamps.sort((a, b) => a.timestamp - b.timestamp);
              const actualOrder = sortedPhotos.map(p => p.detectedType).join(' → ');
              chronologyInfo += `\n📊 Порядок фото: ${actualOrder}`;
              
              const workflow = validatePhotoWorkflow(sortedPhotos);
              if (workflow.isValid) {
                chronologyInfo += '\n✅ Хронологія відповідає робочому процесу';
              }
            }
          }
        }
        
        await ctx.reply(
          `✅ <b>Розпізнавання завершено</b>\n\n` +
          `🆔 Сесія: #${activeSession.id}\n` +
          `📸 Тип фото: ${detectedPhotoType} (${timestampResult.success ? 'авто-визначено' : 'за станом сесії'})\n` +
          `🔢 Розпізнані показники: <b>${ocrResult.reading}</b> кВт·год\n` +
          `📊 Впевненість: ${ocrResult.confidence}%${chronologyInfo}\n\n` +
          'Чи правильно розпізнано показники?',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Так, правильно', callback_data: `confirm_reading_${ocrResult.reading}_${activeSession.id}` },
                  { text: '✏️ Редагувати', callback_data: `edit_reading_${activeSession.id}` }
                ]
              ]
            }
          }
        );
      } else {
        // Get active session for context
        const activeSession = await getActiveSession(ctx.from.id);
        const sessionInfo = activeSession ? `\n🆔 Сесія: #${activeSession.id}` : '';
        
        await ctx.reply(
          `❌ <b>Не вдалося розпізнати показники</b>${sessionInfo}\n\n` +
          `🔍 Причина: ${ocrResult.error || 'Показники не знайдено'}\n\n` +
          'Спробуйте надіслати більш чітке фото або введіть показники вручну.',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✏️ Ввести вручну', callback_data: activeSession ? `edit_reading_${activeSession.id}` : 'edit_reading' },
                  { text: '📸 Надіслати інше фото', callback_data: 'resend_as_document' }
                ]
              ]
            }
          }
        );
      }

    } catch (error) {
      logger.error('Failed to process image:', error);
      await ctx.reply('❌ Не вдалося обробити зображення. Спробуйте ще раз.');
    }
  });

  // Handle regular photos (with compression warning)
  bot.on('message:photo', async (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Завантаження фото доступне тільки власнику.');
    }

    await ctx.reply(
      '⚠️ <b>Увага: Стиснене фото</b>\n\n' +
      'Ви надіслали стиснене фото. Для кращої якості розпізнавання рекомендується надсилати фото як <b>документ</b>.\n\n' +
      'Продовжити обробку стисненого фото?',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Продовжити', callback_data: 'process_compressed' },
              { text: '📄 Надіслати як документ', callback_data: 'resend_as_document' }
            ]
          ]
        }
      }
    );
  });

  // Handle callback queries (inline buttons)
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    
    try {
      if (data === 'send_before_photo') {
        await ctx.editMessageText(
          '📸 <b>Надішліть фото лічильника ДО зарядки</b>\n\n' +
          '🔍 Переконайтеся, що показники чітко видно на фото.\n' +
          '📄 Надсилайте як документ для збереження EXIF-даних.',
          { parse_mode: 'HTML' }
        );
      } else if (data === 'send_after_photo') {
        // Check session state to determine what photo is actually needed
        const currentSession = await getActiveSession(ctx.from.id);
        if (currentSession && currentSession.kwhScreen && !currentSession.meterAfter) {
          await ctx.editMessageText(
            '📸 <b>Надішліть фото лічильника ПІСЛЯ зарядки</b>\n\n' +
            '🔍 Переконайтеся, що показники чітко видно на фото.\n' +
            '📊 Білі цифри на чорному фоні, десяті частини на червоному.',
            { parse_mode: 'HTML' }
          );
        } else {
          await ctx.editMessageText(
            '📸 <b>Надішліть фото лічильника ПІСЛЯ зарядки</b>\n\n' +
            '🔍 Переконайтеся, що показники чітко видно на фото.',
            { parse_mode: 'HTML' }
          );
        }
      } else if (data === 'send_screen_photo') {
        await ctx.editMessageText(
          '📱 <b>Надішліть фото екрана зарядної станції</b>\n\n' +
          '⚡ Має бути видно кількість спожитих кВт·год.\n' +
          '📊 Білі цифри на синьому фоні, зазвичай менше 20 кВт·год.',
          { parse_mode: 'HTML' }
        );
      } else if (data === 'complete_without_screen') {
        // Complete session without screen photo
        const activeSession = await getActiveSession(ctx.from.id);
        if (activeSession && activeSession.meterBefore && activeSession.meterAfter) {
          try {
            // Check if we have a tariff for this month to complete the session
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
            const { getTariff } = await import('../../services/tariffs.js');
            const tariff = await getTariff(currentMonth);
            
            if (tariff) {
              // Complete the session with tariff
              const completedSession = await completeSession(activeSession.id, tariff.priceUahPerKwh);
              
              await ctx.editMessageText(
                '✅ <b>Сесія завершена без фото екрана</b>\n\n' +
                `🆔 Сесія: #${completedSession.id}\n` +
                `⚡ Спожито за лічильником: ${completedSession.kwhCalculated.toFixed(2)} кВт·год\n` +
                `💰 Сума до сплати: ${completedSession.amountUah.toFixed(2)} грн\n` +
                `📊 Тариф: ${tariff.priceUahPerKwh.toFixed(2)} грн/кВт·год\n\n` +
                '✅ Сесія успішно завершена і збережена.',
                { parse_mode: 'HTML' }
              );
            } else {
              // No tariff available - can't complete
              await ctx.editMessageText(
                '❌ <b>Неможливо завершити сесію</b>\n\n' +
                `Не встановлено тариф для ${currentMonth}.\n\n` +
                `Встановіть тариф: <code>/tariff ${currentMonth} 7.41</code>\n` +
                'Після цього повторіть завершення сесії.',
                { parse_mode: 'HTML' }
              );
            }
          } catch (error) {
            logger.error('Error completing session without screen:', error);
            await ctx.reply('❌ Помилка при завершенні сесії.');
          }
        } else {
          await ctx.editMessageText(
            '❌ <b>Неможливо завершити сесію</b>\n\n' +
            'Потрібні показники лічильника ДО та ПІСЛЯ зарядки.',
            { parse_mode: 'HTML' }
          );
        }
      } else if (data.startsWith('confirm_reading_')) {
        const parts = data.replace('confirm_reading_', '').split('_');
        const reading = parts[0];
        const sessionId = parts[1] ? parseInt(parts[1]) : null;
        
        if (sessionId) {
          try {
            const session = await getActiveSession(ctx.from.id);
            if (session && session.id === sessionId) {
              // Determine reading type based on session state
              const readingType = session.state === SESSION_STATES.STARTED ? 'before' : 'after';
              
              // Set meter reading in session
              const updatedSession = await setMeterReading(sessionId, readingType, parseFloat(reading), 'ocr');
              
              let nextStepMessage = '';
              if (readingType === 'before') {
                nextStepMessage = '\n\n➡️ Наступний крок: завершіть зарядку та надішліть фото ПІСЛЯ.';
              } else if (updatedSession.meterBefore && updatedSession.meterAfter) {
                const kwhUsed = updatedSession.kwhCalculated;
                nextStepMessage = `\n\n⚡ Спожито: <b>${kwhUsed}</b> кВт·год\n➡️ Наступний крок: надішліть фото екрана зарядної станції.`;
              }
              
              await ctx.editMessageText(
                `✅ <b>Показники підтверджено</b>\n\n` +
                `🆔 Сесія: #${sessionId}\n` +
                `🔢 Збережено: <b>${reading}</b> кВт·год (${readingType === 'before' ? 'ДО' : 'ПІСЛЯ'})${nextStepMessage}`,
                { parse_mode: 'HTML' }
              );
            } else {
              throw new Error('Сесія не знайдена');
            }
          } catch (error) {
            logger.error('Error confirming reading:', error);
            await ctx.editMessageText('❌ Помилка при збереженні показників.');
          }
        } else {
          // Legacy format without session ID
          await ctx.editMessageText(
            `✅ <b>Показники підтверджено</b>\n\n` +
            `🔢 Збережено: <b>${reading}</b> кВт·год\n\n` +
            'Продовжуйте з наступним кроком процесу.',
            { parse_mode: 'HTML' }
          );
        }
      } else if (data.startsWith('edit_reading')) {
        const sessionId = data.includes('_') ? data.split('_')[2] : null;
        const sessionInfo = sessionId ? `\n🆔 Сесія: #${sessionId}` : '';
        
        await ctx.editMessageText(
          '✏️ <b>Редагування показників</b>' + sessionInfo + '\n\n' +
          'Надішліть правильні показники лічильника у форматі: <b>12345.67</b>',
          { parse_mode: 'HTML' }
        );
      } else if (data === 'process_compressed') {
        await ctx.editMessageText(
          '❌ <b>OCR для стиснених фото поки недоступний</b>\n\n' +
          'Спробуйте:\n' +
          '• Надіслати фото як документ (JPG формат)\n' +
          '• Або ввести показники вручну',
          {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✏️ Ввести вручну', callback_data: 'edit_reading' }]
              ]
            }
          }
        );
      } else if (data === 'resend_as_document') {
        await ctx.editMessageText(
          '📄 <b>Надішліть фото як документ</b>\n\n' +
          '1. Натисніть кнопку прикріплення (📎)\n' +
          '2. Виберіть "Файл" замість "Фото"\n' +
          '3. Оберіть зображення з галереї\n' +
          '4. Надішліть як документ',
          { parse_mode: 'HTML' }
        );
      } else if (data.startsWith('confirm_meter_after_') || data.startsWith('confirm_screen_')) {
        await handleReadingTypeConfirmation(ctx, data);
      } else if (data.startsWith('report_')) {
        await handleReportCallback(ctx, data);
      } else if (data === 'continue_session') {
        const activeSession = await getActiveSession(ctx.from.id);
        if (activeSession) {
          let nextStep = '';
          if (activeSession.state === SESSION_STATES.STARTED) {
            nextStep = '➡️ Надішліть фото лічильника ДО зарядки';
          } else if (activeSession.state === SESSION_STATES.BEFORE_PHOTO_UPLOADED) {
            nextStep = '➡️ Завершіть зарядку та надішліть фото ПІСЛЯ';
          } else {
            nextStep = '➡️ Продовжуйте з наступним кроком';
          }
          
          await ctx.editMessageText(
            '➡️ <b>Продовжуємо сесію</b>\n\n' +
            `🆔 Сесія: #${activeSession.id}\n` +
            `🔄 Статус: ${activeSession.state}\n\n` +
            nextStep,
            { parse_mode: 'HTML' }
          );
        }
      } else if (data === 'force_new_session') {
        const activeSession = await getActiveSession(ctx.from.id);
        if (activeSession) {
          // Mark old session as finished
          await finishSession(activeSession.id);
        }
        
        // Create new session
        const newSession = await createSession(ctx.from.id);
        await ctx.editMessageText(
          '🆕 <b>Нова сесія створена!</b>\n\n' +
          `🆔 Номер сесії: #${newSession.id}\n` +
          `🕐 Почато: ${newSession.startedAt.toLocaleString('uk-UA')}\n\n` +
          'Надішліть, будь ласка, фото лічильника <b>ДО</b> зарядки.',
          { parse_mode: 'HTML' }
        );
      }
      
      await ctx.answerCallbackQuery();
      
    } catch (error) {
      logger.error('Callback query error:', error);
      await ctx.answerCallbackQuery('❌ Виникла помилка');
    }
  });

  // Handle manual reading input
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    
    // Skip commands
    if (text.startsWith('/')) {
      return;
    }

    // Check if it's a meter reading or tariff (number format) - handle both comma and dot
    const numberMatch = text.match(/^(\d+(?:[.,]\d{1,2})?)$/);
    if (numberMatch && ctx.isOwner) {
      const cleanNumber = numberMatch[1].replace(',', '.');
      const number = parseFloat(cleanNumber);
      
      // Check if there's an active session first - prioritize meter readings
      const activeSession = await getActiveSession(ctx.from.id);
      
      if (activeSession) {
        // There's an active session, treat as meter reading
        try {
          // Smart logic to determine what type of reading this is
          let readingType;
          let isScreenReading = false;
          
          logger.info(`Processing number: ${number}, session state: ${activeSession.state}, meterBefore: ${activeSession.meterBefore}`);
          
          if (activeSession.state === SESSION_STATES.STARTED) {
            // First reading is always meter BEFORE
            readingType = 'before';
            logger.info('Determined as BEFORE reading (session just started)');
          } else if (activeSession.state === SESSION_STATES.BEFORE_PHOTO_UPLOADED || 
                    activeSession.state === SESSION_STATES.FINISHED) {
            // After /finish, determine if it's meter AFTER or screen reading
            if (number < 20) {
              // Small number (< 20 kWh) = likely screen reading
              isScreenReading = true;
              readingType = 'screen';
              logger.info(`Determined as SCREEN reading (${number} < 20)`);
            } else if (activeSession.meterBefore && number > activeSession.meterBefore) {
              // Large number > previous meter reading = meter AFTER
              readingType = 'after';
              logger.info(`Determined as AFTER reading (${number} > ${activeSession.meterBefore})`);
            } else {
              // Fallback: if it's ambiguous, ask user
              await ctx.reply(
                `❓ <b>Уточнення типу показника</b>\n\n` +
                `Введено: <b>${number}</b>\n\n` +
                `📊 Показник лічильника ДО: <b>${activeSession.meterBefore}</b>\n\n` +
                'Що це за показник?',
                {
                  parse_mode: 'HTML',
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: '🔢 Лічильник ПІСЛЯ', callback_data: `confirm_meter_after_${number}_${activeSession.id}` },
                        { text: '📱 Екран зарядки', callback_data: `confirm_screen_${number}_${activeSession.id}` }
                      ]
                    ]
                  }
                }
              );
              return;
            }
          } else {
            // Default fallback
            readingType = 'after';
          }
          
          let updatedSession;
          if (isScreenReading) {
            // Update session with screen reading (kWh consumed)
            updatedSession = await updateSession(activeSession.id, {
              kwhScreen: number
            });
          } else {
            // Set meter reading in session
            updatedSession = await setMeterReading(activeSession.id, readingType, number, 'manual');
          }
          
          let nextStepMessage = '';
          let displayType = '';
          
          if (isScreenReading) {
            displayType = 'Екран зарядки';
            nextStepMessage = '\n\n✅ Дані з екрана збережено. Тепер потрібен показник лічильника ПІСЛЯ зарядки.';
          } else if (readingType === 'before') {
            displayType = 'Лічильник ДО';
            nextStepMessage = '\n\n➡️ Наступний крок: завершіть зарядку та надішліть фото ПІСЛЯ.';
          } else if (readingType === 'after') {
            displayType = 'Лічильник ПІСЛЯ';
            if (updatedSession.meterBefore && updatedSession.meterAfter) {
              const kwhUsed = updatedSession.kwhCalculated;
              nextStepMessage = `\n\n⚡ Спожито за лічильником: <b>${kwhUsed.toFixed(2)}</b> кВт·год`;
              if (updatedSession.kwhScreen) {
                nextStepMessage += `\n📱 За екраном: <b>${updatedSession.kwhScreen}</b> кВт·год`;
              }
              nextStepMessage += '\n\n✅ Сесія готова до завершення!';
            } else {
              nextStepMessage = '\n\n➡️ Наступний крок: надішліть фото екрана зарядної станції.';
            }
          }
          
          await ctx.reply(
            `✅ <b>Показники прийнято</b>\n\n` +
            `🆔 Сесія: #${activeSession.id}\n` +
            `🔢 Введено вручну: <b>${number}</b> кВт·год\n` +
            `📊 Тип: <b>${displayType}</b>${nextStepMessage}`,
            { parse_mode: 'HTML' }
          );
        } catch (error) {
          logger.error('Error setting manual reading:', error);
          await ctx.reply('❌ Помилка при збереженні показників.');
        }
      } else {
        // No active session - direct to proper commands
        if (number < 50) {
          // Likely a tariff rate
          const currentMonth = new Date().toISOString().slice(0, 7);
          await ctx.reply(
            `💰 <b>Встановлення тарифу</b>\n\n` +
            `Отримано: <b>${number}</b> (ймовірно тариф)\n\n` +
            `Для встановлення тарифу використовуйте:\n` +
            `<code>/tariff ${currentMonth} ${number}</code>\n\n` +
            '💡 Приклад: <code>/tariff 2025-08 7.41</code>',
            { parse_mode: 'HTML' }
          );
        } else {
          // Large number without active session
          await ctx.reply(
            `❓ <b>Отримано число: ${number}</b>\n\n` +
            'Немає активної сесії для збереження показників лічильника.\n\n' +
            '🆕 Для показників лічильника: натисніть "Нова сесія"\n' +
            '💰 Для тарифу: використовуйте <code>/tariff YYYY-MM ціна</code>',
            { parse_mode: 'HTML' }
          );
        }
      }
      return;
    }

    // Handle keyboard buttons
    if (ctx.isOwner) {
      switch (text) {
        case '🆕 Нова сесія':
          // Check if there's already an active session
          const activeSession = await getActiveSession(ctx.from.id);
          if (activeSession) {
            await ctx.reply(
              '⚠️ <b>У вас вже є активна сесія</b>\n\n' +
              `🆔 Сесія #${activeSession.id}\n` +
              `🗓️ Почато: ${activeSession.startedAt.toLocaleString('uk-UA')}\n` +
              `🔄 Статус: ${activeSession.state}\n\n` +
              'Продовжіть поточну або завершіть її?',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '➡️ Продовжити', callback_data: 'continue_session' }],
                    [{ text: '❌ Завершити і створити нову', callback_data: 'force_new_session' }]
                  ]
                }
              }
            );
            return;
          }
          
          // Create new session
          const newSession = await createSession(ctx.from.id);
          await ctx.reply(
            '🆕 <b>Нова сесія створена!</b>\n\n' +
            `🆔 Номер сесії: #${newSession.id}\n` +
            `🕐 Почато: ${newSession.startedAt.toLocaleString('uk-UA')}\n\n` +
            'Надішліть, будь ласка, фото лічильника <b>ДО</b> зарядки.\n\n' +
            '📸 <b>Важливо:</b> Надсилайте фото як <b>Документ/Файл</b>, щоб зберегти EXIF-дані.\n\n' +
            '💡 <i>Підказка: У Telegram при надсиланні фото виберіть "Без стиснення" або "Як файл".</i>',
            { 
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [[
                  { text: '📸 Надіслати фото ДО', callback_data: 'send_before_photo' }
                ]]
              }
            }
          );
          return;
        case '📊 Статус':
          const currentActiveSession = await getActiveSession(ctx.from.id);
          const currentMonth = new Date().toISOString().slice(0, 7);
          
          if (currentActiveSession) {
            await ctx.reply(
              '📊 <b>Поточний статус</b>\n\n' +
              '🔄 <b>Активна сесія:</b>\n' +
              `🆔 #${currentActiveSession.id}\n` +
              `🕐 Почато: ${currentActiveSession.startedAt.toLocaleString('uk-UA')}\n` +
              `🔄 Статус: ${currentActiveSession.state}\n` +
              `📸 Фото: ${currentActiveSession.photos.length}\n\n` +
              `💰 Поточний тариф: ${process.env.DEFAULT_RATE_UAH || '5.50'} грн/кВт·год\n\n` +
              '📈 Для перегляду детального звіту використовуйте /report ' + currentMonth,
              { parse_mode: 'HTML' }
            );
          } else {
            await ctx.reply(
              '📊 <b>Поточний статус</b>\n\n' +
              '🔄 Активних сесій: 0\n' +
              '📅 Останнє оновлення: немає даних\n' +
              `💰 Поточний тариф: ${process.env.DEFAULT_RATE_UAH || '5.50'} грн/кВт·год\n\n` +
              '📈 Для перегляду детального звіту використовуйте /report ' + currentMonth,
              { parse_mode: 'HTML' }
            );
          }
          return;
        case '📈 Звіти':
          const reportMonth = new Date().toISOString().slice(0, 7); // 2025-08
          return ctx.reply(`📈 Звіт за поточний місяць: /report ${reportMonth}\n\nАбо використовуйте: /report YYYY-MM\nНаприклад: /report 2025-01`);
        case '💰 Тарифи':
          const currentMonthTariff = new Date().toISOString().slice(0, 7); // 2025-08
          await ctx.reply(`💰 Встановити тариф за ${currentMonthTariff}:\n\nНадішліть суму в грн за кВт·год\nПриклади: 5.50 або 5,50 або 6.20`);
          return;
      }
    }

    if (ctx.userRole === 'NEIGHBOR') {
      switch (text) {
        case '👀 Переглянути звіт':
          return ctx.reply('👀 Використовуйте команду: /view YYYY-MM\nНаприклад: /view 2025-01');
        case '✅ Підтвердити звіт':
          return ctx.reply('✅ Використовуйте команду: /confirm YYYY-MM\nНаприклад: /confirm 2025-01');
      }
    }
  });

  // Handle reading type confirmation
  async function handleReadingTypeConfirmation(ctx, data) {
    try {
      const parts = data.split('_');
      const type = parts[1]; // 'meter' or 'screen'
      const subtype = parts[2]; // 'after' for meter
      const number = parseFloat(parts[type === 'meter' ? 3 : 2]);
      const sessionId = parseInt(parts[type === 'meter' ? 4 : 3]);
      
      const session = await getActiveSession(ctx.from.id);
      if (!session || session.id !== sessionId) {
        await ctx.editMessageText('❌ Сесія не знайдена або неактивна.');
        return;
      }
      
      let updatedSession;
      let displayType;
      let nextStepMessage = '';
      
      if (type === 'meter' && subtype === 'after') {
        // Confirm meter AFTER reading
        updatedSession = await setMeterReading(sessionId, 'after', number, 'manual');
        displayType = 'Лічильник ПІСЛЯ';
        
        if (updatedSession.meterBefore && updatedSession.meterAfter) {
          const kwhUsed = updatedSession.kwhCalculated;
          nextStepMessage = `\n\n⚡ Спожито за лічільником: <b>${kwhUsed.toFixed(2)}</b> кВт·год`;
          if (updatedSession.kwhScreen) {
            nextStepMessage += `\n📱 За екраном: <b>${updatedSession.kwhScreen}</b> кВт·год`;
          }
          nextStepMessage += '\n\n✅ Сесія готова до завершення!';
        }
      } else if (type === 'screen') {
        // Confirm screen reading
        updatedSession = await updateSession(sessionId, { kwhScreen: number });
        displayType = 'Екран зарядки';
        nextStepMessage = '\n\n✅ Дані з екрана збережено. Тепер потрібен показник лічільника ПІСЛЯ зарядки.';
      }
      
      await ctx.editMessageText(
        `✅ <b>Показники підтверджено</b>\n\n` +
        `🆔 Сесія: #${sessionId}\n` +
        `🔢 Збережено: <b>${number}</b> кВт·год\n` +
        `📊 Тип: <b>${displayType}</b>${nextStepMessage}`,
        { parse_mode: 'HTML' }
      );
      
    } catch (error) {
      logger.error('Error confirming reading type:', error);
      await ctx.editMessageText('❌ Помилка при збереженні показників.');
    }
  }

  // Handle report callback buttons
  async function handleReportCallback(ctx, data) {
    const { 
      generateMonthlySummary, 
      generateMonthlyPDF, 
      generateMonthlyCSV, 
      saveReportToFile, 
      cleanupTempFile 
    } = await import('../../services/reports.js');
    
    try {
      const parts = data.split('_');
      const format = parts[1]; // summary, pdf, csv
      const yearMonth = parts[2]; // 2025-08
      
      await ctx.editMessageText(
        `⏳ <b>Генерується ${format.toUpperCase()} звіт за ${yearMonth}</b>\n\n` +
        'Зачекайте, будь ласка...',
        { parse_mode: 'HTML' }
      );
      
      if (format === 'summary') {
        // Generate text summary
        const summary = await generateMonthlySummary(ctx.from.id, yearMonth);
        await ctx.editMessageText(summary, { parse_mode: 'HTML' });
        
      } else if (format === 'pdf') {
        // Generate PDF report
        const pdfBuffer = await generateMonthlyPDF(ctx.from.id, yearMonth);
        const filename = `EV_Report_${yearMonth}.pdf`;
        const filePath = await saveReportToFile(pdfBuffer, filename);
        
        await ctx.editMessageText(
          `✅ <b>PDF звіт готовий!</b>\n\n` +
          `📅 Період: ${yearMonth}\n` +
          `📄 Файл: ${filename}\n\n` +
          'Завантажується...',
          { parse_mode: 'HTML' }
        );
        
        // Send PDF as document
        await ctx.api.sendDocument(ctx.chat.id, new InputFile(filePath), {
          caption: `📊 PDF звіт про зарядку ЕМ за ${yearMonth}`
        });
        
        // Cleanup temp file
        setTimeout(() => cleanupTempFile(filePath), 5000);
        
      } else if (format === 'csv') {
        // Generate CSV report
        const csvBuffer = await generateMonthlyCSV(ctx.from.id, yearMonth);
        const filename = `EV_Report_${yearMonth}.csv`;
        const filePath = await saveReportToFile(csvBuffer, filename);
        
        await ctx.editMessageText(
          `✅ <b>CSV файл готовий!</b>\n\n` +
          `📅 Період: ${yearMonth}\n` +
          `📊 Файл: ${filename}\n\n` +
          'Завантажується...',
          { parse_mode: 'HTML' }
        );
        
        // Send CSV as document
        await ctx.api.sendDocument(ctx.chat.id, new InputFile(filePath), {
          caption: `📊 CSV дані про зарядку ЕМ за ${yearMonth}`
        });
        
        // Cleanup temp file
        setTimeout(() => cleanupTempFile(filePath), 5000);
      }
      
    } catch (error) {
      logger.error('Error handling report callback:', error);
      await ctx.editMessageText(
        '❌ <b>Помилка генерації звіту</b>\n\n' +
        'Спробуйте ще раз або зверніться до підтримки.',
        { parse_mode: 'HTML' }
      );
    }
  }

  logger.info('Bot handlers initialized');
}