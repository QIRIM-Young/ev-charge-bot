// Automated testing script for EV Charge Bot
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
let groupChatId = null; // Will be set when you provide the group ID

async function sendToGroup(text, botToken = TEST_BOT_TOKEN) {
  if (!groupChatId) {
    console.log('❌ Group chat ID not set. Please provide group ID.');
    return;
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupChatId,
        text: text
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      console.log(`✅ Sent: ${text}`);
    } else {
      console.error(`❌ Failed to send: ${text}`, result);
    }
  } catch (error) {
    console.error(`❌ Error sending: ${text}`, error);
  }
}

async function runTestSequence() {
  if (!groupChatId) {
    console.log('Usage: node automated-test.js <group_chat_id>');
    console.log('Example: node automated-test.js -1001234567890');
    return;
  }
  
  console.log('🧪 Starting automated test sequence...\n');
  
  const testSequence = [
    { text: '🧪 TEST: Starting EV Bot tests', delay: 1000 },
    { text: '/start', delay: 2000 },
    { text: '📊 Статус', delay: 2000 },
    { text: '🆕 Нова сесія', delay: 3000 },
    { text: '/status', delay: 2000 },
    { text: '/help', delay: 2000 },
    { text: '📈 Звіти', delay: 2000 },
    { text: '/tariff', delay: 2000 },
    { text: '🧪 TEST: Basic commands completed', delay: 1000 }
  ];
  
  for (const step of testSequence) {
    await sendToGroup(step.text);
    console.log(`⏳ Waiting ${step.delay}ms...`);
    await new Promise(resolve => setTimeout(resolve, step.delay));
  }
  
  console.log('\n✅ Automated test sequence completed!');
}

// Get group chat ID from command line
if (process.argv[2]) {
  groupChatId = process.argv[2];
  runTestSequence();
} else {
  console.log('Please provide the group chat ID as argument');
  console.log('Usage: node automated-test.js <group_chat_id>');
}