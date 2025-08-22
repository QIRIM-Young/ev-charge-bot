// Send a test message to identify the group
import 'dotenv/config';
import { Bot } from 'grammy';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🤖 Test Bot: Sending identification message...');

// Handle incoming messages to get chat ID
testBot.on('message', (ctx) => {
  const chat = ctx.chat;
  console.log(`📥 Message from chat: ${chat.id} (${chat.type})`);
  
  if (chat.type === 'group' || chat.type === 'supergroup') {
    console.log(`✅ Found group: "${chat.title}" with ID: ${chat.id}`);
    
    // Send confirmation
    ctx.reply(`🤖 Test Bot активний!\nGroup ID: ${chat.id}\nТепер можна починати автоматизоване тестування.`);
    
    // Save chat ID for later use
    console.log(`\n💾 Use this chat ID for automated testing: ${chat.id}`);
  }
});

// Start bot to listen for messages
testBot.start();

console.log('✅ Test bot started. Send any message in the group to get chat ID.');
console.log('⏳ Waiting for messages...');