# Security Intelligence & Behavioral Digital-Twin (Track A)

Welcome! This track focuses on the **Security Intelligence** pipeline. You are responsible for the entire flow from MQTT data ingestion to AI-powered risk prediction.

---

## 🏗️ Technical Domain: Security Intelligence
You lead the "Predictive Brain" of the platform. You own the MQTT protocol, AI Anomaly Detection, and Vulnerability Intelligence.

---

## 🛠 Active Tasks
### Phase 2: Behavioral Digital-Twin (Obj 7.4)
- [ ] **AI Anomaly Engine**: Develop the ML models (Isolation Forest) for behavioral analysis.
    - *Task*: Train models using `notebooks/anomaly_detection.ipynb` and deploy them as a standalone service.
    - *Digital-Twin Integration*: Create a "Behavioral Twin" state that tracks the device's "normality" score over time.

### Phase 3: Vulnerability Analysis (Obj 7.1 & 7.4)
- [ ] **CVE Pipeline**: Implement `app/domains/intelligence/nvd_service.py`.
    - *Logic*: Fetch CVE data and map it to device firmware versions.
- [ ] **Predictive Risk Scoring**: Develop an algorithm that predicts a device's risk level by combining its behavioral twin state with known CVE vulnerabilities.

### Phase 4: Threat Intelligence Dashboard (Obj 7.4)
- [ ] **Threat Explorer UI**: Build the React interface for viewing threats and vulnerabilities.
    - *Component*: A "Threat Explorer" section in the dashboard that visualizes AI and CVE data.

---

## 📂 Key Files
- `app/domains/intelligence/`
- `notebooks/anomaly_detection.ipynb`
- `wazuh-dashboard/plugins/iot-security/public/components/ThreatIntelligence.tsx`
