# Contract Metrics and Health Checks

Issue: [#1502](https://github.com/StellarStream-HQ/StellarStream/issues/1502)

The contract exposes two read-only functions for production monitoring.

| Function | Returns | Answers |
| --- | --- | --- |
| `health_check()` | `ContractHealth` | Is it up, is it paused, how much is locked? |
| `get_metrics()` | `ContractMetrics` | How much is it being used? |

Neither writes state, so both can be simulated over RPC without fees or a
signing key.

## `health_check() -> ContractHealth`

Point-in-time state.

| Field | Type | Meaning |
| --- | --- | --- |
| `is_paused` | `bool` | Contract is globally paused |
| `active_streams` | `u64` | Streams that have not been closed |
| `total_tvl` | `Map<Address, i128>` | Value still owed to receivers, per token |
| `last_activity_time` | `u64` | Ledger timestamp of the last state change |
| `version` | `u32` | Contract version (`CONTRACT_VERSION`) |

`active_streams` counts streams that have not been cancelled. A stream past its
end time still counts until it is closed, because it still owes its receiver a
withdrawal.

`total_tvl` is per token rather than pooled — summing balances across different
assets would be meaningless.

## `get_metrics() -> ContractMetrics`

Rolling 24-hour usage.

| Field | Type | Meaning |
| --- | --- | --- |
| `streams_created_24h` | `u64` | Streams created in the window |
| `withdrawals_24h` | `u64` | Withdrawals executed in the window |
| `avg_stream_duration` | `u64` | Mean duration of streams created in the window, seconds |
| `avg_stream_amount` | `i128` | Mean size of streams created in the window |
| `unique_users_24h` | `u64` | Distinct addresses active in the window |

Averages cover streams *created* in the window and are `0` when it is empty.

## How this stays cheap

A health endpoint gets polled constantly, so it must not get more expensive as
the contract gets busier. Deriving these numbers on read would do exactly that:
counting active streams or summing TVL means walking every stream.

Instead the counters are maintained as operations happen:

- `create_stream` increments the active count, adds to TVL, and folds the
  amount and duration into the current hour's bucket.
- `withdraw` and `batch_withdraw` subtract from TVL and increment the
  withdrawal count.
- `cancel_stream` decrements the active count and releases whatever the stream
  still owed.

Usage statistics live in **hourly buckets**, so `get_metrics` sums at most 24
entries regardless of traffic. Buckets that fall outside the window are pruned
at most once per hour — the scan is bounded, and repeating it on every
operation within the same hour would be wasted work.

### The one approximation

`unique_users_24h` is capped at `MAX_TRACKED_USERS` (64). Tracking every
distinct address without a bound would make both the write path and the read
grow without limit. Above the cap the count saturates, and addresses already
tracked are still refreshed, so a busy contract keeps reporting its regulars.

**Read it as "at least this many."** If you need exact unique-user counts,
derive them off-chain from events, where there is no gas ceiling.

## Prometheus and Grafana

`examples/prometheus-exporter.ts` simulates both functions and republishes them
on `/metrics`.

```bash
RPC_URL=https://soroban-testnet.stellar.org \
STELLARSTREAM_CONTRACT_ID=C... \
npx tsx examples/prometheus-exporter.ts
```

Exported series, all labelled with `contract`:

| Series | Type | Source |
| --- | --- | --- |
| `stellarstream_up` | gauge | `1` if the contract answered, `0` if the scrape failed |
| `stellarstream_paused` | gauge | `health.is_paused` |
| `stellarstream_active_streams` | gauge | `health.active_streams` |
| `stellarstream_tvl{token}` | gauge | `health.total_tvl`, one series per token |
| `stellarstream_last_activity_timestamp_seconds` | gauge | `health.last_activity_time` |
| `stellarstream_contract_version` | gauge | `health.version` |
| `stellarstream_streams_created_24h` | gauge | `metrics.streams_created_24h` |
| `stellarstream_withdrawals_24h` | gauge | `metrics.withdrawals_24h` |
| `stellarstream_avg_stream_duration_seconds` | gauge | `metrics.avg_stream_duration` |
| `stellarstream_avg_stream_amount` | gauge | `metrics.avg_stream_amount` |
| `stellarstream_unique_users_24h` | gauge | `metrics.unique_users_24h` |

A failed scrape reports `stellarstream_up 0` rather than erroring, so the
"contract unreachable" alert is driven by a metric instead of by Prometheus's
own scrape health.

### Scrape config

```yaml
# prometheus.yml
global:
  scrape_interval: 30s

scrape_configs:
  - job_name: stellarstream
    static_configs:
      - targets: ["stellarstream-exporter:9101"]
```

### Example setup

```yaml
# docker-compose.yml
services:
  exporter:
    build: ./contracts/Contract-V1/examples
    environment:
      RPC_URL: https://soroban-testnet.stellar.org
      NETWORK_PASSPHRASE: "Test SDF Network ; September 2015"
      STELLARSTREAM_CONTRACT_ID: "C..."
      PORT: "9101"
    ports: ["9101:9101"]

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:latest
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    ports: ["3000:3000"]
    depends_on: [prometheus]
```

### Alerts worth having

```yaml
groups:
  - name: stellarstream
    rules:
      - alert: ContractUnreachable
        expr: stellarstream_up == 0
        for: 5m
        annotations:
          summary: "Health check failing for {{ $labels.contract }}"

      - alert: ContractPaused
        expr: stellarstream_paused == 1
        for: 1m
        annotations:
          summary: "Contract {{ $labels.contract }} is paused"

      - alert: TVLDropped
        expr: >
          delta(stellarstream_tvl[15m])
            / (stellarstream_tvl offset 15m) < -0.2
        for: 5m
        annotations:
          summary: "TVL fell more than 20% in 15m on {{ $labels.token }}"

      - alert: NoActivity
        expr: >
          time() - stellarstream_last_activity_timestamp_seconds > 86400
        for: 30m
        annotations:
          summary: "No state change in 24h — indexer or integration may be down"
```

### Grafana panels

| Panel | Query |
| --- | --- |
| Status | `stellarstream_up`, `stellarstream_paused` as stat panels |
| TVL by token | `stellarstream_tvl` — time series, legend `{{token}}` |
| Active streams | `stellarstream_active_streams` |
| Creations vs withdrawals | `stellarstream_streams_created_24h` and `stellarstream_withdrawals_24h` |
| Mean stream size | `stellarstream_avg_stream_amount` |
| Active users | `stellarstream_unique_users_24h` |

## Tests

`src/metrics_test.rs`:

```
cargo test --lib metrics_test
```

| Test | Proves |
| --- | --- |
| `test_health_check_on_fresh_contract` | Sensible zeroes, correct version |
| `test_health_tracks_active_streams_and_tvl` | Creation moves both counters |
| `test_tvl_is_per_token` | Tokens are tracked separately |
| `test_withdraw_reduces_tvl` | Withdrawn value leaves TVL |
| `test_cancel_decrements_active_and_releases_tvl` | Closing releases the remainder |
| `test_health_reports_paused_state` | Pause and unpause are reflected |
| `test_metrics_on_fresh_contract` | Empty window returns zeroes, no divide by zero |
| `test_metrics_count_creations_and_withdrawals` | Both operations counted |
| `test_metrics_average_duration_and_amount` | Averages are correct |
| `test_metrics_unique_users` | Participants counted once, not per operation |
| `test_metrics_window_rolls_forward` | Old activity leaves the window |
| `test_metrics_sum_across_hourly_buckets` | Buckets are summed |
| `test_unique_users_is_capped` | Count saturates; creations still all counted |
| `test_monitoring_endpoints_are_read_only` | Polling does not perturb what is reported |
