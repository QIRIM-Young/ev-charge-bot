// Direct test of bot commands via simulated update
import 'dotenv/config';
import { Bot } from 'grammy';
import { initBot } from './src/bot/index.js';

const bot = new Bot(process.env.BOT_TOKEN);
initBot(bot);

// Simulate /start update from owner
const startUpdate = {
  update_id: 12345,
  message: {
    message_id: 123,
    date: Math.floor(Date.now() / 1000),
    chat: {
      id: 495068248,
      type: 'private',
      first_name: '+380 (93) 365 3256'
    },
    from: {
      id: 495068248,
      is_bot: false,
      first_name: '+380 (93) 365 3256'
    },
    text: '/start',
    entities: [
      {
        type: 'bot_command',
        offset: 0,
        length: 6
      }
    ]
  }
};

console.log('🧪 Testing /start command simulation...');
console.log('Bot token:', process.env.BOT_TOKEN?.substring(0, 20) + '...');

try {
  // Initialize bot
  await bot.init();
  console.log('✅ Bot initialized');
  
  // Process the update
  await bot.handleUpdate(startUpdate);
  console.log('✅ Update processed successfully');
} catch (error) {
  console.error('❌ Error processing update:', error);
}

process.exit(0);