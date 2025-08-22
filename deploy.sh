#!/bin/bash

# Azure deployment script for EV Charge Bot

echo "🚀 Starting Azure deployment..."

# Configuration
RESOURCE_GROUP="ev-charge-bot-rg"
LOCATION="westeurope"
APP_NAME="ev-charge-bot"
PLAN_NAME="ev-charge-bot-plan"
DB_SERVER_NAME="ev-charge-bot-db"
DB_NAME="evchargebot"
STORAGE_ACCOUNT="evchargebotstore"

echo "📋 Configuration:"
echo "  Resource Group: $RESOURCE_GROUP"
echo "  Location: $LOCATION"
echo "  App Name: $APP_NAME"
echo ""

# Login to Azure (if not already logged in)
echo "🔐 Checking Azure login..."
az account show > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "Please login to Azure:"
    az login
fi

# Create resource group
echo "📦 Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create App Service Plan
echo "🏗️ Creating App Service Plan..."
az appservice plan create \
    --name $PLAN_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku B1 \
    --is-linux

# Create PostgreSQL Flexible Server
echo "🗄️ Creating PostgreSQL database..."
az postgres flexible-server create \
    --name $DB_SERVER_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --admin-user dbadmin \
    --admin-password "SecurePass123!" \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 15

# Create database
echo "📊 Creating database..."
az postgres flexible-server db create \
    --resource-group $RESOURCE_GROUP \
    --server-name $DB_SERVER_NAME \
    --database-name $DB_NAME

# Create storage account
echo "💾 Creating storage account..."
az storage account create \
    --name $STORAGE_ACCOUNT \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku Standard_LRS

# Create Web App
echo "🌐 Creating Web App..."
az webapp create \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --plan $PLAN_NAME \
    --runtime "NODE:18-lts"

# Configure app settings
echo "⚙️ Configuring app settings..."

# Get connection strings
DB_CONNECTION_STRING="postgresql://dbadmin:SecurePass123!@$DB_SERVER_NAME.postgres.database.azure.com:5432/$DB_NAME?sslmode=require"
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string --name $STORAGE_ACCOUNT --resource-group $RESOURCE_GROUP --query connectionString --output tsv)

az webapp config appsettings set \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
        NODE_ENV=production \
        DATABASE_URL="$DB_CONNECTION_STRING" \
        AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION_STRING" \
        WEBSITE_NODE_DEFAULT_VERSION="18.17.0" \
        SCM_DO_BUILD_DURING_DEPLOYMENT=true

echo "📝 Don't forget to set these environment variables in Azure Portal:"
echo "  - BOT_TOKEN (your Telegram bot token)"
echo "  - OWNER_CHAT_ID (your Telegram chat ID)"
echo "  - WEBHOOK_URL (https://$APP_NAME.azurewebsites.net/webhook)"
echo ""

# Deploy code
echo "🚀 Deploying code..."
az webapp deployment source config-local-git \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP

echo "✅ Deployment setup complete!"
echo ""
echo "Next steps:"
echo "1. Set BOT_TOKEN in Azure Portal app settings"
echo "2. Set OWNER_CHAT_ID in Azure Portal app settings"
echo "3. Configure webhook URL in Telegram: https://$APP_NAME.azurewebsites.net/webhook"
echo "4. Push code to Azure: git remote add azure <deployment_git_url>"
echo "5. Deploy: git push azure main"
echo ""
echo "🌐 App URL: https://$APP_NAME.azurewebsites.net"