// Advanced monitor for all group activity
import 'dotenv/config';
import { Bot } from 'grammy';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🔍 Advanced Monitor: Tracking ALL group activity...\n');

// Track all messages with detailed analysis
testBot.on('message', async (ctx) => {
  const msg = ctx.message;
  const user = msg.from;
  const chat = ctx.chat;
  
  const timestamp = new Date().toLocaleTimeString();
  
  console.log(`\n[${timestamp}] 📥 NEW MESSAGE:`);
  console.log(`👤 From: ${user.first_name || user.username || 'Unknown'} (ID: ${user.id})`);
  console.log(`🤖 Is Bot: ${user.is_bot}`);
  console.log(`🏷️ Username: @${user.username || 'none'}`);
  console.log(`💬 Chat Type: ${chat.type}`);
  console.log(`📝 Text: "${msg.text || '[media/non-text]'}"`);
  
  // Special handling for known bots
  if (user.is_bot) {
    if (user.username === 'ev_charge_tracker_bot') {
      console.log('🎯 *** EV CHARGE BOT MESSAGE DETECTED! ***');
      
      // Try to interact with the message
      try {
        if (msg.text?.includes('Привіт') || msg.text?.includes('команди')) {
          console.log('📋 Menu detected! Sending test command...');
          
          setTimeout(async () => {
            await ctx.reply('🧪 Test Bot: Реагую на EV Bot menu!');
            await testBot.api.sendMessage(chat.id, '📊 Статус');
          }, 2000);
        }
      } catch (error) {
        console.error('❌ Error interacting:', error);
      }
    } 
    else if (user.username === 'GroupAnonymousBot') {
      console.log('🤖 System GroupAnonymousBot message');
    }
    else {
      console.log(`🤖 Other bot: @${user.username}`);
    }
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// Track callback queries (button presses)
testBot.on('callback_query', (ctx) => {
  console.log('\n🔘 BUTTON PRESS DETECTED!');
  console.log(`Data: ${ctx.callbackQuery.data}`);
  console.log(`From: ${ctx.from.first_name} (${ctx.from.id})`);
});

// Track other updates
testBot.on('edited_message', (ctx) => {
  console.log('\n✏️ MESSAGE EDITED');
});

testBot.start();

console.log('🚀 Advanced monitor started!');
console.log('🎯 Ready to track ALL group activity and EV Bot responses\n');

// Send a test trigger
setTimeout(async () => {
  try {
    console.log('🎬 Sending test trigger...');
    await testBot.api.sendMessage('-1003067185467', '/start@ev_charge_tracker_bot');
  } catch (error) {
    console.error('❌ Error sending trigger:', error);
  }
}, 3000);