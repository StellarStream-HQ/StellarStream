# Architecture Documentation

## System Overview

The StellarStream Event Watcher is a production-grade service that monitors the Stellar blockchain for events emitted by the StellarStream smart contract. It implements a polling-based architecture with robust error handling, automatic retries, and graceful degradation.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Event Watcher Service                    │
│                                                              │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────┐  │
│  │   index.ts   │─────▶│ EventWatcher │─────▶│  Logger  │  │
│  │  (Entry)     │      │   (Core)     │      │          │  │
│  └──────────────┘      └──────┬───────┘      └──────────┘  │
│                               │                              │
│                               │                              │
│                        ┌──────▼───────┐                      │
│                        │ EventParser  │                      │
│                        │ (XDR Decode) │                      │
│                        └──────────────┘                      │
│                                                              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ RPC Calls
                         │
                         ▼
              ┌──────────────────────┐
              │   Stellar RPC Node   │
              │  (Soroban Network)   │
              └──────────────────────┘
                         │
                         │ Blockchain Data
                         │
                         ▼
              ┌──────────────────────┐
              │  Stellar Blockchain  │
              │  (StellarStream      │
              │   Smart Contract)    │
              └──────────────────────┘
```

## Component Breakdown

### 1. Entry Point (`index.ts`)

**Responsibilities:**
- Process initialization and configuration loading
- Signal handling (SIGINT, SIGTERM) for graceful shutdown
- Global error handling (uncaughtException, unhandledRejection)
- Service lifecycle management

**Key Features:**
- Clean shutdown on termination signals
- Automatic restart on crashes (when using process managers)
- Environment validation before startup

### 2. Configuration (`config.ts`)

**Responsibilities:**
- Load and validate environment variables
- Provide type-safe configuration access
- Singleton pattern for config caching

**Validation Rules:**
- Required: `STELLAR_RPC_URL`, `CONTRACT_ID`
- Optional: Polling intervals, retry settings, log levels
- Format validation for CONTRACT_ID (56 chars, starts with 'C')

### 3. Event Watcher (`event-watcher.ts`)

**Responsibilities:**
- Main polling loop implementation
- Cursor management (tracks last processed ledger)
- Error handling and retry logic
- Event processing orchestration

**State Management:**
```typescript
interface WatcherState {
  lastProcessedLedger: number;  // Cursor position
  isRunning: boolean;            // Service status
  errorCount: number;            // Consecutive errors
  lastError?: Error;             // Last error for debugging
}
```

**Polling Algorithm:**
```
1. Initialize cursor to latest ledger
2. Loop while running:
   a. Fetch events from (lastProcessedLedger + 1)
   b. Parse and process each event
   c. Update cursor to highest ledger seen
   d. Sleep for POLL_INTERVAL_MS
   e. On error: exponential backoff, increment errorCount
   f. If errorCount > MAX_RETRIES: shutdown
```

**Error Handling Strategy:**
- **Transient Errors**: Retry with exponential backoff
- **Persistent Errors**: Log and shutdown after MAX_RETRIES
- **Network Errors**: Automatic reconnection on next poll
- **Parse Errors**: Skip event, log warning, continue

### 4. Event Parser (`event-parser.ts`)

**Responsibilities:**
- XDR decoding of Stellar event data
- ScVal parsing to JavaScript types
- Event type extraction from topics

**Supported ScVal Types:**
- Primitives: bool, u32, i32, u64, i64, u128, i128, u256, i256
- Complex: bytes, string, symbol, address
- Collections: vec (arrays), map (objects)
- Special: void, contract instances

**Parsing Strategy:**
```typescript
Raw Event (XDR)
  ↓
parseContractEvent()
  ↓
ParsedContractEvent {
  topics: string[]     // Base64 XDR
  value: unknown       // Parsed JS value
}
  ↓
extractEventType()
  ↓
Event Type String (e.g., "stream_created")
```

### 5. Logger (`logger.ts`)

**Responsibilities:**
- Structured logging with timestamps
- Log level filtering (debug, info, warn, error)
- JSON-formatted output for log aggregation

**Log Levels:**
- `DEBUG`: Detailed diagnostic information
- `INFO`: General informational messages
- `WARN`: Warning messages (non-critical issues)
- `ERROR`: Error messages with stack traces

## Data Flow

### Event Processing Pipeline

```
1. RPC Poll
   └─▶ server.getEvents({ startLedger, filters })

2. Response Validation
   └─▶ Check for events array
   └─▶ Update cursor even if empty

