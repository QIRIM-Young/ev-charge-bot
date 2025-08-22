// Correct group test with proper bot mentions
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const GROUP_CHAT_ID = '-1003067185467';

async function sendCommand(text, delay = 3000) {
  try {
    console.log(`📤 Sending: ${text}`);
    
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
      console.log(`✅ Command sent: ${text}`);
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

async function testWithProperMentions() {
  console.log('🎯 Testing with proper bot mentions in group...\n');
  
  const commands = [
    '🧪 TEST: Proper bot mentions in group',
    '/start@ev_charge_tracker_bot',
    '/status@ev_charge_tracker_bot', 
    '/help@ev_charge_tracker_bot',
    '✅ TEST: All commands sent with proper mentions'
  ];
  
  for (const cmd of commands) {
    await sendCommand(cmd, cmd.startsWith('🧪') || cmd.startsWith('✅') ? 1000 : 4000);
  }
  
  console.log('\n✅ Group test with mentions completed!');
  console.log('📊 Now EV Bot should respond to properly mentioned commands');
}

testWithProperMentions();