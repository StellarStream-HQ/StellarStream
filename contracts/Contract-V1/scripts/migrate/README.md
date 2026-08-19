# StellarStream Migration Scripts

A suite of auditable shell scripts that implement the procedures described in
[`docs/MIGRATION_GUIDE.md`](../docs/MIGRATION_GUIDE.md). **Always test these on
testnet before running them against production.**

## Requirements

- `stellar` CLI (or `soroban` as a fallback) authenticated for the target network
- `jq` (used by some scripts)
- An admin account secret key (`ADMIN_SECRET`) for admin-gated operations
- Receiver secret keys for stream migrations (per-receiver authorization)

## Environment

Scripts accept flags (see each script's `--help`) and read the following
environment variables:

| Variable | Purpose | Required for |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` or `mainnet` (default `testnet`) | all |
| `ADMIN_SECRET` | Admin account secret key | preflight, snapshot, build/install, rollback |
| `RECEIVER_SECRET` | Receiver secret for `migrate_stream` calls | gradual/atomic migration |
| `RECEIVER_ADDRESS` | Receiver public address | gradual migration |

## Scripts

| # | Script | Purpose |
|---|---|---|
| 01 | `01_preflight.sh` | Verify CLI, network, env, and that both contracts are queryable |
| 02 | `02_snapshot.sh` | Dump all V1 streams to JSON (reconciliation / rollback reference) |
| 03 | `03_build_install.sh` | Build Contract-V2 WASM, install it, print the new WASM hash |
| 04 | `04_migrate_atomic.sh` | Migrate all (or a given list of) streams to V2 in batches |
| 05 | `05_migrate_gradual.sh` | Migrate a specific receiver's streams (lazy / on-demand path) |
| 06 | `06_verify.sh` | Post-migration verification: versions, queryability, sample streams |
| 07 | `07_rollback.sh` | WASM-level rollback to a previous hash (pre-data-migration only) |
| — | `common.sh` | Shared helpers — sourced by the scripts, do not run directly |

## Typical flow (atomic)

```bash
export STELLAR_NETWORK=testnet
export ADMIN_SECRET=S...

# 1. Preflight
./01_preflight.sh --v1-contract C... --v2-contract C...

# 2. Snapshot
./02_snapshot.sh --v1-contract C... --out snapshots/pre.json

# 3. Build + install new WASM (prints NEW_WASM_HASH)
./03_build_install.sh

# 4. Upgrade the contract with the new hash (see guide §7.4 for multi-sig flow)
stellar contract invoke --id C... --source "$ADMIN_SECRET" --network testnet \
  -- upgrade --admin "$ADMIN_ADDRESS" --new_wasm_hash "$NEW_WASM_HASH"

# 5. Migrate (per-receiver batches)
./04_migrate_atomic.sh --v1-contract C... --v2-contract C... \
  --receiver-secret S... --receiver-address C... --batch-size 20

# 6. Verify
./06_verify.sh --v1-contract C... --v2-contract C...
```

## Safety notes

- **Rollback is only clean before data migration runs** (`07_rollback.sh`). After
  streams have been migrated, rollback requires the data-level procedure in
  §8.4 of the guide — treat that as an emergency path.
- Migration of paused, frozen, cancelled, or expired streams is rejected by the
  V2 bridge (`StreamNotMigratable`) by design; do not fight it.
- `migrate_stream` is authorized by the **receiver** — batches must be grouped
  by receiver secret.
- Re-run `02_snapshot.sh` before every migration attempt; snapshots are cheap
  and are your only independent record.
