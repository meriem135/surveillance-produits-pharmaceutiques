# Development Guide: Backend AI & Security Engineering

This guide outlines the responsibilities and roadmap for the engineering role focused on the **Intelligence Layer** of the Peaksoft Security Platform.

---

## 🎯 Purpose & Audience

- **Who this is for**: Interns and engineers working on the backend **Intelligence Layer** (data ingestion, AI, compliance, and security hardening).
- **What you get from it**:
  - A clear view of your responsibilities and expected outcomes.
  - A 6‑month learning and delivery roadmap.
  - Practical guidance on how to work day‑to‑day on the project.

For high-level context on the platform, see `docs/Project overview.md`. For detailed architectural decisions and implementation notes, see `docs/Concepts_and_Implementation.md` and `docs/roadmap.md`.

---

## Role Descriptions

The project is divided into two primary tracks to ensure focused development:

### 🧠 Track A: Security Intelligence Lead
Independent lead for **Behavioral Digital-Twin Analysis** and AI threat detection.
- **Key Tasks**: [Track A Tasks](./Intern_A_Tasks.md) (MQTT, AI, CVEs, Threat UI)

### 💻 Track B: Governance & Reliability Lead
Independent lead for **Structural Digital-Twin Platform** and compliance automation.
- **Key Tasks**: [Track B Tasks](./Intern_B_Tasks.md) (Modbus, Compliance, Facility Sync, Audit UI)

| Objective | Description | Track A Independent Work | Track B Independent Work |
| :--- | :--- | :--- | :--- |
| **7.1** | Vulnerability Management | **CVE Risk Prediction Engine** | N/A |
| **7.2** | Protocol Interfaces | **MQTT DPI Service** | **Modbus Polling Service** |
| **7.3** | Compliance Automation | N/A | **IEC 62443 Engine & PDF Reports** |
| **7.4** | Digital-Twin Analysis | **Behavioral Modeling (AI)** | **Structural Modeling (Policy)** |
| **7.5** | Multi-facility Integration | N/A | **Multi-Site Scoping & Isolation** |

## 🚀 Getting Started

### 1. Environment Setup

- Clone the repository and review the docs in the `docs/` folder.
- Ensure you have:
  - Python **3.10+**
  - Docker & Docker Compose
  - A working PostgreSQL + Wazuh Docker stack (see `wazuh-docker/multi-node/docker-compose.yml`).
- Run the core stack:
  - From the project root, bring up the Docker services as documented in the main README.
  - Seed the database using `iot-security-backend/scripts/seed_db.sh` when required.

### 2. Running the Backend

- Navigate to the backend service directory (e.g. `iot-security-backend/`).
- Install dependencies in a virtual environment.
- Start the FastAPI app (typically via `uvicorn` or Docker, depending on the current setup).
- Verify key endpoints (`/health`, basic CRUD endpoints) respond correctly.

---

## 🛠 Development Operations

Use these commands to manage and rebuild the environment components from the project root.

### One-Click Environment Setup
If you are starting from scratch or want to reset the entire environment:
- **Run Setup Script**: `./scripts/setup.sh`
  - *What it does*: Generates SSL certificates, builds both the AI backend and rebranded dashboard, starts all containers, and seeds the database.

### Core Stack Management
- **Start Everything**: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml up -d`
- **Stop Everything**: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml down`
- **Restart Specific Service**: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml restart <service_name>` (e.g., `wazuh.dashboard`, `iot-security-backend`)

### Rebuilding Components
- **Rebuild Backend**: `docker-compose -f wazuh-docker/multi-node/docker-compose.yml up -d --build iot-security-backend`
- **Rebuild Dashboard (with Plugins)**:
  ```bash
  cd wazuh-dashboard/docker-custom && ./build_robust.sh
  ```
  *Note: This takes 10-15 minutes as it compiles all frontend plugins.*

### Data & Simulation
- **Seed Database**: `./iot-security-backend/scripts/seed_db.sh`
- **Run IoT Simulators**: `./iot-security-backend/scripts/run_simulator.sh`
- **Generate SSL Certs**:
  ```bash
  cd wazuh-docker/multi-node && docker-compose -f generate-indexer-certs.yml run --rm generator
  ```

---

### 3. First Tasks (Recommended)

- Read through:
  - `docs/Concepts_and_Implementation.md` (architecture & design decisions).
  - `docs/roadmap.md` (day-by-day/phase-by-phase tasks).
- Pick a small, well-scoped task (e.g. add a simple endpoint, improve logging, or extend a model) and complete it with tests and a small doc update.

---

## 🧭 Daily Workflow

- **Branching**
  - **Main Tracks**: Work is organized into two primary track branches:
    - `track/ai-ds`: Base branch for Intern A.
    - `track/platform`: Base branch for Intern B.
  - **Feature Branches**: Use descriptive branch names off your track branch: `feature/mqtt-parsing`, `fix/telemetry-schema`.
  - **Integration**: Track branches are merged into `develop` once a milestone is reached. `main` is reserved for stable production releases.
- **Commits & PRs**
  - Keep commits small and focused.
  - Reference roadmap items or tickets in commit messages/PR descriptions where possible.
- **Code Reviews**
  - Expect feedback on:
    - Correctness and error handling.
    - Security implications (authentication, validation, logging of sensitive data).
    - Performance and async correctness.
- **Documentation Habit**
  - For any non-trivial change, update:
    - Relevant doc section in `docs/` (e.g. Concepts journal or roadmap).
    - Inline docstrings and type hints.

---

## 6-Month Roadmap

This roadmap aligns with the project’s 4 tracks (Protocols, AI/Data, Compliance, Hardening) and the phases described in `docs/Project overview.md` and `docs/roadmap.md`.

### Phase 1: AI & Protocol Core (Months 1–2)
- [ ] **Objective 7.1**: Initialize AI-based vulnerability management system.
- [ ] **Objective 7.2**: Complete AI-based communication interfaces for Modbus/MQTT.

### Phase 2: Intelligence & Twin Integration (Months 3–4)
- [ ] **Objective 7.4**: Implement AI/Digital-Twin features for vulnerability analysis.
- [ ] **Integration**: Connect backend AI models to the Wazuh Dashboard.

### Phase 3: Compliance & Facility Rollout (Months 5–6)
- [ ] **Objective 7.3**: Automate IEC 62443 / ETSI EN 303645 compliance checks.
- [ ] **Objective 7.5**: Integrate the solution with multiple facility endpoints and document results.

---

## 💻 Technical Stack & Coding Standards

### Core Stack

- **Languages**: Python 3.10+
- **Frameworks**: FastAPI, Pydantic / SQLModel
- **Architecture**: Domain-Driven Service Design with Repository Pattern
- **Database**: PostgreSQL (SQLAlchemy/SQLModel)
- **Messaging**: MQTT (gmqtt), Modbus (pymodbus)
- **Security**: Wazuh, OpenSearch

### Coding Standards (Minimum Bar)

- **Type Hints**: Use Python type hints for all public functions and methods.
- **Docstrings**: Add docstrings for complex functions, services, and models.
- **Async First**: Prefer async I/O for network and DB calls; avoid blocking inside request handlers.
- **Validation & Error Handling**:
  - Always validate external input (MQTT payloads, API requests).
  - Fail gracefully with informative log messages; avoid crashing the whole process.
- **Security Hygiene**:
  - Never commit secrets; use environment variables or Vault.
  - Log carefully (no passwords, tokens, or sensitive payloads).

Following these guidelines will help you build features that fit cleanly into the broader PeakSoft platform and make it easier for others to review and extend your work.

