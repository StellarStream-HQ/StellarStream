# Contract Upgradability

## Overview

StellarStream uses Soroban's native `update_current_contract_wasm` mechanism to upgrade contract logic while preserving the same contract ID and all on-chain storage state. Only a `SuperAdmin` can invoke an upgrade, and every upgrade is recorded on-chain as an immutable event.

---

## How It Works

### The Upgrade Function

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

| Parameter       | Description                                                          |
| --------------- | -------------------------------------------------------------------- |
| `admin`         | Caller — must hold the `SuperAdmin` role                             |
| `new_wasm_hash` | 32-byte hash of the new WASM, returned by `soroban contract install` |

**What happens internally:**

1. `admin.require_auth()` — Stellar enforces the admin's signature
2. `has_role(&env, &admin, Role::SuperAdmin)` — contract enforces role check
3. `env.deployer().update_current_contract_wasm(new_wasm_hash)` — atomic WASM swap
4. `env.events().publish(("upgrade", admin), new_wasm_hash)` — on-chain audit trail

**What is preserved:** contract ID, all storage keys, all streams, all fee settings, all roles.  
**What changes:** the bytecode executed by future contract calls.

---

## Upgrade Checklist

Complete every item before calling `upgrade()` on mainnet.

### Pre-Upgrade (Preparation)

- [ ] New contract version passes all existing unit tests (`cargo test`)
- [ ] New contract version passes all existing integration tests
- [ ] Storage layout is backward-compatible (no renamed or removed `DataKey` variants)
- [ ] If storage schema changed, a `migrate_*` function is included and tested
- [ ] Public function signatures are unchanged (or new functions are additive only)
- [ ] WASM has been optimized (`soroban contract optimize`)
- [ ] New WASM has been deployed and tested on **testnet** with a live upgrade
- [ ] WASM hash from testnet install matches the hash you will use on mainnet
- [ ] Admin key (or multi-sig) is available and ready to sign
- [ ] Previous WASM hash is recorded for rollback
- [ ] Upgrade announcement has been communicated to users
- [ ] Monitoring / alerting is in place on the upgrade event

### Upgrade Execution

- [ ] Confirm current on-chain state is healthy (no stuck streams, no pending migrations)
- [ ] Record the current WASM hash before upgrading (see rollback section)
- [ ] Execute upgrade on mainnet (see procedure below)
- [ ] Confirm the `upgrade` event appears in the ledger

### Post-Upgrade Verification

- [ ] `get_admin()` returns the expected admin address
- [ ] A representative stream can be queried and shows correct data
- [ ] A representative stream can be withdrawn from (if applicable to your test)
- [ ] Fee settings are intact (`get_fee_bps`, `get_treasury`)
- [ ] No errors in contract invocations over the first 30 minutes
- [ ] Upgrade event is visible in a block explorer

---

## Example Upgrade Procedure

The following end-to-end example upgrades Contract-V1 on Stellar testnet.

### Step 1 — Build and Optimize

```bash
# From the repo root
cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --manifest-path contracts/Contract-V1/Cargo.toml

soroban contract optimize \
  --wasm target/wasm32-unknown-unknown/release/stellar_stream.wasm \
  --wasm-out target/wasm32-unknown-unknown/release/stellar_stream.optimized.wasm
```

### Step 2 — Record the Current WASM Hash (for Rollback)

```bash
# Save the current WASM hash before you overwrite it
CURRENT_HASH=$(soroban contract info \
  --id $CONTRACT_ID \
  --network testnet \
  | jq -r '.wasm_hash')

echo "Current WASM hash (keep for rollback): $CURRENT_HASH"
```

### Step 3 — Install the New WASM

```bash
NEW_HASH=$(soroban contract install \
  --wasm target/wasm32-unknown-unknown/release/stellar_stream.optimized.wasm \
  --source $ADMIN_SECRET \
  --network testnet)

echo "New WASM hash: $NEW_HASH"
```

### Step 4 — Call upgrade()

```bash
soroban contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_SECRET \
  --network testnet \
  -- \
  upgrade \
  --admin $ADMIN_ADDRESS \
  --new_wasm_hash $NEW_HASH
```

### Step 5 — Verify the Upgrade

