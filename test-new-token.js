import 'dotenv/config';
import { Bot } from 'grammy';

// Test script to validate new bot token
const BOT_TOKEN = process.env.NEW_BOT_TOKEN || 'PASTE_NEW_TOKEN_HERE';

console.log('🧪 Testing new bot token:', BOT_TOKEN.substring(0, 10) + '...');

const bot = new Bot(BOT_TOKEN);

// Test getMe
try {
  const me = await bot.api.getMe();
  console.log('✅ Bot token is valid!');
  console.log('📋 Bot info:', {
    id: me.id,
    username: me.username,
    first_name: me.first_name
  });
  
  // Test simple echo handler
  bot.command('start', (ctx) => {
    ctx.reply('🤖 Test bot is working! /start command received.');
  });
  
  bot.on('message:text', (ctx) => {
    ctx.reply(`Echo: ${ctx.message.text}`);
  });
  
  console.log('🚀 Starting test bot in polling mode...');
  await bot.start();
  
} catch (error) {
  console.error('❌ Bot token test failed:', error.message);
  process.exit(1);
}