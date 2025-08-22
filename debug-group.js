// Debug group messages to see actual user IDs
import 'dotenv/config';
import { Bot } from 'grammy';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🔍 Debug: Monitoring group messages...');

testBot.on('message', (ctx) => {
  const msg = ctx.message;
  const user = msg.from;
  const chat = msg.chat;
  
  console.log('\n📥 Group Message Details:');
  console.log(`Chat ID: ${chat.id} (${chat.type})`);
  console.log(`User ID: ${user.id}`);
  console.log(`Username: @${user.username || 'none'}`);
  console.log(`First Name: ${user.first_name}`);
  console.log(`Is Bot: ${user.is_bot}`);
  console.log(`Text: ${msg.text}`);
  console.log('---');
});

// Send a test message from test bot
setTimeout(async () => {
  try {
    const response = await testBot.api.sendMessage('-4906676301', '🔍 DEBUG: This message is from test bot');
    console.log('✅ Debug message sent from test bot');
  } catch (error) {
    console.error('❌ Error sending debug message:', error);
  }
}, 2000);

testBot.start();
console.log('🚀 Debug bot started - send messages in group to see user IDs');