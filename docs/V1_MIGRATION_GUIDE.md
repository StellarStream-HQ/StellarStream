# StellarStream V1 Migration Guide

This guide covers the top V1 migration paths for consumers moving off
`/api/v1` before the 2026-10-01 sunset date.

## Quick checklist

1. Capture current V1 calls and response fields used by your integration.
2. Add logging for the `Deprecation` and `Sunset` response headers.
3. Move read-only traffic first, then writes and webhook registration.
4. Keep V1 fallback until V3 parity is verified in production.
5. Remove V1 keys, URLs, and client wrappers after the final cutover.

## Top 5 endpoint migrations

### 1. Stream history by address

| V1 | Replacement | Notes |
|----|-------------|-------|
| `GET /api/v1/streams/:address` | `GET /api/v3/history/:address` | V3 returns paginated results under `data.results`. |

Query mapping:

| V1 query | V3 query | Action |
|----------|----------|--------|
| `tokens=CODE:ISSUER` | `asset=CODE:ISSUER` | Rename the query parameter. |
| `direction=inbound|outbound` | none | Filter client-side by comparing `sender` and `receiver` to the address. |
| `status=active|paused|completed` | none | Filter client-side until a V3 status filter is added. |

If you need the old `{ v1, v2 }` split during rollout, use
`GET /api/v2/streams/:address` as a temporary bridge.

### 2. Stream export

| V1 | Replacement | Notes |
|----|-------------|-------|
| `GET /api/v1/streams/export/:address` | `GET /api/v3/history/:address` plus `GET /api/v3/export/:tx_hash?format=pdf|xlsx` | V3 exports transaction-level split audit reports, not address-wide CSVs. |

Migration steps:

1. Fetch the address history with `GET /api/v3/history/:address`.
2. For each transaction that needs an audit artifact, call
   `GET /api/v3/export/:tx_hash?format=pdf` or
   `GET /api/v3/export/:tx_hash?format=xlsx`.
3. If you require one address-wide CSV, keep the V1 export path until the V3
   export endpoint has address-level parity.

### 3. Stream fee estimation

| V1 | Replacement | Notes |
|----|-------------|-------|
| `POST /api/v1/streams/estimate-fee` | `POST /api/v3/validate-split` and `POST /api/v3/transactions/monitor` | V3 separates preflight validation from submitted transaction monitoring. |

Use `POST /api/v3/validate-split` before creating bulk disbursement or split
transactions. After a transaction is built, use `POST /api/v3/transactions/monitor`
to track fee-bump monitoring status.

If your integration needs a pre-submit XDR simulation response, use the
available V2 fee-estimate bridge in the gateway while a V3 fee endpoint is added.

### 4. Protocol stats

| V1 | Replacement | Notes |
|----|-------------|-------|
| `GET /api/v1/stats` | `GET /api/v3/analytics/leaderboard` or `GET /api/v2/stats/protocol` | Use V3 for leaderboard-style analytics and the V2 bridge for protocol totals. |

Field mapping for the V2 bridge:

| V1 field | Bridge field |
|----------|--------------|
| `globalTvl` | `totalVolume` |
| `activeStreams` | `activeStreamsCount` |
| `totalStreams` | no exact bridge field |

### 5. Webhook registration

| V1 | Replacement | Notes |
|----|-------------|-------|
| `POST /api/v1/webhooks/register` | `POST /api/v3/webhooks/register` | Direct V3 replacement. |

V1 request:

```json
{
  "url": "https://example.com/hooks",
  "eventType": "stream.created",
  "description": "Payment notifications"
}
```

V3 response shape nests the generated webhook values under `data`:

```json
{
  "success": true,
  "data": {
    "webhookId": "wh_abc123",
    "secretKey": "<redacted-webhook-secret>",
    "eventType": "stream.created"
  },
  "message": "Webhook registered successfully. Store the secretKey securely."
}
```

## Other V1 routes

| V1 route | Migration path |
|----------|----------------|
| `GET /api/v1/auth/nonce` | `GET /api/v3/auth/nonce` |
| `GET /api/v1/auth/me` | Keep V1 wallet-auth flow until the V3 authenticated identity endpoint is available. |
| `GET /api/v1/search` | Use `GET /api/v3/history/:address` when the address is known; otherwise keep V1 search until V3 search parity exists. |
| `GET /api/v1/streams/verify/:streamId` | Use V3 proof/audit artifacts where possible; keep V1 for direct stream verification until V3 parity exists. |
| `GET /api/v1/audit-log*` | Use V3 history, export, and proof-of-payment artifacts depending on the audit use case. |

## Cutover validation

Before disabling V1 in a client:

- Confirm every V1 call has a V3 or documented bridge replacement.
- Compare production responses for a representative address, transaction, and
  webhook registration.
- Verify downstream parsers handle V3 envelope changes such as `success` and
  `data`.
- Keep alerting on any remaining V1 `Deprecation` headers until they drop to
  zero.
