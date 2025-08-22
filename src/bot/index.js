import { logger } from '../utils/logger.js';
import { setupCommands } from './commands/index.js';
import { setupHandlers } from './handlers/index.js';
import { isOwner, isAuthorized } from '../services/auth.js';

export function initBot(bot) {
  logger.info('Initializing bot...');
  
  // Middleware for logging
  bot.use(async (ctx, next) => {
    const start = Date.now();
    
    // Log user info for debugging
    logger.info(`User: ${ctx.from?.id} (@${ctx.from?.username}) - ${ctx.message?.text || '[non-text]'}`);
    
    logger.debug(`Incoming: ${ctx.update.update_id}`, {
      from: ctx.from?.username || ctx.from?.id,
      message: ctx.message?.text || ctx.message?.photo ? '[photo]' : '[other]'
    });
    
    try {
      await next();
    } catch (error) {
      logger.error('Bot handler error:', error);
      await ctx.reply('Виникла помилка при обробці вашого запиту. Спробуйте ще раз.');
    }
    
    const duration = Date.now() - start;
    logger.debug(`Processed in ${duration}ms`);
  });

  // Authorization middleware
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    const chatType = ctx.chat?.type;
    const isBot = ctx.from?.is_bot;
    
    logger.info(`Message details: userId=${userId}, username=${username}, chatType=${chatType}, isBot=${isBot}, text="${ctx.message?.text?.substring(0, 50) || '[non-text]'}"`);
    
    if (!userId) {
      logger.warn('Message from unknown user');
      return;
    }

    // Check if user is owner
    if (isOwner(userId, username)) {
      ctx.userRole = 'OWNER';
      ctx.isOwner = true;
      return next();
    }

    // Check if user is authorized neighbor
    const neighborAuth = await isAuthorized(userId);
    if (neighborAuth) {
      ctx.userRole = 'NEIGHBOR';
      ctx.neighbor = neighborAuth;
      return next();
    }

    // Unauthorized user
    ctx.userRole = 'GUEST';
    
    // Only allow /start for guests
    if (ctx.message?.text === '/start') {
      return next();
    }

    await ctx.reply(
      'Для використання бота потрібна авторизація. Натисніть /start та поділіться вашим контактом.',
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
  });

  // Setup command handlers
  setupCommands(bot);
  
  // Setup message handlers (photos, documents, etc.)
  setupHandlers(bot);

  // Error handling
  bot.catch((err) => {
    logger.error('Bot error:', err);
  });

  logger.info('Bot initialized successfully');
}