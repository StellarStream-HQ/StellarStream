# StellarStream Contract Analytics Framework

A high-performance, real-time analytics framework for tracking, processing, and visualizing smart contract usage patterns, Total Value Locked (TVL), user retention cohorts, gas efficiency, and payment streaming dynamics on the Stellar network (Soroban).

---

## 🌟 Key Capabilities & Tracked Metrics

1. **Stream Volume & Velocity**:
   - Streams created per day / week / month with period-over-period growth rates.
   - Total volume deposited and capital streaming throughput.
2. **Multi-Token Total Value Locked (TVL)**:
   - Real-time and historical TVL time series for native XLM, USDC, EURC, and custom Soroban tokens.
   - Active streams vs. completed capital releases.
   - 24-hour and 7-day token TVL delta percentages.
3. **Stream Duration & Amount Distributions**:
   - Average and median stream durations with human-formatted summaries (`14d 6h`).
   - Lifespan bucket distribution (`<1d`, `1-7d`, `7-30d`, `1-3m`, `>3m`).
   - Amount percentiles (`P25`, `P50 (Median)`, `P75`, `P90`, `P99 Whale`).
   - Tiered size categorization (`Micro <$10`, `Small $10-$100`, `Medium $100-$1k`, `Large $1k-$10k`, `Whale >$10k`).
4. **Recipient Withdrawal Behavior**:
   - Withdrawal timing across stream lifecycle quarters (`Q1 (0-25%)`, `Q2 (25-50%)`, `Q3 (50-75%)`, `Q4 (75-100%)`, `Post-Stream`).
   - Claim size patterns (`Micro <10%`, `Partial 10-50%`, `Majority 50-90%`, `Lump Sum >90%`).
   - 24-hour intraday withdrawal frequency distribution.
5. **Stream Cancellation & Churn Dynamics**:
   - Cancellation rate percentages and trends over time.
   - Average active lifespan before stream cancellation.
   - Total refunded capital metrics.
6. **User Retention & Cohort Analysis**:
   - Monthly user cohort retention matrix (`Day 1`, `Day 7`, `Day 14`, `Day 30`, `Day 60`, `Day 90`).
   - Overall repeat streamer rate (`% of senders creating multiple streams`).
   - Unique senders, receivers, and sender-to-receiver ratio.
7. **Gas & Resource Consumption**:
   - CPU instructions, memory footprint, and fee charges (in Stroops and XLM).
   - Cost trends per contract operation (`create`, `withdraw`, `cancel`, `pause`, `resume`).
8. **Feature & Contract Version Adoption**:
   - Breakdown of contract invocations across `V1 Linear Vesting`, `V2 Advanced Curves`, and `V3 Instant Release`.
9. **Automated Historical Data Retention**:
   - High-resolution raw event logging with configurable TTL pruning (`90 days default`).
   - Long-term permanent rollups for daily and monthly statistical aggregates.
10. **Report Export**:
    - Downloadable CSV and JSON reports for streams, metrics, TVL, and retention cohorts with date and asset filters.
11. **Live Real-time Feed**:
    - Server-Sent Events (SSE) stream broadcasting live contract events to dashboards and automated listeners.

---

## 🏛️ Architecture

```
analytics/
├── src/
│   ├── index.ts                      # Framework entrypoint
│   ├── db/                           # Analytics Data Store
│   │   ├── types.ts                  # Schema and entity definitions
│   │   ├── storage.ts                # Thread-safe persistent analytics database
│   │   └── retention.ts              # Data retention and archival engine
│   ├── indexer/                      # Real-time Event Indexer
│   │   ├── types.ts                  # Soroban RPC event interfaces
│   │   ├── event-decoder.ts          # ScVal decoder and symbol resolver
│   │   ├── gas-tracker.ts            # CPU instruction and fee extractor
│   │   ├── stellar-client.ts         # Soroban RPC client wrapper
│   │   └── event-indexer.ts          # Continuous ledger polling & event processor
│   ├── processor/                    # Data Aggregator & Analytics Engine
│   │   ├── types.ts                  # Metric response schemas
│   │   ├── tvl-aggregator.ts         # Multi-asset TVL time-series calculator
│   │   ├── stream-metrics.ts         # Volume, duration, amount, withdrawal & churn analyzer
│   │   ├── retention-cohorts.ts      # User cohort matrix & repeat usage analyzer
│   │   ├── gas-analytics.ts          # Gas & fee cost trends calculator
│   │   ├── export-generator.ts       # CSV / JSON report compiler
│   │   └── metrics-processor.ts      # Master metrics coordinator & daily rollup worker
│   ├── api/                          # REST API & Web Server
│   │   ├── routes.ts                 # /api/v1/analytics endpoints
│   │   └── server.ts                 # Express app & static dashboard server
│   ├── dashboard/                    # Interactive Analytics Dashboard Frontend
│   │   ├── index.html                # Responsive web interface
│   │   ├── styles.css                # Glassmorphic dark mode styling
│   │   └── app.js                    # Canvas charts & real-time SSE listener
│   └── scripts/
│       ├── seed-analytics.ts         # Synthetic test data generator
│       └── run-retention.ts          # Manual/cron retention runner
├── tests/                            # Comprehensive Test Suite
│   ├── indexer.test.ts
│   ├── processor.test.ts
│   ├── retention.test.ts
│   └── api.test.ts
├── Dockerfile                        # Multi-stage container definition
├── docker-compose.yml                # Production Compose configuration
├── package.json
└── tsconfig.json
```

