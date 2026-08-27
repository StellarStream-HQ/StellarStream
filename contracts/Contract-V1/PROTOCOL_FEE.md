# Protocol Fee System

Issue: [#1457](https://github.com/StellarStream-HQ/StellarStream/issues/1457)

Creating a stream charges a configurable protocol fee that is paid to a
treasury address.

## Fee is charged on top

The fee is **added to** the stream, never taken out of it. A stream of 1,000
tokens at a 1% fee costs the sender 1,010 tokens: 1,000 stay streamable to the
receiver, 10 go to the treasury.

```
sender pays   = total_amount + fee
fee           = total_amount * fee_bps / 10_000   (rounded down)
stream value  = total_amount                      (unchanged)
```

A receiver is therefore always owed exactly the amount the stream reports, with
no deduction to reason about.

## Configuration

| Function | Purpose |
| --- | --- |
| `set_protocol_fee(treasury_manager, fee_bps)` | Set the rate, in basis points |
| `set_treasury_address(treasury_manager, new_treasury)` | Set the fee recipient |
| `get_protocol_fee() -> u32` | Current rate |
| `get_treasury_address() -> Option<Address>` | Current treasury |
| `calculate_protocol_fee(amount) -> i128` | Fee that `create_stream` would charge |

Both setters require the caller to hold `ROLE_TREASURY` or `ROLE_ADMIN`.
Anyone else is rejected with `Unauthorized`.

Use `calculate_protocol_fee` to work out the total a sender needs
(`amount + fee`) before committing to a stream.

## Rules

- **Capped at 10%.** `MAX_FEE_BPS` is 1,000 bps. The cap is enforced on write,
  so an out-of-range rate can never reach `create_stream`. Above it,
  `set_protocol_fee` returns `FeeTooHigh`.
- **Zero is valid and free.** At 0 bps no token transfer is attempted and no
  treasury needs to be configured.
- **No treasury is an error, not a discount.** With a non-zero rate and no
  treasury set, `create_stream` fails with `TreasuryNotSet` rather than quietly
  skipping collection.
- **All or nothing.** The fee transfer and the stream creation share one
  invocation. A sender who cannot cover the fee creates no stream, consumes no
  stream id, and moves no tokens.
- **Overflow is reported, not wrapped.** The fee multiplication is checked, so a
  very large amount returns `Overflow`.
- **Rate changes are not retroactive.** A new rate applies from the next stream
  onward.

## Errors

| Error | Raised when |
| --- | --- |
| `FeeTooHigh` (38) | `fee_bps` exceeds `MAX_FEE_BPS` |
| `TreasuryNotSet` (39) | A non-zero fee is due but no treasury is configured |
| `Unauthorized` (5) | Caller holds neither `ROLE_TREASURY` nor `ROLE_ADMIN` |
| `Overflow` (27) | `amount * fee_bps` would exceed `i128` |

## Events

Collection publishes `ProtocolFeeCollectedEvent`, carrying the stream id, payer,
treasury, token, fee amount, and the rate applied — enough for an off-chain
indexer to reconcile treasury income without replaying stream state.

## Multi-signature proposals

Streams created by executing a multi-signature proposal are not charged. The fee
debits the sender, and proposal execution runs under the approvers'
authorization rather than the sender's, so there is no sender authorization to
draw against at that point.

## Tests

`src/fee_test.rs` covers the system against a real Stellar Asset Contract, so
balance assertions reflect tokens that actually moved:

| Test | Proves |
| --- | --- |
| `test_set_protocol_fee` | Manager and admin can both set the rate |
| `test_set_treasury_address` | Treasury can be set and re-pointed |
| `test_fee_cap_enforced` | 1001 bps rejected, 1000 accepted, rejects don't stick |
| `test_non_manager_cannot_change_fee_settings` | Outsiders are rejected |
| `test_fee_is_collected_on_top_of_stream_amount` | 1,000 @ 1% → treasury 10, stream still 1,000 |
| `test_zero_fee_collects_nothing` | No transfer, no treasury needed |
| `test_insufficient_balance_for_fee_reverts_creation` | No stream, no id, no tokens moved |
| `test_multiple_streams_accumulate_fees` | Fees accumulate; rate changes apply forward |
| `test_fee_without_treasury_is_rejected` | `TreasuryNotSet`, not a silent skip |
| `test_fee_math_is_overflow_safe` | Rounding down, and `Overflow` at `i128::MAX` |
| `test_fee_collection_emits_event` | Collection is observable off-chain |
| `test_revoked_manager_loses_fee_control` | Role revocation removes access |

```
cargo test --lib fee_test
```