3. Event Parsing
   └─▶ parseContractEvent(rawEvent)
   └─▶ XDR decoding
   └─▶ ScVal parsing

4. Event Type Extraction
   └─▶ extractEventType(topics)
   └─▶ First topic = event name

5. Event Handling
   └─▶ handleEventByType(type, event)
   └─▶ Custom business logic
   └─▶ Database persistence (optional)
   └─▶ Webhook notifications (optional)

6. Logging
   └─▶ logger.event(type, data)
   └─▶ Structured JSON output
```

## Scalability Considerations

### Horizontal Scaling

**Challenge**: Multiple instances would process duplicate events

**Solutions**:
1. **Leader Election**: Use Redis/etcd for distributed locking
2. **Partition by Contract**: Each instance watches different contracts
3. **Event Queue**: Single watcher → queue → multiple processors

### Vertical Scaling

**Current Limits**:
- Single-threaded Node.js process
- Memory: ~50MB baseline + event buffer
- CPU: Minimal (mostly I/O bound)

**Optimization Opportunities**:
- Batch event processing (already implemented: 100 events/poll)
- Parallel event parsing (Worker threads)
- Connection pooling for database writes

### Performance Metrics

**Typical Performance** (5s poll interval):
- Latency: 5-10 seconds from on-chain to logged
- Throughput: ~1200 events/minute (100 events × 12 polls/min)
- Memory: ~50-100MB
- CPU: <5% on modern hardware

## Reliability Features

### 1. Cursor Persistence

**Current**: In-memory (lost on restart)

**Production Enhancement**:
```typescript
// Save cursor to disk/database
private async saveCursor(ledger: number): Promise<void> {
  await fs.writeFile('.cursor', ledger.toString());
}

// Load cursor on startup
private async loadCursor(): Promise<number> {
  try {
    const data = await fs.readFile('.cursor', 'utf-8');
    return parseInt(data, 10);
  } catch {
    return 0; // Start from latest if no cursor
  }
}
```

### 2. Idempotency

**Event IDs**: Each event has unique ID (`ledger-sequence`)
- Prevents duplicate processing
- Enables safe retries
- Supports exactly-once semantics (with database deduplication)

### 3. Circuit Breaker

**Implementation**:
```typescript
errorCount++;
if (errorCount >= MAX_RETRIES) {
  logger.error("Circuit breaker triggered");
  await stop();
}
```

**Benefits**:
- Prevents cascading failures
- Allows RPC endpoint to recover
- Triggers alerts for manual intervention

### 4. Graceful Shutdown

**Signal Handling**:
```typescript
process.on('SIGTERM', async () => {
  await watcher.stop();
  await closeConnections();
  process.exit(0);
});
```

**Ensures**:
- In-flight requests complete
- Cursor saved to persistent storage
- Database connections closed
- Clean process termination

## Security Considerations

### 1. Environment Variables

- Never commit `.env` to version control
- Use secrets management (AWS Secrets Manager, HashiCorp Vault)
- Rotate RPC credentials regularly

### 2. RPC Endpoint Security

- Use HTTPS endpoints only (enforced in config)
- Implement rate limiting to avoid bans
- Monitor for suspicious activity

### 3. Input Validation

- Validate CONTRACT_ID format
- Sanitize event data before logging
- Prevent XSS in web dashboards

### 4. Error Information Disclosure

- Don't log sensitive data in errors
- Sanitize stack traces in production
- Use error codes instead of detailed messages

## Monitoring & Observability

### Key Metrics to Track

1. **Service Health**
   - Uptime percentage
   - Last successful poll timestamp
   - Error rate (errors/minute)

2. **Performance**
   - Poll duration (ms)
   - Events processed per second
   - Cursor lag (latest ledger - lastProcessedLedger)

3. **Business Metrics**
   - Events by type (stream_created, withdrawn, etc.)
   - Transaction volume
   - Active streams count

### Recommended Tools

- **Metrics**: Prometheus + Grafana
- **Logs**: ELK Stack or Grafana Loki
- **Tracing**: Jaeger or Zipkin
- **Alerting**: PagerDuty or Opsgenie

## Future Enhancements

### 1. Database Integration

```typescript
interface EventRepository {
  save(event: ParsedContractEvent): Promise<void>;
  findByTxHash(hash: string): Promise<ParsedContractEvent | null>;
  findByLedger(ledger: number): Promise<ParsedContractEvent[]>;
}
```

### 2. REST API

```typescript
app.get('/api/events', async (req, res) => {
  const { startLedger, endLedger, type } = req.query;
  const events = await eventRepo.find({ startLedger, endLedger, type });
  res.json(events);
});
```

### 3. WebSocket Streaming

```typescript
wss.on('connection', (ws) => {
  watcher.on('event', (event) => {
    ws.send(JSON.stringify(event));
  });
});
```

### 4. Event Replay

```typescript
async function replayEvents(fromLedger: number, toLedger: number) {
  for (let ledger = fromLedger; ledger <= toLedger; ledger++) {
    const events = await server.getEvents({ startLedger: ledger });
    await processEvents(events);
  }
}
```

## Deployment Patterns

### 1. Single Instance (Development)

```bash
npm run dev
```

### 2. PM2 (Production)

```bash
pm2 start dist/index.js --name stellarstream-watcher
pm2 monit
```

### 3. Docker (Containerized)

```bash
docker build -t stellarstream-watcher .
docker run -d --env-file .env stellarstream-watcher
```

### 4. Kubernetes (Cloud Native)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stellarstream-watcher
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: watcher
        image: stellarstream-watcher:latest
        envFrom:
        - secretRef:
            name: stellarstream-secrets
```

