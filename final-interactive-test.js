// Final interactive test with both bots
import 'dotenv/config';
import { Bot } from 'grammy';
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';
const GROUP_CHAT_ID = '-4906676301';
const testBot = new Bot(TEST_BOT_TOKEN);

console.log('🎭 Final Interactive Test: Bot-to-Bot Communication');

// Monitor all messages in group
testBot.on('message', (ctx) => {
  const msg = ctx.message;
  const user = msg.from;
  
  if (user.is_bot && user.id !== 8476511612) {
    // This is a response from EV Charge Bot
    console.log(`🤖 EV Bot Response: "${msg.text}"`);
    
    // Analyze the response
    if (msg.text?.includes('Привіт')) {
      console.log('✅ START command worked - got welcome message');
    }
    if (msg.text?.includes('статус') || msg.text?.includes('сесій')) {
      console.log('✅ STATUS command worked - got status info');
    }
    if (msg.text?.includes('команди')) {
      console.log('✅ HELP command worked - got help info');
    }
  } else if (user.id === 495068248) {
    // Owner message
    console.log(`👤 Owner: "${msg.text}"`);
  } else if (user.id === 8476511612) {
    // Test bot message (our own)
    console.log(`🧪 Test Bot: "${msg.text}"`);
  }
});

// Automated test sequence
async function runInteractiveTest() {
  console.log('🚀 Starting interactive bot test...\n');
  
  // Test sequence with analysis
  const tests = [
    {
      command: '/start',
      description: 'Testing start command',
      expectation: 'Should receive welcome message with menu'
    },
    {
      command: '📊 Статус',
      description: 'Testing status button',
      expectation: 'Should receive current session status'
    },
    {
      command: '/help',
      description: 'Testing help command', 
      expectation: 'Should receive help information'
    }
  ];
  
  for (const test of tests) {
    console.log(`\n🧪 ${test.description}`);
    console.log(`📤 Sending: ${test.command}`);
    console.log(`🎯 Expect: ${test.expectation}`);
    
    // Send command
    await testBot.api.sendMessage(GROUP_CHAT_ID, test.command);
    
    // Wait for response
    console.log('⏳ Waiting for EV Bot response...');
    await new Promise(resolve => setTimeout(resolve, 4000));
  }
  
  console.log('\n🏁 Interactive test completed!');
  console.log('📊 Check above for EV Bot responses and analysis');
}

// Start bot and run test
testBot.start();

// Wait a moment for bot to start, then run test
setTimeout(runInteractiveTest, 2000);