# StellarStream API Documentation

Central reference for all StellarStream REST API endpoints, webhook events, contract events, and error codes.

---

## Overview

StellarStream provides a REST API for querying Stellar payment streams, processing bulk disbursements, managing webhooks, and interacting with Soroban smart contracts.

| Version | Base URL | Swagger UI |
|---------|----------|------------|
| V1 | `http://localhost:3000/api/v1` | http://localhost:3000/api/v1/docs |
| V3 | `http://localhost:3000/api/v3` | http://localhost:3000/api/v3/docs |
| V2 (legacy) | `http://localhost:3000/api/v2` | — |

**Postman Collection:** `backend/docs/postman/StellarStream-Complete.postman_collection.json`

---

## Authentication

### API Key

Include your API key in the `X-Api-Key` header, or as `Authorization: Bearer <key>`.

```
X-Api-Key: your-api-key-here
```

### Wallet Auth (challenge-response)

Used for endpoints that require proof of wallet ownership:

1. Call `GET /api/v1/auth/nonce` to get a one-time nonce.
2. Sign the nonce with your Stellar private key.
3. Include three headers on the protected request:

```
X-Stellar-Address: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
X-Auth-Nonce: <nonce from step 1>
X-Auth-Signature: <base64-encoded signature>
```

---

## Rate Limiting

| Tier | Limit | Applies To |
|------|-------|------------|
| Standard | 100 req/min | Most endpoints |
| Sensitive | 5 req/min | `/auth/nonce`, `/auth/challenge`, `/webhooks/register` |

When rate limited, the API returns `429 Too Many Requests` with a `Retry-After` header.

---

## V1 Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/stats` | Global protocol statistics | None |
| GET | `/api/v1/search` | Search streams by address or query | None |
| GET | `/api/v1/streams/:address` | Get streams for a Stellar address | API Key |
| GET | `/api/v1/streams/export/:address` | Export stream history as CSV | API Key |
| POST | `/api/v1/streams/estimate-fee` | Estimate Soroban fee for stream creation | API Key |
| GET | `/api/v1/streams/verify/:streamId` | Verify a stream on-chain | API Key |
| GET | `/api/v1/auth/nonce` | Get one-time auth nonce | None |
| GET | `/api/v1/auth/me` | Get authenticated wallet address | Wallet Auth |
| GET | `/api/v1/audit-log` | Recent protocol audit events | API Key |
| GET | `/api/v1/audit-log/chain/verify` | Verify audit log hash chain | API Key |
| GET | `/api/v1/audit-log/:streamId` | Audit events for a specific stream | API Key |
| GET | `/api/v1/transaction/:txHash` | Raw transaction data and events | API Key |
| POST | `/api/v1/webhooks/register` | Register a webhook endpoint | API Key |
| POST | `/api/v1/webhooks/test` | Test webhook delivery | API Key |

### Query Parameters — `/api/v1/streams/:address`

| Param | Type | Values | Description |
|-------|------|--------|-------------|
| `direction` | string | `inbound`, `outbound` | Filter by stream direction |
| `status` | string | `active`, `paused`, `completed` | Filter by stream status |
| `tokens` | string | comma-separated addresses | Filter by token address |

### Query Parameters — `/api/v1/search`

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search in stream ID, sender, receiver |
| `sender` | string | Filter by exact sender address |
| `receiver` | string | Filter by exact receiver address |
| `limit` | integer | Max results (default 20, max 50) |
| `offset` | integer | Pagination offset |

---

