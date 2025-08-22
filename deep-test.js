// Deep test of EV Charge Bot workflow
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const GROUP_CHAT_ID = '-4906676301';

async function sendToGroup(text, delay = 1000) {
  try {
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
      console.log(`✅ Sent: ${text}`);
    } else {
      console.error(`❌ Failed to send: ${text}`, result);
    }
    
    if (delay > 0) {
      console.log(`⏳ Waiting ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  } catch (error) {
    console.error(`❌ Error sending: ${text}`, error);
  }
}

async function runDeepTest() {
  console.log('🧪 Starting DEEP EV Bot workflow test...\n');
  
  const testSteps = [
    { text: '🔬 DEEP TEST: Full EV Bot workflow', delay: 1500 },
    { text: '/start', delay: 3000 },
    { text: '🆕 Нова сесія', delay: 4000 },
    { text: '📊 Статус', delay: 3000 },
    { text: '🏁 /finish', delay: 3000 },
    { text: '📈 Звіти', delay: 3000 },
    { text: '/report 2025-08', delay: 3000 },
    { text: '💰 Тарифи', delay: 3000 },
    { text: '/tariff 2025-08 5.5', delay: 3000 },
    { text: '❓ /help', delay: 2000 },
    { text: '🔬 DEEP TEST: Workflow completed - analyzing responses...', delay: 1000 }
  ];
  
  for (const step of testSteps) {
    await sendToGroup(step.text, step.delay);
  }
  
  console.log('\n✅ Deep workflow test completed!');
  console.log('📊 Check the group to see EV Bot responses');
  console.log('📋 Analysis: Look for proper menus, error handling, and state management');
}

runDeepTest();