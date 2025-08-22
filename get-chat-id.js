// Get chat ID from test bot updates
import fetch from 'node-fetch';

const TEST_BOT_TOKEN = '8476511612:AAGMwhF6XrcDbrckrUMnORef2YAywZ1Gp-c';

async function getChatId() {
  try {
    console.log('📡 Getting updates from test bot...');
    
    const response = await fetch(`https://api.telegram.org/bot${TEST_BOT_TOKEN}/getUpdates`);
    const result = await response.json();
    
    if (result.ok && result.result.length > 0) {
      console.log('📥 Recent updates:');
      
      result.result.forEach((update, index) => {
        const chat = update.message?.chat || update.callback_query?.message?.chat;
        if (chat) {
          console.log(`${index + 1}. Chat ID: ${chat.id}, Type: ${chat.type}, Title: "${chat.title || chat.first_name}"`);
        }
      });
      
      // Find group chat
      const groupUpdate = result.result.find(update => {
        const chat = update.message?.chat || update.callback_query?.message?.chat;
        return chat && (chat.type === 'group' || chat.type === 'supergroup');
      });
      
      if (groupUpdate) {
        const groupChat = groupUpdate.message?.chat || groupUpdate.callback_query?.message?.chat;
        console.log(`\n✅ Found group chat: ID = ${groupChat.id}`);
        console.log(`📋 Group info: "${groupChat.title}"`);
        return groupChat.id;
      } else {
        console.log('\n❌ No group chat found in recent updates');
        console.log('💡 Send a message in the group first, then run this script again');
        return null;
      }
      
    } else {
      console.log('❌ No updates found or API error:', result);
      return null;
    }
    
  } catch (error) {
    console.error('❌ Error getting updates:', error);
    return null;
  }
}

getChatId();