## Testing Strategy

### Unit Tests

```typescript
describe('EventParser', () => {
  it('should parse stream_created event', () => {
    const event = mockEvent();
    const parsed = parseContractEvent(event);
    expect(parsed.type).toBe('contract');
  });
});
```

### Integration Tests

```typescript
describe('EventWatcher', () => {
  it('should fetch and process events', async () => {
    const watcher = new EventWatcher(testConfig);
    await watcher.start();
    // Wait for events
    await sleep(10000);
    const state = watcher.getState();
    expect(state.lastProcessedLedger).toBeGreaterThan(0);
  });
});
```

### End-to-End Tests

1. Deploy contract to testnet
2. Start watcher
3. Execute contract transactions
4. Verify events logged correctly
5. Check cursor advancement

## Troubleshooting Guide

### Issue: No events appearing

**Diagnosis**:
```bash
# Check RPC connectivity
curl https://soroban-testnet.stellar.org/health

# Verify contract ID
stellar contract info --id CXXX... --network testnet

# Check logs for errors
tail -f logs/watcher.log | grep ERROR
```

### Issue: High error rate

**Diagnosis**:
- Check RPC rate limits
- Verify network connectivity
- Review error messages in logs
- Check Stellar network status

### Issue: Memory leak

**Diagnosis**:
```bash
# Monitor memory usage
ps aux | grep node

# Enable heap snapshots
node --inspect dist/index.js
```

## Error Handling Strategy (Issue #1150)

All backend services share a single, consistent error-handling pipeline built
on three layers. Together they guarantee that:

- Services never leak raw exceptions to callers.
- API responses always have the same `{ success, data, error, code, details, requestId }` shape.
- Stack traces and internal infrastructure details are stripped from HTTP
  responses in production, while remaining fully available to Sentry and the
  structured logger.
- Per-request correlation ids allow tracing errors from a single response
  through every log line and Sentry event.

### Layer 1 — AppError hierarchy (`backend/src/lib/app-error.ts`)

The `AppError` base class carries a stable `code` (e.g. `ERR_NOT_FOUND`), the
HTTP `statusCode` it maps to, optional structured `details`, and the ES2022
`cause` chain. Subclasses encode the most common HTTP failure modes:

| Class                   | Status | Code                       | Use for                              |
|------------------------|--------|----------------------------|--------------------------------------|
| `ValidationError`       | 400    | `ERR_VALIDATION`           | Generic input validation failure      |
| `MissingFieldError`     | 400    | `ERR_VALIDATION`           | A required field was omitted          |
| `UnauthorizedError`     | 401    | `ERR_UNAUTHORIZED`         | Caller is not authenticated           |
| `ForbiddenError`        | 403    | `ERR_FORBIDDEN`            | Caller lacks permission               |
| `NotFoundError`         | 404    | `ERR_NOT_FOUND`            | Resource does not exist               |
| `ConflictError`         | 409    | `ERR_CONFLICT`             | State conflict (e.g. non-DRAFT draft) |
| `BusinessRuleError`     | 422    | `ERR_BUSINESS_RULE`        | Well-formed but violates business     |
| `RateLimitError`        | 429    | `ERR_RATE_LIMIT`           | Caller exceeded rate limit            |
| `InternalError`         | 500    | `ERR_INTERNAL`             | Unexpected programming / runtime bug |
| `ConfigurationError`    | 500    | `ERR_CONFIGURATION`        | Service misconfigured                |
| `ExternalServiceError`  | 502    | `ERR_EXTERNAL_SERVICE`     | Upstream (RPC, Horizon) failed       |
| `ServiceUnavailableError` | 503  | `ERR_SERVICE_UNAVAILABLE`  | Dependency down                      |

