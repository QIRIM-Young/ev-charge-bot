// Test bot commands as recognized owner
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const GROUP_CHAT_ID = '-4906676301';

async function sendTestBotCommand(text, delay = 2000) {
  try {
    console.log(`🤖 Test Bot sending: ${text}`);
    
    const response = await fetch(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: GROUP_CHAT_ID,
        text: text
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log(`✅ Sent successfully: ${text}`);
    } else {
      console.error(`❌ Failed: ${text}`, result);
    }
    
    if (delay > 0) {
      console.log(`⏳ Waiting ${delay}ms for EV Bot response...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } catch (error) {
    console.error(`❌ Error: ${text}`, error);
  }
}

async function testAsOwner() {
  console.log('🧪 Testing as recognized owner...\n');
  
  const commands = [
    '🔧 TEST: Now test bot should be recognized as owner',
    '/start',
    '📊 Статус', 
    '🆕 Нова сесія',
    '/status',
    '/help',
    '🔧 TEST: All commands sent - check EV Bot responses!'
  ];
  
  for (const cmd of commands) {
    await sendTestBotCommand(cmd, cmd.startsWith('🔧') ? 1000 : 3000);
  }
  
  console.log('\n✅ Test as owner completed!');
  console.log('📊 EV Bot should now respond to test bot commands');
}

testAsOwner();