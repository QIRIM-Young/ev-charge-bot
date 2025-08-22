#!/bin/bash

# EV Charge Bot - VM Deployment Script
# Deploys the bot to Azure Linux VM with PostgreSQL and Nginx reverse proxy

set -e

# Configuration
VM_IP="20.215.250.43"
VM_USER="azureuser"
VM_SSH_KEY="~/.ssh/id_rsa"
REPO_URL="https://github.com/QIRIM-Young/ev-charge-bot.git"
APP_DIR="/home/azureuser/ev-charge-bot"
SERVICE_NAME="ev-charge-bot"

echo "🚀 Starting deployment to VM: $VM_IP"
echo "📦 Repository: $REPO_URL"
echo ""

# Check SSH connection
echo "🔐 Testing SSH connection..."
ssh -i "$VM_SSH_KEY" -o ConnectTimeout=10 "$VM_USER@$VM_IP" "echo 'SSH connection successful'"
if [ $? -ne 0 ]; then
    echo "❌ SSH connection failed. Please check VM and SSH key"
    exit 1
fi

# Upload environment variables template
echo "📝 Creating environment template..."
cat << 'EOF' > /tmp/env-template
# Bot Configuration
BOT_TOKEN=your_telegram_bot_token_here
WEBHOOK_URL=https://your-domain.com/webhook
WEBHOOK_SECRET=your_webhook_secret_here

# User Configuration  
OWNER_CHAT_ID=495068248
OWNER_PHONE_E164=+380933652536
ALLOWED_NEIGHBOR_PHONES=+380982180724

# Tariff
DEFAULT_RATE_UAH=5.5

# Database (PostgreSQL on VM)
DATABASE_URL=postgresql://postgres:SecurePass2025!@localhost:5432/evchargebot

# Azure Computer Vision (Optional)
AZURE_VISION_KEY=your_azure_vision_key_here
AZURE_VISION_ENDPOINT=https://eastus.api.cognitive.microsoft.com/

# Environment
NODE_ENV=production
TZ=Europe/Kyiv
PORT=3000
EOF

# Deploy to VM
echo "🌐 Deploying to VM..."
ssh -i "$VM_SSH_KEY" "$VM_USER@$VM_IP" << 'REMOTE_SCRIPT'
set -e

echo "📦 Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo "🐘 Installing PostgreSQL..."
sudo apt install -y postgresql postgresql-contrib

echo "🔐 Setting up PostgreSQL..."
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << 'SQL_SETUP'
CREATE USER postgres WITH SUPERUSER PASSWORD 'SecurePass2025!';
CREATE DATABASE evchargebot OWNER postgres;
GRANT ALL PRIVILEGES ON DATABASE evchargebot TO postgres;
\q
SQL_SETUP

echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

echo "🌐 Installing Nginx..."
sudo apt install -y nginx

echo "🔧 Installing PM2..."
sudo npm install -g pm2

echo "📁 Setting up application directory..."
cd /home/azureuser

# Clone or update repository
if [ -d "ev-charge-bot" ]; then
    echo "📥 Updating existing repository..."
    cd ev-charge-bot
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone https://github.com/QIRIM-Young/ev-charge-bot.git
    cd ev-charge-bot
fi

echo "📦 Installing dependencies..."
npm install --production

echo "🔧 Setting up PM2 ecosystem..."
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
    error_file: '/home/azureuser/logs/ev-bot-error.log',
    out_file: '/home/azureuser/logs/ev-bot-out.log',
    log_file: '/home/azureuser/logs/ev-bot-combined.log',
    time: true
  }]
};
PM2_CONFIG

echo "📁 Creating logs directory..."
mkdir -p /home/azureuser/logs

echo "🌐 Configuring Nginx..."
sudo tee /etc/nginx/sites-available/ev-charge-bot << 'NGINX_CONFIG'
server {
    listen 80;
    server_name _;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
    
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
NGINX_CONFIG

echo "🔗 Enabling Nginx site..."
sudo ln -sf /etc/nginx/sites-available/ev-charge-bot /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl restart nginx
sudo systemctl enable nginx

echo "🔧 Setting up firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "✅ VM setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Copy environment file: scp env-template azureuser@20.215.250.43:/home/azureuser/ev-charge-bot/.env"
echo "2. Edit .env file with your actual values"
echo "3. Start the application: pm2 start ecosystem.config.js"
echo "4. Set up SSL certificate (optional): sudo apt install certbot python3-certbot-nginx"
echo ""
echo "🌐 Your bot will be available at: http://20.215.250.43"
REMOTE_SCRIPT

# Copy environment template
echo "📄 Copying environment template to VM..."
scp -i "$VM_SSH_KEY" /tmp/env-template "$VM_USER@$VM_IP:/home/azureuser/ev-charge-bot/.env"
rm /tmp/env-template

echo ""
echo "✅ Deployment completed successfully!"
echo ""
echo "🔧 Manual steps remaining:"
echo "1. SSH into VM: ssh -i ~/.ssh/id_rsa azureuser@20.215.250.43"
echo "2. Edit .env file: nano /home/azureuser/ev-charge-bot/.env"
echo "3. Add your actual BOT_TOKEN and WEBHOOK_URL"
echo "4. Start the bot: cd ev-charge-bot && pm2 start ecosystem.config.js"
echo "5. Check status: pm2 status"
echo "6. View logs: pm2 logs ev-charge-bot"
echo ""
echo "🌐 Health check: curl http://20.215.250.43/health"
echo "📊 VM costs: ~$7.30/month (~$88/year)"
echo ""