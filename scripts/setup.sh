#!/bin/bash

# Peaksoft IoT Security - One-Click Setup Script
# Author: Antigravity AI
# Description: Bootstraps, generates certs, builds rebranded images, and runs the stack.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Peaksoft IoT Security Setup...${NC}"

# 1. Check Requirements
echo -e "${BLUE}🔍 Checking requirements...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install it first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ docker-compose is not installed. Please install it first.${NC}"
    exit 1
fi

# 2. Generate SSL Certificates
echo -e "${BLUE}🔐 Generating SSL Certificates...${NC}"
cd wazuh-docker/multi-node
docker-compose -f generate-indexer-certs.yml run --rm generator
cd ../..
echo -e "${GREEN}✅ Certificates generated successfully.${NC}"

# 3. Build IoT Security Backend
echo -e "${BLUE}📦 Building Peaksoft IoT Backend...${NC}"
docker build -t iot-security-backend ./iot-security-backend
echo -e "${GREEN}✅ Backend built successfully.${NC}"

# 4. Build Custom Peaksoft Dashboard
echo -e "${BLUE}🎨 Building Rebranded Peaksoft Dashboard (this may take a while)...${NC}"
cd wazuh-dashboard/docker-custom
./build_robust.sh
cd ../..
echo -e "${GREEN}✅ Dashboard built successfully.${NC}"

# 5. Start the Stack
echo -e "${BLUE}🚢 Launching the full Peaksoft stack...${NC}"
cd wazuh-docker/multi-node
docker-compose up -d
cd ../..

echo -e "\n${GREEN}🎉 PEAKSOFT SETUP COMPLETE!${NC}"
echo -e "----------------------------------------------------------------"
echo -e "🌐 Dashboard:  ${BLUE}https://localhost${NC}"
echo -e "👤 Username:   ${BLUE}admin${NC}"
echo -e "🔑 Password:   ${BLUE}SecretPassword${NC}"
echo -e "----------------------------------------------------------------"
echo -e "Note: It may take 2-3 minutes for all services to become healthy."

# 6. Wait for Database and Seed
echo -e "\n${BLUE}⏳ Waiting for database to be ready for seeding...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0
until docker exec iot-postgres pg_isready -U iot_user -d iot_security > /dev/null 2>&1 || [ $RETRY_COUNT -eq $MAX_RETRIES ]; do
    echo -n "."
    sleep 2
    RETRY_COUNT=$((RETRY_COUNT + 1))
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "\n${RED}⚠️ Warning: Database was not ready in time. You may need to run seeding manually later.${NC}"
else
    echo -e "\n${GREEN}✅ Database is ready.${NC}"
    echo -e "${BLUE}🌱 Seeding initial device data...${NC}"
    ./iot-security-backend/scripts/seed_db.sh
fi

echo -e "\n${GREEN}✨ All systems go!${NC}"