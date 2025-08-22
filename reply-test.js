// Test bot that replies to EV Charge Bot messages
import 'dotenv/config';
import { Bot } from 'grammy';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const GROUP_CHAT_ID = '-1003067185467';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🤖 Test Bot: Monitoring and replying to EV Bot messages...');

// Track EV Bot messages to reply to them
testBot.on('message', async (ctx) => {
  const msg = ctx.message;
  const user = msg.from;
  
  // Check if this is a message from EV Charge Bot
  if (user.is_bot && user.username === 'ev_charge_tracker_bot') {
    console.log(`📥 EV Bot message detected: "${msg.text?.substring(0, 100) || '[media]'}"`);
    
    try {
      // Reply to EV bot's message
      await ctx.reply('🧪 Test Bot: Отримав повідомлення від EV Bot!', {
        reply_to_message_id: msg.message_id
      });
      
      console.log('✅ Replied to EV Bot message');
      
      // If it's a menu message, try clicking buttons
      if (msg.text?.includes('Доступні команди')) {
        console.log('📋 Menu detected, sending test commands...');
        
        // Wait a bit then send commands
        setTimeout(async () => {
          await testBot.api.sendMessage(GROUP_CHAT_ID, '📊 Статус');
          console.log('📤 Sent: 📊 Статус');
        }, 2000);
        
        setTimeout(async () => {
          await testBot.api.sendMessage(GROUP_CHAT_ID, '🆕 Нова сесія');
          console.log('📤 Sent: 🆕 Нова сесія');
        }, 4000);
      }
      
    } catch (error) {
      console.error('❌ Error replying to EV Bot:', error);
    }
  }
  
  // Log all messages for debugging
  else {
    console.log(`📝 Message from ${user.first_name || user.username}: "${msg.text?.substring(0, 50) || '[media]'}"`);
  }
});

// Start the test bot
testBot.start();

console.log('🚀 Test Bot started and ready to interact with EV Bot');
console.log('💡 Send /start@ev_charge_tracker_bot in the group to trigger interaction');

// Send initial trigger message
setTimeout(async () => {
  try {
    await testBot.api.sendMessage(GROUP_CHAT_ID, '/start@ev_charge_tracker_bot');
    console.log('🎯 Sent trigger: /start@ev_charge_tracker_bot');
  } catch (error) {
    console.error('❌ Error sending trigger:', error);
  }
}, 3000);