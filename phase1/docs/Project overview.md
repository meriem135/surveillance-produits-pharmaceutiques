# Project Overview: Peaksoft Security Platform

---

## 👥 Audience & Purpose

- **Audience**: Project stakeholders, supervisors, new team members, and engineers who need a concise understanding of what the Peaksoft Security Platform is and where it is going.
- **Purpose**: Provide a high-level summary of the mission, architecture, and development tracks. For detailed implementation and day-to-day planning, see the other docs in `docs/`.

---

## Mission Statement

The **Peaksoft Security Platform** is a specialized cybersecurity management layer built on top of Wazuh. It targets industrial IoT (IIoT) environments by providing advanced threat detection, protocol analysis, and compliance automation through an integrated **Intelligence Layer**.

---

At a high level, the Intelligence Layer consumes telemetry from IIoT devices (physical or simulated), enriches it with vulnerability and compliance context, and surfaces prioritized security insights through Wazuh and Peaksoft dashboards.

---

## The 4 Tracks (Roadmap Scope)

The development and research activities are organized into four core tracks:

| Track | Name | Focus | Objective Mapping |
| :--- | :--- | :--- | :--- |
| **Track A** | **Protocols** | AI-assisted analysis of industrial protocols (Modbus, MQTT, etc.). | Objective 7.2 |
| **Track B** | **AI/Data** | Machine learning models for vulnerability detection and risk scoring. | Objective 7.1 |
| **Track C** | **Compliance** | Automated auditing for IEC 62443-4-2 and ETSI EN 303645 standards. | Objective 7.3 |
| **Track D** | **Hardening** | OS and application-level security hardening for IIoT gateways. | Core Infrastructure |

Each track is expanded into concrete phases and day-by-day tasks in `docs/roadmap.md`.

> [!NOTE]
> The platform currently defaults to **Simulator Mode** for MQTT and Modbus telemetry to facilitate development. See the [Implementation Journal](./Concepts_and_Implementation.md#%EF%B8%8F-simulators-vs-production-ingestion) for instructions on switching to physical hardware.

---

## ✅ Success Criteria (High Level)

The project is considered successful when:

- **Real Protocols**: The platform ingests and analyzes real MQTT and Modbus traffic from simulated or physical IIoT devices.
- **Actionable Intelligence**: Vulnerability and anomaly detection results in meaningful alerts and risk scores surfaced in Wazuh/Peaksoft dashboards.
- **Compliance Automation**: A subset of IEC 62443-4-2 / ETSI EN 303645 controls is automated as code, with summary scores and reports per device or site.
- **Secure & Observable Platform**: Core services are hardened (auth, RBAC, TLS) and observable (health checks, logs, metrics) enough for a basic production-like deployment.

These criteria guide prioritization and help evaluate the project in reviews or a final thesis defense.

---

## 📚 Glossary (Selected Terms)

- **IIoT**: Industrial Internet of Things — connected devices in industrial environments (sensors, controllers, gateways).
- **Wazuh**: Open-source security platform used here as the SOC layer (alerts, dashboards, rules).
- **CVE**: Common Vulnerabilities and Exposures — standardized identifiers for publicly disclosed security vulnerabilities.
- **CPE**: Common Platform Enumeration — naming scheme for IT systems, used to match devices to known CVEs.
- **CVSS**: Common Vulnerability Scoring System — standard for measuring vulnerability severity.
- **IEC 62443 / ETSI EN 303645**: Security and privacy standards relevant to industrial and consumer IoT.

---

## 🔗 Related Documentation

- `docs/Concepts_and_Implementation.md` — detailed architecture, design decisions, and implementation journal.
- `docs/roadmap.md` — phased, day-by-day development roadmap.
- `docs/Intern_Guide.md` — onboarding and role-specific guidance for backend AI & security engineering.

---

*Status: Active Development*

