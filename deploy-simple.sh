#!/bin/bash

# Simple EV Charge Bot VM Deployment (without sudo)
# Uses SQLite fallback instead of PostgreSQL

set -e

VM_IP="20.215.250.43"
VM_USER="azureuser"

echo "🚀 Deploying EV Charge Bot to VM: $VM_IP"
echo "📦 Using SQLite fallback (no PostgreSQL needed)"
echo ""

# Deploy application files
echo "📁 Copying application files..."
ssh "$VM_USER@$VM_IP" "mkdir -p /home/azureuser/ev-charge-bot"

# Copy source files
scp -r src "$VM_USER@$VM_IP:/home/azureuser/ev-charge-bot/"
scp package*.json "$VM_USER@$VM_IP:/home/azureuser/ev-charge-bot/"
scp ukr.traineddata "$VM_USER@$VM_IP:/home/azureuser/ev-charge-bot/"
scp -r assets "$VM_USER@$VM_IP:/home/azureuser/ev-charge-bot/"

# Create environment file
echo "📝 Creating environment configuration..."
cat << 'EOF' | ssh "$VM_USER@$VM_IP" "cat > /home/azureuser/ev-charge-bot/.env"
# Bot Configuration
BOT_TOKEN=7474516072:AAGEwY_Q2CVFL09u6Hb5YEe6Ny3WlVsXnbo
WEBHOOK_URL=http://20.215.250.43/webhook

# User Configuration  
OWNER_CHAT_ID=495068248
OWNER_PHONE_E164=+380933652536
ALLOWED_NEIGHBOR_PHONES=+380982180724

# Tariff
DEFAULT_RATE_UAH=5.5

# Database (SQLite fallback - no PostgreSQL needed)
# DATABASE_URL not set = uses in-memory SQLite

# Azure Computer Vision 
AZURE_VISION_KEY=6181fda6c17947188bfa3d05d81b6eaf
AZURE_VISION_ENDPOINT=https://eastus.api.cognitive.microsoft.com/

# Environment
NODE_ENV=production
TZ=Europe/Kyiv
PORT=3000
EOF

# Setup application on VM
echo "🛠️ Setting up application on VM..."
ssh "$VM_USER@$VM_IP" << 'REMOTE_COMMANDS'
set -e

cd /home/azureuser/ev-charge-bot

echo "📦 Installing Node.js and npm (if needed)..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18

echo "📦 Installing dependencies..."
npm install

echo "🔧 Creating PM2 ecosystem config..."
cat << 'PM2_CONFIG' > ecosystem.config.js
module.exports = {
  apps: [{
    name: 'ev-charge-bot',
    script: 'src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
PM2_CONFIG

echo "📁 Creating logs directory..."
mkdir -p logs

echo "🔧 Installing PM2 globally (if needed)..."
npm install -g pm2

echo "✅ Application setup completed!"
echo ""
echo "🔧 To start the bot:"
echo "1. SSH: ssh azureuser@20.215.250.43"
echo "2. Start: cd ev-charge-bot && pm2 start ecosystem.config.js"
echo "3. Status: pm2 status"
echo "4. Logs: pm2 logs ev-charge-bot"
echo ""
REMOTE_COMMANDS

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "🔧 Next steps:"
echo "1. SSH into VM: ssh azureuser@20.215.250.43"  
echo "2. Start bot: cd ev-charge-bot && pm2 start ecosystem.config.js"
echo "3. Check status: pm2 status"
echo "4. Test health: curl http://20.215.250.43:3000/health"
echo ""
echo "💡 Bot uses SQLite in-memory database (data resets on restart)"
echo "💰 VM cost: ~$7.30/month (~$88/year)"
echo ""