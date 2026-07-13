# Technical Architecture Master Reference

This document provides a deep dive into "what we already have" to help you understand the existing machinery of the PeakSoft Security Platform.

---

## 🏗 Backend Architecture (FastAPI)

The backend is built with **FastAPI** and **SQLModel** (which combines SQLAlchemy and Pydantic).

### 1. Data Flow Summary
1.  **Ingestion**: `MqttService` and `ModbusService` in `app/services/` run as background tasks.
2.  **Normalization**: Raw data is parsed into `Telemetry` objects (`app/domains/devices/models.py`).
3.  **Storage**: Objects are saved to PostgreSQL via the **Repository Pattern** (`app/db/`).
4.  **Enrichment**: `WazuhService` (`app/services/`) and `IntelligenceService` (`app/domains/intelligence/`) add Risk/Compliance data.
5.  **API**: React/Dashboard queries `/api/v1/devices/` (handled in `app/api/v1/`) to get the final state.

---

### 📂 Key Components List

#### 🛡 `app/services/` & `app/domains/` (The Business Logic)
- **`app/services/mqtt_service.py`**:
  - *Status*: Operational.
  - *How it works*: Subscribes to `factory/+/telemetry`. Now uses `TelemetryRepository` for persistence.
- **`app/services/modbus_service.py`**:
  - *Status*: Operational.
  - *How it works*: Polls devices every 30s. Uses `DeviceRepository` for Digital Twin sync.
- **`app/domains/intelligence/service.py`**:
  - *Status*: Operational.
  - *How it works*: Fetches risk/compliance patterns from Wazuh/OpenSearch.
  
#### 📊 `app/domains/*/models.py` (The Schema)
- **`app/domains/devices/models.py`**:
  - Represents the **Digital Twin** and **Telemetry** history.
  - `digital_twin_state`: A JSON column holding the absolute "latest" telemetry.

#### 🔌 `app/api/` (The Interface)
- **`app/api/v1/devices.py`**:
  - Handles CRUD and risk scoring integration.

### 3. Frontend Architecture (Dashboard)
The **Peaksoft IoT Security** dashboard plugin is built using **React** and the **Elastic UI (EUI)** framework. It is structured into two independent functional domains:

- **Threat Intelligence Section**:
  - *Lead Track*: Track A.
  - *Features*: AI Anomaly scoring, behavioral digital-twin visualization, and CVE impact analysis.
- **Governance & Reliability Section**:
  - *Lead Track*: Track B.
  - *Features*: Compliance-as-code status, site-isolation views, and regulatory reporting.

---

## 🎨 Dashboard Architecture (React)

The dashboard is a custom plugin within the Wazuh/OpenSearch framework.

### `wazuh-dashboard/docker-custom/iot-security-plugin`
- **`public/`**: Contains React components.
- **`server/`**: Server-side logic for the plugin.
- **Update Pattern**: 
  - To add a new view, create a component in `public/components`.
  - To fetch data, use the standard browser `fetch` or the dashboard's internal API client to point to `http://iot-security-backend:8000/api/v1/...`.

---

## 🧪 Simulation & Testing Suite
We have a set of "Pro" tools to test without physical hardware:

1.  **`mqtt_simulator.py`**: Publishes mock telemetry.
2.  **`modbus_simulator.py`**: Runs a virtual PLC.
3.  **`simulate_alerts.py`**: Pushes mock security alerts directly into Wazuh to test the "Risk Score" logic.

---

## 📝 How to make updates without breaking things:
1.  **Always use `async`**: Every network/DB call MUST start with `async def` and use `await`.
2.  **Check the logs**: `docker compose logs -f` is your best friend.
3.  **SQLModel check**: If you change a model in `app/domains/*/models.py`, you MUST create a migration via **Alembic** or reset the DB using `seed_db.sh` for development.
