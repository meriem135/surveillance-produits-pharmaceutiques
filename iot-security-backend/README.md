# IoT Security Backend Service

Backend API for IoT Cybersecurity Management Module

## Features

- Device inventory management
- Device statistics and analytics
- Risk scoring
- RESTful API

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the service
python main.py
```

## API Documentation

Once running, visit: http://localhost:8000/docs

## Endpoints

- `GET /api/v1/devices` - List all devices
- `POST /api/v1/devices` - Register new device
- `GET /api/v1/devices/{id}` - Get device details
- `PUT /api/v1/devices/{id}` - Update device
- `DELETE /api/v1/devices/{id}` - Delete device
- `GET /api/v1/devices/stats/summary` - Get statistics

## Docker

```bash
docker build -t iot-security-backend .
docker run -p 8000:8000 iot-security-backend
```