---

## 🚀 Quick Start

### 1. Installation
```bash
cd analytics
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Key environment variables:
| Variable | Description | Default |
| :--- | :--- | :--- |
| `PORT` | HTTP Server Port | `4000` |
| `SOROBAN_RPC_URL` | Stellar Soroban RPC Endpoint | `https://soroban-testnet.stellar.org` |
| `INDEXER_POLL_INTERVAL_MS` | Indexer polling frequency | `3000` |
| `RETENTION_RAW_EVENTS_DAYS` | Raw event TTL (days) | `90` |

### 3. Seed Sample Data (Optional)
To test and preview the dashboard with realistic historical activity:
```bash
npm run seed
```

### 4. Run Locally
```bash
npm run dev
```

Open [http://localhost:4000](http://localhost:4000) in your browser to access the Visualization Dashboard.

---

## 📡 REST API Reference

All endpoints return JSON in the format `{ success: true, data: { ... } }`.

### 1. Overview Summary
`GET /api/v1/analytics/overview`
- Returns executive KPI summary, TVL by token, and recent activity ticker.

### 2. Stream Volume
`GET /api/v1/analytics/streams/volume?timeframe=day|week|month&token=XLM`
- Returns time-bucketed streams created, volume, and period growth.

### 3. Total Value Locked (TVL)
`GET /api/v1/analytics/tvl?token=XLM`
- Returns multi-token TVL breakdown, asset shares, 24h/7d change percentages, and historical snapshots.

### 4. Duration Metrics
`GET /api/v1/analytics/streams/duration`
- Returns mean, median, min, max durations, and histogram distribution buckets.

### 5. Amount Percentiles & Distribution
`GET /api/v1/analytics/streams/amounts?token=XLM`
- Returns average amount, P25/P50/P75/P90/P99 percentiles, and size tiers.

### 6. Withdrawal Patterns
`GET /api/v1/analytics/withdrawals`
- Returns lifecycle quarter timing distribution, withdrawal size buckets, and 24-hour frequency.

### 7. Cancellation Metrics
`GET /api/v1/analytics/cancellations`
- Returns cancellation rates, time-series churn trends, and average active duration before cancellation.

### 8. User Retention Cohorts
`GET /api/v1/analytics/retention`
- Returns monthly cohort matrix (`Day 1, 7, 14, 30, 60, 90`) and repeat streamer ratios.

### 9. Gas & Fee Analytics
`GET /api/v1/analytics/gas?action=create`
- Returns CPU instructions and fee stroops by contract action and time-series.

### 10. Feature & Version Adoption
`GET /api/v1/analytics/features`
- Returns invocation counts and volume by contract feature and version (`V1`, `V2`, `V3`).

### 11. Report Export
`GET /api/v1/analytics/export?type=streams|tvl|daily_rollups|retention|gas|full&format=csv|json`
- Generates downloadable CSV or formatted JSON reports.

### 12. Real-Time Event Stream (SSE)
`GET /api/v1/analytics/events/live`
- Server-Sent Events stream for live contract indexing updates.

---

## 🧪 Testing

Run the Vitest test suite:
```bash
npm run test
```

Test coverage includes:
- Soroban event decoding and topic mapping
- Stream lifecycle state tracking (create, withdraw, cancel, pause)
- TVL, volume, duration, amount, and withdrawal pattern calculations
- Cohort retention and historical pruning policies
- Full API endpoint integration tests and export validation

---

## 📄 License
MIT © StellarStream Protocol Contributors
