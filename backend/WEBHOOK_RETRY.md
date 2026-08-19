# Webhook Retry Logic & Dead Letter Queue

Implements issue #1348. Covers how a failed webhook delivery is retried, when
it is abandoned, and how to inspect and replay the queue.

## Why the previous implementation delivered nothing

`WebhookDelivery` carried a `webhookId` column but the Prisma schema declared no
relation to `Webhook`. The dispatcher's queue query used
`include: { webhook: true }`, which Prisma rejects for a model without that
relation, so **every** call to `processDeliveries()` threw before sending a
single request. The migration in
`prisma/migrations/20260728120000_add_webhook_retry_dead_letter` adds the
foreign key; the rest of this document describes the retry behaviour built on
top of it.

## Delivery lifecycle

```
                 ┌──────────┐
  dispatch() ───▶│ pending  │◀──────────────┐
                 └────┬─────┘               │
                      │ claimed by worker   │ retryable failure,
                      ▼                     │ budget remaining
                 ┌────────────┐             │
                 │ delivering │─────────────┘
                 └────┬───┬───┘
              2xx     │   │   permanent failure, or
                      │   │   attempts == maxRetries
                      ▼   ▼
              ┌─────────┐ ┌─────────────┐
              │ success │ │ dead_letter │──▶ manual retry ──▶ pending
              └─────────┘ └─────────────┘
```

A claim left in `delivering` for longer than 5 minutes (a crashed worker) is
returned to `pending` at the start of the next tick.

## Backoff

`src/lib/webhook-retry.ts` holds the policy as pure functions.

| Attempt | Delay before next try |
|--------:|-----------------------|
| 1       | 1s                    |
| 2       | 2s                    |
| 3       | 4s                    |
| 4       | 8s                    |
| 5       | 16s                   |
| n       | `1s × 2^(n-1)`, capped at 1h |

Every delay carries ±20% jitter so a receiver coming back online is not hit by
the entire queue in the same instant. A `Retry-After` header on a `429` or
`503` overrides the computed delay, clamped to the same 1h ceiling so one
misbehaving receiver cannot park the queue indefinitely.

## Retryable vs permanent

| Response                      | Treatment |
|-------------------------------|-----------|
| `2xx`                         | success |
| `5xx`                         | retry |
| `408`, `429`                  | retry |
| other `4xx` (`400`, `404`, …) | dead letter immediately |
| `3xx` surfacing as non-ok     | dead letter immediately |
| network / TLS / timeout       | retry |

Retrying an identical request against a `404` or `400` cannot succeed, so those
skip the backoff ladder entirely and go straight to the dead letter queue.

## Dead letter queue

A delivery is dead lettered with a recorded `deadLetterReason`:

- `retries_exhausted` — `attempts` reached `maxRetries`.
- `non_retryable_response` — the receiver returned a permanent failure.

Dead lettered rows keep their payload, attempt count, last status code and last
error, and are never retried automatically.

## Concurrency

Deliveries are claimed before any HTTP request is made:

```sql
UPDATE "WebhookDelivery" SET status = 'delivering', "lockedBy" = $worker
WHERE id IN (...) AND status = 'pending'
```

The `status = 'pending'` predicate makes the claim exclusive — a racing worker
that selected the same rows updates zero of them and sends nothing. This lets
several API instances (and the `dispatch()` fast path) run the queue
concurrently without double-delivering. Up to 100 deliveries are claimed per
tick and sent 10 at a time.

## API

All dashboard routes require admin credentials (`X-Admin-Key` or
`Authorization: Bearer <ADMIN_API_KEY>`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/v1/webhooks/deliveries/stats` | Queue counters, dead letter breakdown, success rate |
| `GET`  | `/api/v1/webhooks/deliveries` | Paginated delivery log (`status`, `webhookId`, `eventType`, `limit`, `offset`) |
| `GET`  | `/api/v1/webhooks/deliveries/:deliveryId` | Single delivery including payload |
| `POST` | `/api/v1/webhooks/deliveries/:deliveryId/retry` | Requeue one delivery |
| `POST` | `/api/v1/webhooks/deliveries/retry` | Bulk requeue by `deliveryIds` or `webhookId` |

### Inspect the dead letter queue

```bash
curl -H "X-Admin-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/v1/webhooks/deliveries?status=dead_letter&limit=20"
```

### Retry a single delivery

```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  "http://localhost:3000/api/v1/webhooks/deliveries/del_abc123/retry"
```

### Drain one receiver's dead letter queue

```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhookId":"wh_abc123"}' \
  "http://localhost:3000/api/v1/webhooks/deliveries/retry"
```

A manual retry preserves the historical `attempts` count for audit and extends
`maxRetries` by a fresh allowance, so a requeued delivery is not dead lettered
again on its first failure. In-flight and already-succeeded deliveries are
rejected with `409`.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `WEBHOOK_WORKER_INTERVAL_MS` | `10000` | Queue poll interval |

Constants that are not environment-tunable live at the top of
`src/lib/webhook-retry.ts` (backoff curve, `DEFAULT_MAX_RETRIES`) and
`src/services/webhook-dispatcher.service.ts` (batch size, concurrency, request
timeout, stale-claim window).

## Tests

```bash
npm run test -- webhook-retry webhook-dispatcher
```

- `src/__tests__/webhook-retry.test.ts` — backoff curve, cap, jitter bounds,
  failure classification, `Retry-After` parsing, retry/dead-letter decisions.
- `src/__tests__/webhook-dispatcher.service.test.ts` — delivery outcomes,
  dead lettering, claim exclusivity, stale-claim reclaim, manual retry, and the
  dashboard queries.