The `isOperational` flag distinguishes expected caller-facing errors
(operational = true) from programming bugs (operational = false). Non-
operational errors are forwarded to Sentry; operational errors are not.

Two helpers reduce boilerplate at the service / middleware boundary:

- `isAppError(err)` — typed guard, `err is AppError`.
- `toAppError(err)` — coerces any thrown value (including `ZodError`) into
  an `AppError`. The error middleware calls this on every error.

### Layer 2 — `errorHandler` middleware (`backend/src/middleware/errorHandler.ts`)

Registered as `app.use(errorHandler)` after all routes and the Sentry
safety-net handler. For every error:

1. Coerces to `AppError` via `toAppError`.
2. Writes a structured log line (method, path, ip, requestId, error
   context). Operational 4xx are logged at WARN; everything else at ERROR
   with the full stack.
3. Forwards non-operational errors (and any `InternalError`) to
   `Sentry.captureException` inside a tagged scope so the corresponding
   Sentry event carries the same `requestId` / `errorCode` as the
   structured log line.
4. Renders the response body:

```json
{
  "success": false,
  "data": null,
  "error": "Stream not found: abc-123",
  "code": "ERR_NOT_FOUND",
  "details": { "resource": "Stream", "identifier": "abc-123" },
  "requestId": "9b6c3d2a-..."
}
```

   In production, the `stack` field is omitted and any non-operational
   error message is replaced with `"An unexpected error occurred"` so
   callers never see internal infrastructure details. The body ALWAYS
   includes `data: null` so the existing `responseWrapper` middleware
   takes its pass-through branch and forwards every field (including
   `requestId` and `stack`) instead of dropping them.

5. If `res.headersSent` is already `true`, the handler delegates to
   Express's default handler so the connection is closed cleanly
   instead of trying to write headers twice.

`buildErrorResponseBody` is exported for non-Express call sites
(workers, schedulers) that want the same response shape for their own
error logs.

### Layer 3 — `requestId` middleware (`backend/src/middleware/requestId.ts`)

Registered as `app.use(requestIdMiddleware)` immediately after body
parsing and auth. It attaches a `req.id` (echoing the upstream
`x-request-id` header when present, otherwise a fresh UUID), sets the
`x-request-id` response header, and declares an Express module
augmentation so `req.id` is typed.

Security: the upstream id is filtered to printable ASCII (no CR/LF/TAB
or other control characters) before being trusted — otherwise an
attacker could smuggle fake log lines into structured logs via
control-character-laden headers.

Every error log and response body carries this id for cross-system
correlation with Sentry and client-side bug reports.

### Accepted response shape

In combination with the existing `responseWrapper` middleware, every API
response conforms to:

```json
{
  "success": true | false,
  "data":    <payload | null>,
  "error":   <localised human-readable message | null>,
  "code":    "<stable machine code>",
  "details": <optional structured metadata>,
  "requestId": "<per-request correlation id>"
}
```

Clients should branch on `code` (stable string) and `success` (boolean),
**not** on the localised `error` string.

### Migration plan

This PR lands the **foundation**: the hierarchy, both middlewares, and
35 tests covering them. Migration of the remaining ~75 services to throw
`AppError` subclasses will follow in separate, scoped PRs:

1. Auth, wallet, and KYC services.
2. Streams, snapshots, and audit log services.
3. Background workers and schedulers (catch blocks within `.catch(...)`).
4. Routes and granular request validation — including migrating
   `backend/src/middleware/validateRequest.ts` to `next(err)` for
   `ZodError` so a single error-code style flows through the centralized
   handler.

## Conclusion

This architecture provides a solid foundation for monitoring Stellar smart contracts. It's designed to be:

- **Reliable**: Automatic retries, graceful degradation
- **Maintainable**: Clean separation of concerns, typed interfaces
- **Observable**: Structured logging, metrics-ready
- **Extensible**: Easy to add database, API, webhooks
- **Production-Ready**: Error handling, shutdown logic, monitoring hooks
