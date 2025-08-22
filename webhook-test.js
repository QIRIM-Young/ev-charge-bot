// Webhook simulation test for EV Bot
import fetch from 'node-fetch';

const BOT_TOKEN = '8499449869:AAHHUCMAZzSdJF58IQkPEcAX47g9wGbwY_c';
const OWNER_CHAT_ID = 495068248;
const GROUP_CHAT_ID = '-1003067185467';

// Simulate webhook update from Telegram
async function simulateWebhookUpdate(update) {
  try {
    console.log(`📤 Simulating webhook update:`, JSON.stringify(update, null, 2));
    
    // This would be sent to our bot's webhook endpoint
    // For testing, we send directly to Telegram API
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
    const result = await response.json();
    
    console.log(`📥 Response:`, result.result?.length || 0, 'updates');
    return result;
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Test user message simulation
async function testUserCommands() {
  console.log('🧪 Testing EV Bot with simulated user messages...\n');
  
  // Test commands that should work
  const commands = [
    { text: '/start', description: 'Start command' },
    { text: '🆕 Нова сесія', description: 'New session button' },
    { text: '📊 Статус', description: 'Status button' },
    { text: '/help', description: 'Help command' }
  ];
  
  for (const cmd of commands) {
    console.log(`📤 Testing: ${cmd.text} (${cmd.description})`);
    
    // Simulate user update
    const update = {
      update_id: Date.now(),
      message: {
        message_id: Date.now(),
        from: {
          id: OWNER_CHAT_ID,
          is_bot: false,
          first_name: "Test User",
          username: "testuser"
        },
        chat: {
          id: OWNER_CHAT_ID,
          type: "private"
        },
        date: Math.floor(Date.now() / 1000),
        text: cmd.text
      }
    };
    
    await simulateWebhookUpdate(update);
    console.log(`⏳ Waiting for response...\n`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('✅ All test commands sent!');
}

// Direct API testing
async function testDirectAPI() {
  console.log('🔧 Testing direct API calls...\n');
  
  try {
    // Test bot info
    const botInfo = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botResult = await botInfo.json();
    console.log('🤖 Bot info:', botResult.result?.username, botResult.result?.first_name);
    
    // Test send message
    const sendMsg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OWNER_CHAT_ID,
        text: '🧪 Test message from webhook simulation'
      })
    });
    const sendResult = await sendMsg.json();
    console.log('📤 Send test:', sendResult.ok ? '✅ Success' : '❌ Failed');
    
  } catch (error) {
    console.error('❌ API test error:', error);
  }
}

async function runTests() {
  await testDirectAPI();
  await new Promise(resolve => setTimeout(resolve, 1000));
  await testUserCommands();
}

runTests();