# StellarStream Contract Analytics Framework - Deployment Guide

This guide details instructions for deploying the StellarStream Contract Analytics Framework across Docker, Systemd (Linux VM), Kubernetes, and Cloud Managed Services.

---

## 1. Prerequisites

- **Node.js**: `v20.0.0` or higher
- **Docker & Docker Compose** (for containerized deployment)
- **Soroban RPC Access**: Valid RPC endpoint (e.g. `https://soroban-testnet.stellar.org` or self-hosted RPC instance)
- **Persistent Volume / Storage**: Directory or cloud disk for SQLite database persistence (`/app/data`)

---

## 2. Docker & Docker Compose Deployment (Recommended)

### Step 1: Clone and Navigate
```bash
git clone https://github.com/jotel-dev/StellarStream.git
cd StellarStream/analytics
```

### Step 2: Configure Environment Variables
Create a production `.env` file:
```bash
cat <<EOF > .env
PORT=4000
NODE_ENV=production
STELLAR_NETWORK=mainnet
SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org
V1_CONTRACT_ID=CB7G2WZJ...
V2_CONTRACT_ID=CC8H3XAK...
INDEXER_POLL_INTERVAL_MS=3000
RETENTION_RAW_EVENTS_DAYS=90
RETENTION_HOURLY_ROLLUP_DAYS=365
RETENTION_DAILY_ROLLUP_DAYS=0
CORS_ORIGIN=https://app.stellarstream.io
EOF
```

### Step 3: Build & Launch with Docker Compose
```bash
docker compose up -d --build
```

### Step 4: Verify Deployment
Check service logs and health endpoint:
```bash
docker compose logs -f stellarstream-analytics
curl http://localhost:4000/health
```

---

## 3. Standalone Linux VM / Systemd Deployment

### Step 1: Install Dependencies & Build
```bash
cd /opt/stellarstream-analytics
npm ci --only=production
npm run build
```

### Step 2: Create Systemd Service Unit
Create `/etc/systemd/system/stellarstream-analytics.service`:
```ini
[Unit]
Description=StellarStream Contract Analytics Service
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/stellarstream-analytics
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=4000
Environment=SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.org
Environment=ANALYTICS_DB_PATH=/var/lib/stellarstream/analytics.json

[Install]
WantedBy=multi-user.target
```

### Step 3: Start and Enable
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stellarstream-analytics
sudo systemctl status stellarstream-analytics
```

---

## 4. Reverse Proxy Setup (Nginx)

To serve the analytics dashboard and API over HTTPS with SSL:

```nginx
server {
    listen 80;
    server_name analytics.stellarstream.io;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name analytics.stellarstream.io;

    ssl_certificate /etc/letsencrypt/live/analytics.stellarstream.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.stellarstream.io/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # SSE Streaming Settings
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
```

---

## 5. Automated Data Retention & Maintenance Cron

To schedule automated daily pruning of historical raw events:

Add to crontab (`crontab -e`):
```cron
0 2 * * * cd /opt/stellarstream-analytics && /usr/bin/npm run prune >> /var/log/stellarstream-retention.log 2>&1
```

---

## 6. Health & Monitoring

| Endpoint | Method | Expected Output | Purpose |
| :--- | :--- | :--- | :--- |
| `/health` | `GET` | `{"status":"healthy", ...}` | Load balancer health checks |
| `/api/v1/analytics/indexer/status` | `GET` | `{"status":"RUNNING", ...}` | Indexer sync ledger tracking |
| `/api/v1/analytics/overview` | `GET` | `{"success":true, ...}` | Core metrics smoke test |

---

## 7. Troubleshooting

- **RPC Timeout / 429 Rate Limit**: Increase `INDEXER_POLL_INTERVAL_MS` (e.g. `5000` or `10000`) or configure an authenticated private Soroban RPC endpoint.
- **SSE connection dropping**: Ensure Nginx/Cloudflare has proxy buffering disabled (`proxy_buffering off;`).
- **Disk usage**: Run `npm run prune` or reduce `RETENTION_RAW_EVENTS_DAYS` in `.env`.