```bash
# Check admin is still set correctly
soroban contract invoke \
  --id $CONTRACT_ID \
  --network testnet \
  -- \
  get_admin

# Confirm the upgrade event in recent ledger events
soroban events \
  --id $CONTRACT_ID \
  --network testnet \
  --start-ledger $(soroban network get-sequence --network testnet)
```

Expected event structure:

```json
{
  "type": "contract",
  "topics": ["upgrade", "<admin_address>"],
  "value": "<new_wasm_hash>"
}
```

---

## Rollback Procedure

A rollback is a second upgrade — you call `upgrade()` again with the **previous** WASM hash. This is why recording `CURRENT_HASH` before every upgrade (Step 2 above) is mandatory.

### rollback.sh

```bash
#!/usr/bin/env bash
# rollback.sh — Re-deploy a previous WASM hash for StellarStream Contract-V1.
#
# Usage:
#   export CONTRACT_ID=<contract_address>
#   export ADMIN_SECRET=<admin_secret_key>
#   export ADMIN_ADDRESS=<admin_stellar_address>
#   export ROLLBACK_HASH=<previous_wasm_hash>
#   export NETWORK=testnet   # or mainnet
#   bash rollback.sh

set -euo pipefail

: "${CONTRACT_ID:?CONTRACT_ID is required}"
: "${ADMIN_SECRET:?ADMIN_SECRET is required}"
: "${ADMIN_ADDRESS:?ADMIN_ADDRESS is required}"
: "${ROLLBACK_HASH:?ROLLBACK_HASH is required}"
: "${NETWORK:=testnet}"

echo "=== StellarStream Contract Rollback ==="
echo "Contract ID : $CONTRACT_ID"
echo "Network     : $NETWORK"
echo "Target hash : $ROLLBACK_HASH"
echo ""
echo "WARNING: This will revert contract logic to the previous WASM."
echo "Storage state (streams, fees, roles) will NOT be affected."
echo ""
read -r -p "Confirm rollback? [yes/no]: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Rollback cancelled."
  exit 0
fi

echo ""
echo "Step 1/3 — Recording current WASM hash..."
CURRENT_HASH=$(soroban contract info \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  | jq -r '.wasm_hash')
echo "  Current hash: $CURRENT_HASH"
echo "  Target hash : $ROLLBACK_HASH"

echo ""
echo "Step 2/3 — Invoking upgrade() with rollback hash..."
soroban contract invoke \
  --id "$CONTRACT_ID" \
  --source "$ADMIN_SECRET" \
  --network "$NETWORK" \
  -- \
  upgrade \
  --admin "$ADMIN_ADDRESS" \
  --new_wasm_hash "$ROLLBACK_HASH"

echo ""
echo "Step 3/3 — Verifying rollback..."
ADMIN_AFTER=$(soroban contract invoke \
  --id "$CONTRACT_ID" \
  --network "$NETWORK" \
  -- \
  get_admin)
echo "  Admin after rollback: $ADMIN_AFTER"

echo ""
echo "=== Rollback complete ==="
echo "Contract is now running WASM hash: $ROLLBACK_HASH"
echo "Previous hash was               : $CURRENT_HASH"
echo ""
echo "Next steps:"
echo "  1. Verify streams are still readable."
echo "  2. Notify users of the rollback."
echo "  3. Investigate the root cause before re-upgrading."
```

### When to Roll Back

Roll back immediately if any of the following appear within 30 minutes of an upgrade:

- Invocations panic unexpectedly on previously working call paths
- Storage reads return wrong types (indicative of a schema mismatch)
- `get_admin()` fails or returns the wrong address
- Withdraw or stream-creation calls fail for all users

---

## Storage Compatibility Rules

