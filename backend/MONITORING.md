# Event Watcher Monitoring Dashboard

This document describes the monitoring setup for the separated Event Watcher service.

## Health Endpoints

### Event Watcher Service
- **URL**: `http://localhost:3001/health`
- **Method**: GET
- **Response**: JSON with health status, processed ledger count, and running state

### API Service Event Watcher Status
- **URL**: `http://localhost:3000/event-watcher-status`
- **Method**: GET  
- **Response**: JSON with health status, latest status from pub/sub, and processing latency

### Metrics Endpoint (Prometheus Compatible)
- **URL**: `http://localhost:3001/metrics`
- **Method**: GET
- **Format**: Prometheus metrics format
- **Metrics**:
  - `event_watcher_running`: 1 if running, 0 if stopped
  - `event_watcher_last_processed_ledger`: Last processed ledger number
  - `event_watcher_health_status`: 1 if healthy, 0 if unhealthy

## Key Metrics to Monitor

### Service Health
- Event watcher process uptime
- API service connectivity to event watcher
- Redis pub/sub channel status
- Distributed lock ownership

### Performance Metrics
- Event processing latency (target: < 3 seconds)
- Cursor update frequency
- Lock renewal success rate
- Memory usage per service

### Error Conditions
- Failed lock acquisitions
- Redis connection failures
- Event processing errors
- Graceful shutdown timeouts

## Alerting Rules

### Critical Alerts
1. **Event Watcher Down**: Service not responding to health checks
2. **High Processing Latency**: Processing latency > 3 seconds for 5+ minutes
3. **Lock Conflicts**: Multiple instances trying to acquire lock
4. **Redis Connection Lost**: Cannot connect to Redis for cursor state

### Warning Alerts
1. **Memory Usage High**: Memory usage > 80% of allocated limit
2. **Processing Delays**: Processing latency > 1 second but < 3 seconds
3. **Lock Renewal Issues**: Lock renewal failures (potential split-brain)

## Sample Grafana Queries

### Event Processing Latency
```promql
event_watcher_processing_latency_seconds
```

### Service Uptime
```promql
up{job="event-watcher"}
```

### Processed Ledgers Rate
```promql
rate(event_watcher_last_processed_ledger[5m])
```

## PM2 Monitoring

```bash
# Check service status
pm2 status

# Monitor logs
pm2 logs stellarstream-event-watcher

# Monitor API service
pm2 logs stellarstream-api

# Restart services
pm2 restart stellarstream-event-watcher
```

## Docker Health Checks

The event watcher service includes health check configuration in docker-compose.yml:

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
  interval: 10s
  timeout: 5s
  retries: 3
```

## Troubleshooting

### Event Watcher Not Starting
1. Check Redis connectivity
2. Verify environment variables (STELLAR_RPC_URL, V3_CONTRACT_ID)
3. Check if another instance holds the distributed lock
4. Review error logs for startup issues

### High Processing Latency
1. Check Stellar RPC endpoint performance
2. Verify database connection performance
3. Monitor Redis pub/sub latency
4. Check for CPU starvation (should be isolated now)

### Lock Conflicts
1. Check if multiple instances are configured
2. Verify Redis TTL settings
3. Check for split-brain scenarios (network partitions)
4. Review lock renewal logs

### Memory Leaks
1. Monitor memory usage trends
2. Check for unclosed database connections
3. Verify proper cleanup in shutdown handlers
4. Review Redis connection pooling
