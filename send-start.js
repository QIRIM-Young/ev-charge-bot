// Send /start command to bot via Telegram API
import fetch from 'node-fetch';

const BOT_TOKEN = '8499449869:AAHHUCMAZzSdJF58IQkPEcAX47g9wGbwY_c';
const OWNER_CHAT_ID = '495068248';

async function sendStartCommand() {
  try {
    console.log('📤 Sending /start command to bot...');
    
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: OWNER_CHAT_ID,
        text: '/start'
      })
    });
    
    const result = await response.json();
    
    if (result.ok) {
      console.log('✅ Command sent successfully:', result.result.message_id);
      
      // Wait a bit for bot to process
      console.log('⏳ Waiting 3 seconds for bot to process...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      console.log('✅ Done. Check bot logs for response.');
    } else {
      console.error('❌ Failed to send command:', result);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

sendStartCommand();