Soroban persists storage by key — renaming or removing a `DataKey` variant causes existing entries to become orphaned (they won't be read by the new code). Follow these rules across every upgrade:

| Change                                     | Safe?  | Notes                       |
| ------------------------------------------ | ------ | --------------------------- |
| Add a new `DataKey` variant                | ✅ Yes | Existing entries unaffected |
| Add a new field to a struct (with default) | ✅ Yes | Requires migration function |
| Remove a `DataKey` variant                 | ❌ No  | Orphaned storage; data loss |
| Rename a `DataKey` variant                 | ❌ No  | Same as removing            |
| Change a field type in a struct            | ❌ No  | Deserialization will fail   |
| Add a new public function                  | ✅ Yes | Fully additive              |
| Remove or rename a public function         | ❌ No  | Breaks existing callers     |

### Writing a Migration Function

If the new WASM introduces an additive storage schema change, include a one-time migration function:

```rust
/// Call once after upgrading to vX.Y.Z.
/// Reads all Stream entries and writes the new `field_name` default.
pub fn migrate_vX_Y_Z(env: Env, admin: Address) {
    admin.require_auth();
    // Only SuperAdmin may run migrations
    if !Self::has_role(&env, &admin, Role::SuperAdmin) {
        panic_with_error!(&env, Error::Unauthorized);
    }
    // Example: set a new optional field to None for every existing stream
    // This is a no-op if the field already exists (safe to call multiple times)
    // ... migration logic here ...
}
```

Call `migrate_vX_Y_Z()` in a single transaction **immediately after** `upgrade()` completes.

---

## Security Considerations

### Admin Key Security

- The upgrade function is gated on the `SuperAdmin` role; losing the admin key means no future upgrades are possible
- For production, configure a multi-signature admin account to require M-of-N approvals before an upgrade can proceed
- Consider a time-lock governance contract that enforces a mandatory delay between an upgrade proposal and its execution, giving users time to review and exit

### Transparency

- Every upgrade emits an `("upgrade", admin_address)` event with the new WASM hash
- These events are permanently on-chain and can be monitored by anyone
- Block explorers will show the full upgrade history

### Authorization Flow

```
caller --[require_auth()]--> Stellar runtime validates signature
                         --> has_role(SuperAdmin) check in contract
                         --> update_current_contract_wasm(hash)
                         --> events().publish("upgrade", ...)
```

Both layers (runtime auth + role check) must pass. There is no admin bypass.

---

## Testing

### Unit Tests (in `upgrade_test.rs`)

| Test                                         | Covers                                           |
| -------------------------------------------- | ------------------------------------------------ |
| `test_get_admin`                             | Admin retrieval works after init                 |
| `test_get_admin_not_initialized`             | Panics correctly before init                     |
| `test_upgrade_without_initialization`        | Non-admin blocked                                |
| `test_admin_can_be_retrieved_after_fee_init` | Admin survives fee init                          |
| `test_admin_persists_through_pause`          | Admin survives pause/unpause                     |
| `test_upgrade_by_admin`                      | _(integration only — requires real WASM upload)_ |
| `test_upgrade_maintains_state`               | _(integration only — requires real WASM upload)_ |

Unit tests verify authorization logic and event emission. Full WASM swap testing requires a live Stellar node; use the testnet procedure above.

### V1→V2 Migration Tests (in `v1_to_v2_integration_test.rs`)

The Contract-V2 suite includes a mock V1 contract and end-to-end tests verifying that V1 streams can be read and migrated to V2 without data loss. Run with:

```bash
cargo test --manifest-path contracts/Contract-V2/Cargo.toml
```

---

## API Reference

### `upgrade(env, admin, new_wasm_hash)`

```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

Replaces the contract WASM atomically. All storage is preserved.

**Requires:** `admin.require_auth()` + `SuperAdmin` role  
**Emits:** `("upgrade", admin) → new_wasm_hash`

### `get_admin(env)`

```rust
pub fn get_admin(env: Env) -> Address
```

Returns the current admin address from instance storage.

**Requires:** nothing (public read)

---

## Quick Reference

```bash
# Build
cargo build --target wasm32-unknown-unknown --release

# Optimize
soroban contract optimize --wasm <path>.wasm

# Install (returns hash)
soroban contract install --wasm <path>.optimized.wasm --source $ADMIN_SECRET --network testnet

# Upgrade
soroban contract invoke --id $CONTRACT_ID --source $ADMIN_SECRET --network testnet \
  -- upgrade --admin $ADMIN_ADDRESS --new_wasm_hash $NEW_HASH

# Rollback
export ROLLBACK_HASH=<previous_hash> && bash rollback.sh
```
