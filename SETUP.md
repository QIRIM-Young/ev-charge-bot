# Налаштування EV Charge Bot

## 1. Створення Telegram бота

### Крок 1: BotFather
1. Знайдіть [@BotFather](https://t.me/botfather) в Telegram
2. Надішліть `/newbot`
3. Введіть назву бота: `EV Charge Tracker`
4. Введіть username бота: `ev_charge_tracker_bot` (або інший доступний)
5. Збережіть отриманий **BOT_TOKEN**

### Крок 2: Налаштування команд бота
Надішліть BotFather команду `/setcommands` та оберіть свого бота, потім вставте:
```
start - Розпочати роботу з ботом
help - Показати довідку
new - Розпочати нову сесію зарядки
finish - Завершити поточну сесію
status - Поточний статус
report - Звіт за місяць (напр. /report 2025-01)
tariff - Встановити тариф (напр. /tariff 2025-01 5.50)
view - Переглянути звіт (для сусідів)
confirm - Підтвердити звіт (для сусідів)
```

## 2. Azure Resources

### Потрібні сервіси:
- **Azure App Service** (для бота)
- **Azure Database for PostgreSQL Flexible Server**
- **Azure Blob Storage** (для фото)
- **Azure Computer Vision** (для OCR)
- **Azure Key Vault** (для секретів - опціонально)

### Створення через Azure CLI:
```bash
# Створити resource group
az group create --name ev-charge-bot-rg --location "Poland Central"

# Створити PostgreSQL
az postgres flexible-server create \\
  --name ev-charge-db \\
  --resource-group ev-charge-bot-rg \\
  --location "Poland Central" \\
  --admin-user evchargeadmin \\
  --admin-password YourSecurePassword123! \\
  --sku-name Standard_B1ms \\
  --tier Burstable \\
  --storage-size 32

# Створити storage account
az storage account create \\
  --name evchargestorage \\
  --resource-group ev-charge-bot-rg \\
  --location "Poland Central" \\
  --sku Standard_LRS

# Створити Computer Vision для OCR
az cognitiveservices account create \\
  --name "ev-charge-vision" \\
  --resource-group "ev-charge-bot-rg" \\
  --kind "ComputerVision" \\
  --sku "F0" \\
  --location "East US"

# Створити container для фото
az storage container create \\
  --name ev-charging \\
  --account-name evchargestorage

# Створити App Service Plan
az appservice plan create \\
  --name ev-charge-plan \\
  --resource-group ev-charge-bot-rg \\
  --location "Poland Central" \\
  --sku B1 \\
  --is-linux

# Створити Web App
az webapp create \\
  --name ev-charge-bot \\
  --resource-group ev-charge-bot-rg \\
  --plan ev-charge-plan \\
  --runtime "NODE:18-lts"
```

## 3. Налаштування .env файлу

Скопіюйте `.env.example` в `.env` та заповніть:

```env
# Telegram Bot
BOT_TOKEN=ваш_bot_token_від_botfather
WEBHOOK_URL=https://ev-charge-bot.azurewebsites.net/webhook
WEBHOOK_SECRET=ваш_webhook_secret

# Azure PostgreSQL
DATABASE_URL=postgresql://evchargeadmin:YourSecurePassword123!@ev-charge-db.postgres.database.azure.com:5432/postgres
DB_SSL=true

# Azure Blob Storage
AZURE_STORAGE_ACCOUNT_NAME=evchargestorage
AZURE_STORAGE_ACCOUNT_KEY=ваш_storage_key
AZURE_STORAGE_CONTAINER_NAME=ev-charging

# Azure Computer Vision OCR
AZURE_VISION_KEY=ваш_computer_vision_key
AZURE_VISION_ENDPOINT=https://eastus.api.cognitive.microsoft.com/

# Owner Configuration (Ельдар)
OWNER_PHONE_E164=+380933652536
OWNER_CHAT_ID=ваш_telegram_chat_id
OWNER_USERNAME=@ваш_username

# Neighbor Whitelist
ALLOWED_NEIGHBOR_PHONES=+380671234567,+380671234568

# Business Rules
DEFAULT_RATE_UAH=5.50
DISCREPANCY_THRESHOLD_PERCENT=10
SESSION_TIMEOUT_HOURS=12
```

## 4. Отримання Chat ID

Для отримання вашого chat_id:
1. Напишіть боту [@userinfobot](https://t.me/userinfobot)
2. Або тимчасово запустіть бота і надішліть йому будь-що
3. Перевірте логи - там буде ваш chat_id

## 5. Deployment в Azure

### Через Azure CLI:
```bash
# Налаштувати environment variables
az webapp config appsettings set \\
  --name ev-charge-bot \\
  --resource-group ev-charge-bot-rg \\
  --settings \\
    BOT_TOKEN="ваш_token" \\
    DATABASE_URL="ваша_database_url" \\
    OWNER_PHONE_E164="+380933652536"

# Deploy code
zip -r deploy.zip . -x "node_modules/*" ".git/*"
az webapp deployment source config-zip \\
  --name ev-charge-bot \\
  --resource-group ev-charge-bot-rg \\
  --src deploy.zip
```

### Через VS Code Azure Extension:
1. Встановіть Azure App Service extension
2. Right-click на проект → Deploy to Web App
3. Оберіть subscription і resource group

## 6. Налаштування Webhook

Після deploy встановіть webhook:
```bash
curl -X POST "https://api.telegram.org/bot<ваш_token>/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://ev-charge-bot.azurewebsites.net/webhook"}'
```

## 7. Тестування

1. Знайдіть свого бота в Telegram за username
2. Надішліть `/start`
3. Перевірте що бот розпізнає вас як власника
4. Спробуйте команду `/new`

## 8. Додавання сусідів

1. Додайте номери сусідів в `ALLOWED_NEIGHBOR_PHONES`
2. Надішліть їм посилання на бота
3. Вони мають надіслати `/start` і поділитися контактом

## Orієнтовна вартість

- **App Service B1**: ~$13/місяць
- **PostgreSQL Flexible B1ms**: ~$20/місяць  
- **Blob Storage**: ~$2/місяць
- **Computer Vision F0**: Безкоштовно (5000 API calls/місяць)
- **Загалом**: ~$35/місяць = $420/рік

Це вкладається в ваш бюджет $2000/рік з великим запасом!