// Test basic bot commands
import fetch from 'node-fetch';

const BOT_TOKEN = '8499449869:AAHHUCMAZzSdJF58IQkPEcAX47g9wGbwY_c';
const OWNER_CHAT_ID = '495068248';

async function sendCommand(command) {
  try {
    console.log(`📤 Sending: ${command}`);
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: OWNER_CHAT_ID,
        text: command
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log(`✅ Sent: ${command} (id: ${result.result.message_id})`);
      return true;
    } else {
      console.error(`❌ Failed: ${command}`, result);
      return false;
    }
    
  } catch (error) {
    console.error(`❌ Error sending ${command}:`, error);
    return false;
  }
}

async function testBasicCommands() {
  console.log('🧪 Testing basic bot commands...\n');
  
  const commands = [
    '/status',
    '📊 Статус',
    '/help',
    '🆕 Нова сесія'
  ];
  
  for (const cmd of commands) {
    await sendCommand(cmd);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
  }
  
  console.log('\n✅ All commands sent. Check bot logs and Telegram for responses.');
}

testBasicCommands();