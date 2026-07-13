#!/bin/bash

# Configuration
CONTAINER_NAME="iot-postgres"
DB_USER="iot_user"
DB_NAME="iot_security"
SQL_FILE="$(dirname "$0")/seed_devices.sql"

echo "🚀 Starting database seeding process..."

# Check if the Docker container is running
if ! docker ps --filter "name=$CONTAINER_NAME" --format '{{.Names}}' | grep -q "$CONTAINER_NAME"; then
    echo "❌ Error: Container '$CONTAINER_NAME' is not running."
    echo "Please start the stack with: docker compose up -d"
    exit 1
fi

# Check if the SQL file exists
if [ ! -f "$SQL_FILE" ]; then
    echo "❌ Error: SQL file '$SQL_FILE' not found."
    exit 1
fi

echo "📦 Seeding data from $SQL_FILE into $CONTAINER_NAME..."

# Execute the SQL script
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$SQL_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Success! Database seeded successfully."
    echo "You can verify the data with: docker exec -it $CONTAINER_NAME psql -U $DB_USER -d $DB_NAME -c 'SELECT * FROM devices;'"
else
    echo "❌ Error: Failed to seed database."
    exit 1
fi
