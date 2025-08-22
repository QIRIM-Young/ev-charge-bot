import 'dotenv/config';
import express from 'express';
import { Bot, webhookCallback } from 'grammy';
import { setupDatabase } from './database/setup.js';
import { initBot } from './bot/index.js';
import { logger } from './utils/logger.js';

const app = express();
const port = process.env.PORT || 3000;

// Create bot instance
const bot = new Bot(process.env.BOT_TOKEN);

// Initialize bot handlers
initBot(bot);

// Middleware
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize application
async function init() {
  try {
    // Setup database
    await setupDatabase();
    logger.info('Database initialized successfully');
    
    if (process.env.NODE_ENV === 'production' && process.env.WEBHOOK_URL) {
      // Production: use webhooks
      app.use('/webhook', webhookCallback(bot, 'express'));
      
      // Set webhook
      await bot.api.setWebhook(process.env.WEBHOOK_URL, {
        secret_token: process.env.WEBHOOK_SECRET
      });
      logger.info(`Webhook set to: ${process.env.WEBHOOK_URL}`);
      
      // Start server
      app.listen(port, () => {
        logger.info(`Server running on port ${port} (webhook mode)`);
      });
      
    } else {
      // Development: use polling
      logger.info('Development mode: Starting bot with polling...');
      bot.start();
      
      // Start server for health checks
      app.listen(port, () => {
        logger.info(`Server running on port ${port} (polling mode)`);
      });
    }
    
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Express error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await bot.stop();
  process.exit(0);
});

// Start the application
init();