# Dispute Resolution Framework (issue #1471)

## Overview

StellarStream streams are pull-based: the sender keeps custody of un-streamed
tokens and each withdrawal pulls funds out at vesting time. That design gives
the receiver no unilateral claim on future balance — but it also leaves the
parties without a neutral path when they *disagree*. The dispute framework
(issue #1471) adds that path: either party can escalate a disagreement to a
set of arbitrators, who review and vote; the outcome is executed
automatically by the contract.

> Note: this replaces the earlier single-arbiter design sketched for issue
> #35 (`set_arbiter` / `freeze_stream` / `resolve_dispute`), which was never
> merged into the current contract.

## Roles

| Role | Constant | Powers |
|---|---|---|
| Sender / Receiver | — | Raise at most one dispute per stream |
| Arbitrator | `ROLE_ARBITRATOR = 3` | Vote once per dispute |
| Admin | `ROLE_ADMIN = 0` | Add/remove arbitrators, set the approval threshold |

**Arbitration authority is separate from administration**: an admin must
explicitly grant `ROLE_ARBITRATOR`, and holding `ROLE_ADMIN` confers no
voting power.



## Lifecycle

```text
sender or receiver          arbitrators                    anyone
      │                          │                           │
      │ raise_dispute            │ vote_on_dispute           │ close_expired_dispute
      ▼                          ▼                           ▼
 ┌─────────┐  approvals ≥ threshold ┌───────────┐    deadline passed,
 │  Open   │────────(execute)──────▶│ Resolved  │    no threshold met
 │ (locked)│  rejections ≥ threshold│           │          │
 └─────────┘────────(reject)───────▶└───────────┘◀────close──┘
```

1. **Raise** — `raise_dispute(stream_id, caller, reason, proposed_resolution)`.
   Only the stream's sender or receiver may call it; only one dispute may be
   open per stream; closed streams cannot be disputed; monetary amounts are
   validated against the remaining balance.
2. **Vote** — `vote_on_dispute(dispute_id, arbitrator, approve)`. One vote per
   arbitrator. While a dispute is open **every stream operation is blocked**
   (`withdraw`, `batch_withdraw`, `cancel_stream`, `pause_stream`,
   `resume_stream` and all clawback entry points return `StreamDisputed`),
   so the balance a resolution acts upon is immutable during the window.
3. **Auto-execute** — when approvals reach the threshold
   (`set_arbitration_threshold`, default `DEFAULT_ARBITRATION_THRESHOLD = 1`)
   the proposed resolution runs immediately and atomically. When rejections
   reach the threshold first, the dispute finalizes without executing.

## Resolutions

```rust
pub enum DisputeResolution {
    RefundSender(i128), // amount ∈ (0, remaining]: close, remainder stays with sender
    PayReceiver(i128),  // amount ∈ (0, remaining]: pay receiver now, then close
    FreezeStream,       // permanent lock; every operation returns StreamFrozen
    CancelStream,       // identical to a sender cancellation
}
```

Amounts are always against the *remaining* balance
(`total_amount - withdrawn_amount`). StellarStream holds no escrowed tokens,
so `RefundSender` closes the stream and lets the un-withdrawn remainder stay
with the sender; `PayReceiver` actively transfers from sender to receiver and
records the payout as withdrawn before closing.

## API

| Function | Auth | Notes |
|---|---|---|
| `add_arbitrator(admin, arbitrator)` | Admin | Grants `ROLE_ARBITRATOR` |
| `remove_arbitrator(admin, arbitrator)` | Admin | Immediate; past votes stay counted |
| `get_arbitrators()` / `is_arbitrator(who)` | — | Roster introspection |
| `set_arbitration_threshold(admin, n)` | Admin | `n ∈ [1, MAX_ARBITRATION_THRESHOLD]` |
| `get_arbitration_threshold()` | — | Default `DEFAULT_ARBITRATION_THRESHOLD` |
| `raise_dispute(stream_id, caller, reason, resolution)` | Sender/Receiver | Returns dispute id; locks the stream |
| `vote_on_dispute(dispute_id, arbitrator, approve)` | Arbitrator | May auto-execute |
| `close_expired_dispute(dispute_id)` | Anyone | Only after deadline |
| `get_dispute(id)` / `get_active_dispute_id(stream_id)` / `has_active_dispute(stream_id)` | — | Queries |

## Events

Topics use the `("dispute", action)` pair:

- `dispute/raised` → `DisputeRaisedEvent { dispute_id, stream_id, raised_by, timestamp }`
- `dispute/voted` → `DisputeVotedEvent { dispute_id, stream_id, arbitrator, approve, approvals, rejections, threshold, timestamp }`
- `dispute/resolved` → `DisputeResolvedEvent { dispute_id, stream_id, executed, approved, expired, timestamp }`

## Errors

Dedicated dispute codes: `DisputeNotFound (50)`, `DisputeAlreadyOpen (51)`
— also returned by any stream operation attempted on a disputed stream —,
`DisputeNotOpen (52)` (finalized, or window not yet lapsed for closure),
`NotArbitrator (53)`, `AlreadyVoted (54)`, `DisputeExpired (55)` and
`StreamFrozen (56)`. Monetary resolution amounts and thresholds reuse the
generic `InvalidAmount` and `InvalidApprovalThreshold` codes: the contract
spec XDR format caps `#[contracterror]` enums at 50 variants.

## Security notes

1. **No self-dealing** — resolutions only ever move funds between the two
   stream parties; an arbitrator address can never be a transfer destination.
2. **Immutable balance under arbitration** — every mutating stream entry
   point checks `ActiveDispute(stream_id)` first, so votes act on a frozen
   balance and validation at raise time stays valid at execution time.
3. **Atomic execution** — the finalized dispute is persisted before the
   token transfer (checks-effects-interactions); a failed transfer reverts
   the whole vote rather than leaving it half-applied.
4. **Freeze is terminal** — `FreezeStream` deliberately has no in-contract
   thaw path so a compromised arbitrator cannot release a locked stream;
   recovery requires governance via contract upgrade.
5. **Bounded lock-up** — the voting window guarantees the dispute lock
   cannot outlive `DISPUTE_VOTING_PERIOD_SECS`.

## Tests

`src/dispute_test.rs` covers: raising by both parties, outsider rejection,
single-open-dispute rule, invalid amounts/reasons, arbitrator-only voting
(incl. admin separation), double votes, votes after finalization/deadline,
threshold auto-execution of all four resolution types, multi-member
thresholds, insufficient votes keeping the lock, rejection majorities,
expired closure, blocked withdraw/batch/pause/cancel/clawback, arbitrator
assignment lifecycle, threshold configuration, events, and balance updates.

4. **Expiry** — after `DISPUTE_VOTING_PERIOD_SECS` (7 days) votes fail with
   `DisputeExpired` and anyone may call `close_expired_dispute(dispute_id)`
   to finalize without executing and lift the lock.
