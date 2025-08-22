// Простий тест для перевірки що все працює локально
import 'dotenv/config';

console.log('🔍 Перевірка конфігурації...');

const requiredEnvVars = [
  'BOT_TOKEN',
  'OWNER_PHONE_E164', 
  'ALLOWED_NEIGHBOR_PHONES'
];

const missing = [];
requiredEnvVars.forEach(key => {
  if (!process.env[key]) {
    missing.push(key);
  } else {
    console.log(`✅ ${key}: ${key === 'BOT_TOKEN' ? '***' : process.env[key]}`);
  }
});

if (missing.length > 0) {
  console.log(`❌ Відсутні змінні: ${missing.join(', ')}`);
  console.log('Скопіюйте .env.example в .env та заповніть значення');
  process.exit(1);
}

console.log('✅ Конфігурація в порядку!');
console.log('');
console.log('📋 Наступні кроки:');
console.log('1. Створіть бота через @BotFather');
console.log('2. Додайте BOT_TOKEN в .env');
console.log('3. Налаштуйте Azure ресурси (див. SETUP.md)');
console.log('4. Запустіть: npm run dev');
console.log('');
console.log('👥 Користувачі:');
console.log(`   Власник: ${process.env.OWNER_PHONE_E164}`);
console.log(`   Сусіди: ${process.env.ALLOWED_NEIGHBOR_PHONES}`);