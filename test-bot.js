// Test bot for communicating with EV Charge Bot
import 'dotenv/config';
import { Bot } from 'grammy';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🤖 Starting Test Bot...');

// Test bot info
try {
  const me = await testBot.api.getMe();
  console.log('✅ Test Bot Info:', {
    id: me.id,
    username: me.username,
    first_name: me.first_name
  });
} catch (error) {
  console.error('❌ Failed to get test bot info:', error);
  process.exit(1);
}

// Simple echo and command handling
testBot.command('start', (ctx) => {
  ctx.reply('🤖 Test Bot готовий до тестування EV Charge Bot!');
});

testBot.command('test_ev_bot', async (ctx) => {
  // Send commands to test EV bot functionality
  const commands = ['/start', '/status', '🆕 Нова сесія'];
  
  for (const cmd of commands) {
    await ctx.reply(`Тестуємо команду: ${cmd}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
});

testBot.on('message', (ctx) => {
  const text = ctx.message?.text;
  if (text && !text.startsWith('/')) {
    console.log(`📥 Received in group: ${text}`);
    // Don't echo in group to avoid spam
  }
});

// Start the test bot
testBot.start();

console.log('🚀 Test Bot started in polling mode');
console.log('📋 Bot username: @' + (await testBot.api.getMe()).username);
console.log('💡 Add both bots to a group to start testing!');