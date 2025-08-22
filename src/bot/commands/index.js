import { logger } from '../../utils/logger.js';
import { 
  generateMonthlySummary, 
  generateMonthlyPDF, 
  generateMonthlyCSV, 
  saveReportToFile, 
  cleanupTempFile,
  getAvailableReportMonths 
} from '../../services/reports.js';
import { setTariff, getTariff, getAllTariffs } from '../../services/tariffs.js';

export function setupCommands(bot) {
  // Start command - available for everyone
  bot.command('start', async (ctx) => {
    const userName = ctx.from.first_name || ctx.from.username || 'Користувач';
    logger.info(`/start command: isOwner=${ctx.isOwner}, userName=${userName}`);
    
    if (ctx.isOwner) {
      logger.info('Sending owner start message...');
      await ctx.reply(
        `Привіт, ${userName}! 👋\n\n` +
        'Ви увійшли як власник. Доступні команди:\n\n' +
        '🆕 /new - Розпочати нову сесію зарядки\n' +
        '🏁 /finish - Завершити поточну сесію\n' +
        '📊 /status - Поточний статус\n' +
        '📈 /report YYYY-MM - Звіт за місяць\n' +
        '💰 /tariff YYYY-MM value - Встановити тариф\n' +
        '👥 /setneighbor - Додати сусіда\n' +
        '🔗 /share YYYY-MM - Поділитися звітом\n' +
        '❓ /help - Довідка',
        {
          reply_markup: {
            keyboard: [
              [{ text: '🆕 Нова сесія' }, { text: '📊 Статус' }],
              [{ text: '📈 Звіти' }, { text: '💰 Тарифи' }]
            ],
            resize_keyboard: true
          }
        }
      );
      logger.info('Owner start message sent successfully');
    } else if (ctx.userRole === 'NEIGHBOR') {
      await ctx.reply(
        `Привіт, ${userName}! 👋\n\n` +
        'Ви увійшли як сусід. Доступні команди:\n\n' +
        '👀 /view YYYY-MM - Переглянути звіт за місяць\n' +
        '✅ /confirm YYYY-MM - Підтвердити звіт\n' +
        '❓ /help - Довідка',
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
    } else {
      // Guest user - need authorization
      await ctx.reply(
        `Привіт, ${userName}! 👋\n\n` +
        'Для використання бота потрібна авторизація.\n' +
        'Поділіться вашим контактом для перевірки:',
        {
          reply_markup: {
            keyboard: [[{
              text: '📱 Поділитися контактом',
              request_contact: true
            }]],
            resize_keyboard: true,
            one_time_keyboard: true
          }
        }
      );
    }
  });

  // Help command
  bot.command('help', async (ctx) => {
    if (ctx.isOwner) {
      await ctx.reply(
        '📖 <b>Довідка для власника</b>\n\n' +
        '<b>Основні команди:</b>\n' +
        '🆕 <code>/new</code> - Розпочати нову сесію зарядки\n' +
        '🏁 <code>/finish</code> - Завершити поточну сесію\n' +
        '📊 <code>/status</code> - Показати поточний статус\n\n' +
        '<b>Звіти та тарифи:</b>\n' +
        '📈 <code>/report 2025-01</code> - Звіт за січень 2025\n' +
        '💰 <code>/tariff 2025-01 5.50</code> - Встановити тариф 5.50 грн/кВт·год\n\n' +
        '<b>Управління сусідами:</b>\n' +
        '👥 <code>/setneighbor</code> - Додати нового сусіда\n' +
        '🔗 <code>/share 2025-01</code> - Поділитися звітом з сусідом\n\n' +
        '<b>Порядок роботи:</b>\n' +
        '1. Встановіть тариф: <code>/tariff 2025-01 5.50</code>\n' +
        '2. Розпочніть сесію: <code>/new</code>\n' +
        '3. Надішліть фото лічильника ДО як документ\n' +
        '4. Завершіть сесію: <code>/finish</code>\n' +
        '5. Надішліть фото лічильника ПІСЛЯ та екрана зарядки\n' +
        '6. Підтвердіть дані та збережіть сесію\n' +
        '7. Згенеруйте звіт: <code>/report 2025-01</code>',
        { parse_mode: 'HTML' }
      );
    } else if (ctx.userRole === 'NEIGHBOR') {
      await ctx.reply(
        '📖 <b>Довідка для сусіда</b>\n\n' +
        '👀 <code>/view 2025-01</code> - Переглянути звіт за січень 2025\n' +
        '✅ <code>/confirm 2025-01</code> - Підтвердити звіт за січень 2025\n\n' +
        '<b>Як це працює:</b>\n' +
        '1. Власник надсилає вам звіт або OTP-посилання\n' +
        '2. Ви переглядаєте деталі витрат на електроенергію\n' +
        '3. Підтверджуєте суму до сплати\n\n' +
        'Всі дані зберігаються безпечно, ви бачите тільки підсумкову інформацію.',
        { parse_mode: 'HTML' }
      );
    }
  });

  // Owner-only commands
  bot.command('new', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return handleNewSession(ctx);
  });

  bot.command('finish', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return handleFinishSession(ctx);
  });

  bot.command('status', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return handleStatus(ctx);
  });

  // Add missing commands
  bot.command('report', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return handleReport(ctx);
  });

  bot.command('tariff', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return handleTariff(ctx);
  });

  bot.command('setneighbor', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return ctx.reply('👥 Функція додавання сусідів в розробці. Буде додана найближчим часом!');
  });

  bot.command('share', (ctx) => {
    if (!ctx.isOwner) {
      return ctx.reply('❌ Ця команда доступна тільки власнику.');
    }
    return ctx.reply('🔗 Функція поділитися звітом в розробці. Буде додана найближчим часом!');
  });

  // Handlers for commands (to be implemented)
  async function handleNewSession(ctx) {
    await ctx.reply(
      '🆕 <b>Розпочинаємо нову сесію зарядки</b>\n\n' +
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
  }

  async function handleFinishSession(ctx) {
    // Import session functions
    const { getActiveSession, finishSession } = await import('../../services/sessiondb.js');
    
    try {
      // Check if there's an active session
      const activeSession = await getActiveSession(ctx.from.id);
      
      if (!activeSession) {
        await ctx.reply(
          '❌ <b>Немає активної сесії</b>\n\n' +
          'Почніть нову сесію з кнопки "🆕 Нова сесія"',
          { parse_mode: 'HTML' }
        );
        return;
      }
      
      // Mark session as finished
      await finishSession(activeSession.id);
      
      await ctx.reply(
        '🏁 <b>Сесію зарядки завершено</b>\n\n' +
        `🆔 Сесія: #${activeSession.id}\n` +
        `🕐 Початок: ${activeSession.startedAt.toLocaleString('uk-UA')}\n` +
        `⏰ Завершено: ${new Date().toLocaleString('uk-UA')}\n\n` +
        'Тепер надішліть:\n' +
        '📸 <b>Фото лічильника ПІСЛЯ</b> зарядки (обов\'язково)\n' +
        '📱 <b>Фото екрана зарядки</b> (опціонально)\n\n' +
        '💡 Можете надіслати обидва фото у будь-якому порядку.\n' +
        '📄 Надсилайте як документ для збереження якості.',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📸 Фото ПІСЛЯ', callback_data: 'send_after_photo' }],
              [{ text: '📱 Фото екрана', callback_data: 'send_screen_photo' }],
              [{ text: '✅ Завершити без екрана', callback_data: 'complete_without_screen' }]
            ]
          }
        }
      );
      
    } catch (error) {
      logger.error('Error finishing session:', error);
      await ctx.reply('❌ Помилка при завершенні сесії. Спробуйте ще раз.');
    }
  }

  async function handleStatus(ctx) {
    await ctx.reply(
      '📊 <b>Поточний статус</b>\n\n' +
      '🔄 Активних сесій: 0\n' +
      '📅 Останнє оновлення: немає даних\n' +
      '💰 Поточний тариф: не встановлено\n\n' +
      '📈 Для перегляду детального звіту використовуйте <code>/report YYYY-MM</code>',
      { parse_mode: 'HTML' }
    );
  }

  // Report handler
  async function handleReport(ctx) {
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
      // Show available months
      const availableMonths = await getAvailableReportMonths(ctx.from.id);
      const monthsList = availableMonths.map(m => `• /report ${m.yearMonth} - ${m.displayName}`).join('\n');
      
      await ctx.reply(
        '📈 <b>Доступні звіти за місяці:</b>\n\n' +
        monthsList + '\n\n' +
        '💡 <i>Приклад: /report 2025-08</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const yearMonth = args[0];
    
    // Validate format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      await ctx.reply(
        '❌ <b>Неправильний формат періоду</b>\n\n' +
        'Використовуйте формат YYYY-MM\n' +
        'Приклад: <code>/report 2025-08</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    try {
      // Show report options
      await ctx.reply(
        `📊 <b>Звіт за ${yearMonth}</b>\n\n` +
        'Оберіть формат звіту:',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📄 Короткий звіт', callback_data: `report_summary_${yearMonth}` },
                { text: '📋 PDF звіт', callback_data: `report_pdf_${yearMonth}` }
              ],
              [
                { text: '📊 CSV файл', callback_data: `report_csv_${yearMonth}` }
              ]
            ]
          }
        }
      );
      
    } catch (error) {
      logger.error('Error in report handler:', error);
      await ctx.reply('❌ Помилка при створенні звіту. Спробуйте ще раз.');
    }
  }

  // Tariff handler
  async function handleTariff(ctx) {
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
      // Show all tariffs
      try {
        const tariffs = await getAllTariffs();
        
        if (tariffs.length === 0) {
          await ctx.reply(
            '💰 <b>Тарифи не встановлені</b>\n\n' +
            'Додайте новий тариф:\n' +
            '<code>/tariff 2025-08 7.41</code>\n\n' +
            '💡 <i>Формат: /tariff YYYY-MM ціна_за_кВт·год</i>',
            { parse_mode: 'HTML' }
          );
          return;
        }
        
        const tariffsText = tariffs.map(t => 
          `• ${t.yearMonth}: <b>${t.priceUahPerKwh.toFixed(2)} грн/кВт·год</b>${t.sourceNote ? ` (${t.sourceNote})` : ''}`
        ).join('\n');
        
        await ctx.reply(
          '💰 <b>Встановлені тарифи:</b>\n\n' +
          tariffsText + '\n\n' +
          '📝 Додати новий: <code>/tariff YYYY-MM ціна</code>\n' +
          '💡 Приклад: <code>/tariff 2025-08 7.41</code>',
          { parse_mode: 'HTML' }
        );
        
      } catch (error) {
        logger.error('Error getting tariffs:', error);
        await ctx.reply('❌ Помилка при отриманні тарифів.');
      }
      return;
    }
    
    if (args.length !== 2) {
      await ctx.reply(
        '❌ <b>Неправильний формат команди</b>\n\n' +
        'Використовуйте: <code>/tariff YYYY-MM ціна</code>\n' +
        'Приклад: <code>/tariff 2025-08 7.41</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const [yearMonth, priceStr] = args;
    
    // Validate format YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      await ctx.reply(
        '❌ <b>Неправильний формат періоду</b>\n\n' +
        'Використовуйте формат YYYY-MM\n' +
        'Приклад: <code>/tariff 2025-08 7.41</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    // Parse price (handle both comma and dot)
    const cleanPrice = priceStr.replace(',', '.');
    const price = parseFloat(cleanPrice);
    
    if (isNaN(price) || price <= 0 || price > 100) {
      await ctx.reply(
        '❌ <b>Неправильна ціна</b>\n\n' +
        'Ціна має бути від 0.01 до 100.00 грн/кВт·год\n' +
        'Приклад: <code>/tariff 2025-08 7.41</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    try {
      const tariff = await setTariff(yearMonth, price, 'Встановлено власником');
      
      await ctx.reply(
        '✅ <b>Тариф встановлено</b>\n\n' +
        `📅 Період: <b>${yearMonth}</b>\n` +
        `💰 Ціна: <b>${price.toFixed(2)} грн/кВт·год</b>\n\n` +
        '💡 Тепер ви можете завершувати сесії зарядки за цим тарифом.',
        { parse_mode: 'HTML' }
      );
      
    } catch (error) {
      logger.error('Error setting tariff:', error);
      await ctx.reply('❌ Помилка при встановленні тарифу. Спробуйте ще раз.');
    }
  }

  logger.info('Bot commands initialized');
}