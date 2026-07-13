# Wazuh Dashboard Custom Project

This project contains the local development environment for building and running a custom **Wazuh Dashboard** using Docker.

## Project Structure
- `wazuh-dashboard/`: Source code and Dockerfile for the custom dashboard image.
- `wazuh-docker/`: Official Docker environment (multi-node setup used for running the cluster).

## Setup & Run Instructions

### 1. Environment Setup

```bash
# Ensure you are in the project root
mkdir -p work/wazuh-custom-project
cd work/wazuh-custom-project

# Clone Wazuh Docker repo (for infrastructure)
git clone https://github.com/wazuh/wazuh-docker.git
cd wazuh-docker
git checkout v4.10.3
cd ..

# Get Wazuh Dashboard source (v4.10.3)
wget https://github.com/wazuh/wazuh-dashboard/archive/refs/tags/v4.10.3.tar.gz -O wazuh-dashboard.tar.gz
tar -xf wazuh-dashboard.tar.gz
mv wazuh-dashboard-4.10.3 wazuh-dashboard
```

### 2. Generate Certificates
Required for the Wazuh 4.x multi-node stack.

```bash
cd wazuh-docker/multi-node
docker-compose -f generate-indexer-certs.yml run --rm generator
```

### 3. Build Custom Dashboard Image
We use a custom `Dockerfile` in `wazuh-dashboard/` that extends the official image.

```bash
cd ../../wazuh-dashboard
docker build -t my-wazuh-dashboard:dev .
```

> **Note:** A full source build (`yarn osd bootstrap`) requires unrestricted network access. The current Dockerfile uses a lightweight customization strategy to ensure stability.

### 4. Run the Environment configuration
We use the multi-node `docker-compose.yml` but point the dashboard service to our custom image.

**Configuration Change:**
In `wazuh-docker/multi-node/docker-compose.yml`, update the `wazuh.dashboard` service:
```yaml
wazuh.dashboard:
  image: my-wazuh-dashboard:dev  # Changed from wazuh/wazuh-dashboard:4.10.3
  ...
```

**Start Services:**
```bash
cd ../wazuh-docker/multi-node
docker-compose up -d
```

### 6. Development & Code Updates

The current `Dockerfile` uses a **lightweight** strategy (skipping `yarn build`) to ensure setup success.
**If you make code changes**, they will NOT be reflected unless you enable the full build process.

To enable full build (requires good network connection):
1. Open `wazuh-dashboard/Dockerfile`.
2. Comment out the "Lightweight" section.
3. Uncomment the "Build from source" section (see file).
4. Rebuild: `docker build -t my-wazuh-dashboard:dev .`

   ```bash
   docker ps
   # Verify 'multi-node-wazuh.dashboard-1' is UP
   ```

2. **Verify Customization:**
   ```bash
   docker exec multi-node-wazuh.dashboard-1 cat /usr/share/wazuh-dashboard/CUSTOM_BUILD
   # Should output: "Custom Build - Verified at <date>"
   ```

3. **Access UI:**
   Open [https://localhost](https://localhost) in your browser.
   - Default Port: 443 (mapped to 5601)
   - Login: `admin` / `SecretPassword` (check `docker-compose.yml` for exact credentials if changed).

## Troubleshooting

- **Build Network Errors:** If `yarn install` fails during build, the Dockerfile falls back to extending the base image directly.
- **Certificate Errors:** If containers exit immediately, ensure Step 2 (Generate Certificates) was completed successfully.