## V3 Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v3/process-disbursement-file` | Validate bulk CSV/JSON recipient file | API Key |
| POST | `/api/v3/split/analyze` | Analyze split for duplicates/issues | API Key |
| POST | `/api/v3/validate-split` | Pre-validate split before execution | API Key |
| POST | `/api/v3/resolve-vault-routes` | Resolve transfer vs invoke_contract routes | API Key |
| GET | `/api/v3/org-gas-status` | Organization gas tank balance | API Key |
| GET | `/api/v3/analytics/leaderboard` | Global disbursement leaderboard | None |
| POST | `/api/v3/webhooks/register` | Register a webhook | API Key |
| GET | `/api/v3/template` | List saved split templates | API Key |
| POST | `/api/v3/template` | Create a split template | API Key |
| GET | `/api/v3/history/:address` | Transaction history for address | API Key |
| GET | `/api/v3/proof-of-payment/:txHash` | Cryptographic proof of payment | API Key |
| GET | `/api/v3/assets/price/:asset` | Current price for a Stellar asset | API Key |
| POST | `/api/v3/multisig/propose` | Create a multisig proposal | API Key |
| POST | `/api/v3/multisig/approve` | Approve a multisig proposal | API Key |
| POST | `/api/v3/fee-bump` | Create a fee bump transaction | API Key |
| GET | `/api/v3/export/:address` | Export data for address | API Key |
| GET | `/api/v3/verify-list` | Get verification allowlist | API Key |
| POST | `/api/v3/draft-versions` | Save a draft split version | API Key |
| GET | `/api/v3/invoice-report/:streamId` | Invoice report for a stream | API Key |
| POST | `/api/v3/notification-channels` | Register notification channel | API Key |

---

## Webhook Events

### Registering a Webhook

```bash
curl -X POST http://localhost:3000/api/v1/webhooks/register \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{
    "url": "https://example.com/hooks",
    "eventType": "split.completed",
    "description": "My settlement callback"
  }'
```

Response includes a `secretKey` — store it securely, it is shown only once.

Use `"eventType": "*"` to subscribe to all events.

### Verifying Incoming Webhooks

Every delivery includes an `X-Webhook-Signature` header:

```
X-Webhook-Signature: sha256=<hmac-sha256(secretKey, rawBody)>
```

Verify in Node.js:

