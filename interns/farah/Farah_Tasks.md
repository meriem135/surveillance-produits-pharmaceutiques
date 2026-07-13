# Industrial Reliability & Compliance Digital-Twin (Track B)

Welcome! This track focuses on the **Governance & Reliability** pipeline. You are responsible for the entire flow from Modbus integration to regulatory compliance reporting.

---

## 🚀 Getting Started

- **Work Branch**: `farah-peaksoft-iot-platform` (Sync with `main` frequently).
- **Environment**:
    - Ensure Python 3.10+ is installed.
    - Start the stack: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml up -d`
    - Rebuild backend if needed: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml up -d --build iot-security-backend`

---

## 🏗️ Technical Domain: Governance & Reliability
You lead the "Regulatory Heart" of the platform. You own the Modbus protocol, the Compliance-as-Code engine, and Multi-Facility orchestration.

---

## 🛠 Active Tasks

### Phase 1: Modbus Industrial Reliability (Obj 7.2)
- [ ] **Modbus Master Service**: Expand `app/services/modbus_service.py`.
    - *Scope*: Industrial polling for PLC and SCADA devices.
    - *Goal*: Ensure reliable data acquisition for safety-critical registers.
- [ ] **Modbus Simulation**: Test using the script at `iot-security-backend/scripts/modbus_simulator.py`.

### Phase 2: Structural Digital-Twin & Multi-Facility (Obj 7.5 & 7.4)
- [ ] **Multi-Facility Core**: Implement `facility_id` scoping and site isolation in the `Repository` and `Service` layers.
- [ ] **Structural Twin State**: Build the state management logic that tracks a device's "Policy State" (e.g., ports, location, configuration) across sites.

### Phase 3: Compliance-as-Code (Obj 7.3)
- [ ] **Standard Verification Engine**: Implement `app/domains/compliance/engine.py`.
    - *Logic*: Convert **IEC 62443** and **ETSI EN 303645** controls into automated checks.
- [ ] **Standard Adherence Scoring**: Develop the logic that calculates compliance percentages for the Structural Twin.

### Phase 4: Governance Dashboard & Reporting (Obj 7.3 & 7.5)
- [ ] **Vulnerability Simulation Integration**: Utilize `/api/v1/devices/{device_id}/simulate-vulnerability` to test impact analysis.
- [ ] **Governance UI**: Build the React interface for compliance monitoring and facility health.
- [ ] **Automated PDF Reports**: Implement the server-side report generator.

---

## 📂 Key Files & Endpoints
- **Files**:
    - `app/services/modbus_service.py`
    - `app/domains/compliance/`
    - `app/db/facility_isolation.py`
    - `wazuh-dashboard/plugins/iot-security/public/components/GovernanceReliability.tsx`
- **Endpoints**:
    - `GET /api/v1/devices/stats/summary`: Global device health.
    - `POST /api/v1/devices/{device_id}/simulate-vulnerability`: Digital Twin 'What-If' analysis.