```js
const crypto = require('crypto');

function verifyWebhook(secretKey, rawBody, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secretKey)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

### Event Types

| Event | Triggered When | Key Payload Fields |
|-------|---------------|--------------------|
| `split.completed` | Split batch confirmed on-chain | `txHash`, `sender`, `totalAmount`, `recipientCount`, `ledger` |
| `split.failed` | Split execution fails | `splitId`, `sender`, `reason`, `retriable` |
| `stream.created` | New payment stream created | `streamId`, `sender`, `receiver`, `totalAmount`, `asset`, `startTime`, `endTime` |
| `stream.withdrawn` | Recipient claims from stream | `streamId`, `receiver`, `withdrawnAmount`, `remainingAmount` |
| `stream.cancelled` | Sender cancels a stream | `streamId`, `sender`, `refundedAmount` |
| `autopilot.run` | Autopilot schedule fires | `scheduleId`, `status`, `recipientCount`, `gasTankBalanceAfter` |

### Example Payload — `split.completed`

```json
{
  "eventType": "split.completed",
  "data": {
    "splitId": "split-9f3a2b1c",
    "txHash": "3b7f2a1c9d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a",
    "sender": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "totalAmount": "500000000",
    "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "recipientCount": 47,
    "ledger": 48923110,
    "timestamp": "2026-06-24T13:59:47.312Z"
  }
}
```

### Example Payload — `stream.created`

```json
{
  "eventType": "stream.created",
  "data": {
    "streamId": "stream-4d7e1f2a",
    "sender": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "receiver": "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP",
    "totalAmount": "100000000",
    "asset": "XLM",
    "startTime": "2026-06-24T14:00:00.000Z",
    "endTime": "2026-07-24T14:00:00.000Z",
    "txHash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
  }
}
```

---

## Contract Events

The Soroban contracts emit the following on-chain events, indexed by the event watcher.

| Event | Topics | Data | When |
|-------|--------|------|------|
| `create` | `("create", sender)` | `stream_id: u64` | New stream created |
| `create_v2` | `("create_v2", sender)` | `StreamCreatedV2Event` | New V2 stream |
| `batch_create` | `("batch_create", sender)` | `BatchStreamsCreatedEvent` | Batch of streams |
| `withdraw` | `("withdraw", receiver)` | `(stream_id, amount)` | Funds withdrawn |
| `cancel` | `("cancel", stream_id)` | `sender: Address` | Stream cancelled |
| `migrate` | `("migrate")` | `(v1_id, v2_id, sender, balance)` | V1→V2 migration |

Filter events using Soroban RPC `getEvents` with `contractId` and `topics`. All events include `stream_id` for efficient filtering.

---

## Error Codes

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 400 | Bad Request — invalid parameters or missing required fields |
| 401 | Unauthorized — missing or invalid API key / wallet auth |
| 403 | Forbidden — insufficient permissions |
| 404 | Not Found |
| 409 | Conflict — idempotency key already used |
| 422 | Unprocessable Entity — validation failed |
| 429 | Too Many Requests — rate limit exceeded |
| 500 | Internal Server Error |
| 503 | Service Unavailable — upstream (Horizon/RPC) unreachable |

### Contract Error Codes

| Code | Variant | Message | When |
|------|---------|---------|------|
| 1 | `AlreadyInitialized` | Contract is already initialized | Calling `initialize()` more than once |
| 2 | `InvalidTimeRange` | Invalid time range provided | `start_time >= end_time` |
| 3 | `InvalidAmount` | Invalid amount specified | Amount is zero or negative |
| 4 | `StreamNotFound` | Stream not found | Stream ID does not exist |
| 5 | `Unauthorized` | Unauthorized | Caller lacks required role |
| 6 | `AlreadyCancelled` | Stream has already been cancelled | Operating on a cancelled stream |
| 7 | `InsufficientBalance` | Insufficient balance | Not enough tokens to fund stream |
| 8 | `ProposalNotFound` | Proposal not found | Proposal ID does not exist |
| 9 | `ProposalExpired` | Proposal has expired | Past proposal deadline |
| 10 | `AlreadyApproved` | Already approved | Signer already approved this proposal |
| 11 | `ProposalAlreadyExecuted` | Proposal already executed | Cannot re-execute |
| 12 | `InvalidApprovalThreshold` | Invalid approval threshold | Threshold is 0 or exceeds approver count |
| 13 | `NotReceiptOwner` | Not the receipt owner | Caller does not own the stream receipt NFT |
| 14 | `StreamPaused` | Stream is paused | Withdraw attempted on paused stream |
| 15 | `OracleStalePrice` | Oracle price is stale | Price data older than `max_staleness` |
| 16 | `OracleFailed` | Oracle call failed | Could not fetch price |
| 17 | `PriceOutOfBounds` | Price out of acceptable bounds | Outside `min_price`/`max_price` range |
| 18 | `FlashLoanNotRepaid` | Flash loan not repaid | Loan not returned in same transaction |
| 19 | `FlashLoanInProgress` | Flash loan in progress | Nested flash loan detected |
| 20 | `AlreadyExecuted` | Request already executed | Re-execution attempt |

---

## Example Requests (curl)

**Get streams for an address:**
```bash
curl "http://localhost:3000/api/v1/streams/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN?direction=outbound&status=active" \
  -H "X-Api-Key: your-api-key"
```

**Estimate stream creation fee:**
```bash
curl -X POST http://localhost:3000/api/v1/streams/estimate-fee \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{
    "sender": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "receiver": "GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP",
    "token": "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    "totalAmount": "100000000",
    "startTime": 1750000000,
    "endTime": 1752592000,
    "curveType": "linear",
    "isSoulbound": false
  }'
```

**Search streams:**
```bash
curl "http://localhost:3000/api/v1/search?sender=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN&limit=10"
```

**Process disbursement CSV:**
```bash
curl -X POST "http://localhost:3000/api/v3/process-disbursement-file?format=csv" \
  -H "Content-Type: text/csv" \
  -H "X-Api-Key: your-api-key" \
  -H "X-Idempotency-Key: payroll-2026-06-24" \
  --data-binary "address,amount
GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,100.50
GD6FMKDCUA5BQYBPNBPZRWQZFHXQNIRQZ7PFSGKF7KVHRJUALDVF2HP,200.00"
```

**Register a webhook:**
```bash
curl -X POST http://localhost:3000/api/v1/webhooks/register \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{"url": "https://example.com/hooks", "eventType": "split.completed"}'
```

**Validate a split:**
```bash
curl -X POST http://localhost:3000/api/v3/validate-split \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{
    "recipients": [
      { "address": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", "amountStroops": "10000000" }
    ],
    "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
  }'
```

---

## SDK

A TypeScript SDK is available in `sdk/`. See [`sdk/README.md`](../sdk/README.md) for installation and usage instructions.
