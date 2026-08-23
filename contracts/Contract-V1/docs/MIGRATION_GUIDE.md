# StellarStream Contract Migration Guide

**Comprehensive guide for safely migrating StellarStream contracts and data from V1 to V2 (and beyond).**

| | |
|---|---|
| **Document version** | 1.0.0 |
| **Applies to** | `contracts/Contract-V1`, `contracts/Contract-V2` |
| **Audience** | Contract administrators, protocol operators, security reviewers, integrators |
| **Risk level** | 🔴 High — migrations are irreversible, high-risk operations |
| **Last updated** | 2026-08-19 |

> ⚠️ **Read this first.** Contract migrations are among the highest-risk operations in any
> DeFi protocol. A single mistake can lock user funds, corrupt storage, or brick the
> contract. **Practice the entire migration on testnet multiple times before touching
> production.** This guide exists to make that process safe, repeatable, and verifiable.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Migration Fundamentals](#2-migration-fundamentals)
3. [Decision Framework: Choosing a Migration Strategy](#3-decision-framework-choosing-a-migration-strategy)
4. [Pre-Migration Checklist](#4-pre-migration-checklist)
5. [Data Migration Procedures](#5-data-migration-procedures)
6. [Testing the Migration on Testnet](#6-testing-the-migration-on-testnet)
7. [Production Migration Runbook](#7-production-migration-runbook)
8. [Rollback Procedures](#8-rollback-procedures)
8A. [Security Considerations](#8a-security-considerations)
8B. [Backend and Indexer Coordination](#8b-backend-and-indexer-coordination)
9. [Downtime Considerations](#9-downtime-considerations)
10. [User Communication Plan](#10-user-communication-plan)
11. [Post-Migration Verification](#11-post-migration-verification)
12. [Troubleshooting Common Issues](#12-troubleshooting-common-issues)
13. [Migration Scripts](#13-migration-scripts)
14. [Example Migrations](#14-example-migrations)
15. [FAQ](#15-faq)
16. [Review Sign-Off](#16-review-sign-off)
- [Appendix A: CLI Quick Reference](#appendix-a-cli-quick-reference)
- [Appendix B: Storage Key Reference](#appendix-b-storage-key-reference)
- [Appendix C: Migration Events](#appendix-c-migration-events)
- [Appendix D: Sample Snapshot Format](#appendix-d-sample-snapshot-format)
- [Appendix E: Glossary](#appendix-e-glossary)

---

## 1. Introduction

### 1.1 Purpose

This document is the authoritative reference for migrating the StellarStream protocol from
**Contract-V1** to **Contract-V2**. It covers:

- What changes between V1 and V2, at the code, storage, and semantic levels;
- The two primary migration strategies — **atomic** and **gradual** — and how to choose;
- Complete, step-by-step migration procedures with copy-pasteable commands;
- How to test the migration on testnet until it is boring;
- Rollback procedures for every stage of the migration;
- Downtime budgeting and minimization;
- A user communication plan with ready-to-use templates;
- Post-migration verification, monitoring, and troubleshooting;
- A set of auditable migration scripts under `scripts/migrate/`.

### 1.2 Scope

This guide covers **contract-level and data-level migration** between major contract
versions. It does **not** cover:

- Backend/API migrations (see `backend/SNAPSHOT_MIGRATION.md` and backend Prisma migrations);
- Frontend changes required to interact with V2;
- Day-to-day contract operations (see the Contract-V1 `README.md`);
- Deploying a brand-new protocol from scratch.

Where V2 requires coordinated backend changes, this guide flags it in the relevant section.

### 1.3 Audience

| Reader | What they should take away |
|---|---|
| **Admin / operator** | The runbook (§7), rollback (§8), and downtime plan (§9) |
| **Security reviewer** | The safety principles (§2.7), checklist (§4), and testnet testing (§6) |
| **Integrator / dApp developer** | The data model changes (§5.1–5.2) and verification queries (§11) |
| **Community / comms lead** | The communication plan (§10) and templates |

### 1.4 How to Use This Guide

1. **First time?** Read §2 (fundamentals) and §3 (strategy selection) before anything else.
2. **Planning a migration?** Work through the checklist in §4 and the strategy decision in §3.
3. **Ready to practice?** Follow §6 on testnet. Do not skip this step.
4. **Going to production?** Use the runbook in §7, keeping §8 (rollback) within reach.
5. **Something went wrong?** Jump to §12 (troubleshooting) and §8 (rollback).

### 1.5 Related Documentation

| Document | Purpose |
|---|---|
| `contracts/Contract-V1/README.md` | Full V1 protocol documentation, API reference |
| `contracts/Contract-V1/MIGRATION_FRAMEWORK.md` | V1's internal post-upgrade migration framework |
| `contracts/Contract-V1/CONTRACT_UPGRADABILITY.md` | The V1 upgrade mechanism (WASM swap, multi-sig, timelock) |
| `contracts/Contract-V1/MIGRATION_IMPLEMENTATION_SUMMARY.md` | Implementation summary of the V1 migration framework |
| `contracts/Contract-V2/README.md` | V2 project structure and build instructions |
| `backend/SNAPSHOT_MIGRATION.md` | Backend snapshot/data migration notes |
| `contracts/Contract-V1/scripts/migrate/README.md` | The migration script suite shipped with this guide |

### 1.6 Conventions Used in This Guide

- **`$VARIABLE`** — an environment variable or shell placeholder you must set.
- **`CONTRACT_ID`** — the Soroban contract address (starts with `C...`).
- **`--network testnet`** vs **`--network mainnet`** — always test on testnet first.
- **`[ ]`** — a checklist item. Copy checklists into your migration ticket.
- Commands assume the **Stellar CLI** (`stellar`) or its predecessor (`soroban`). Most
  examples use `stellar`; the equivalent `soroban` command is noted where they differ.

---

## 2. Migration Fundamentals

### 2.1 What Is a Contract Migration?

A contract migration is the coordinated process of:

1. **Upgrading the contract logic** — replacing the deployed WASM bytecode (or deploying a
   new contract instance); and
2. **Migrating the data** — transforming stored state so it is compatible with the new
   logic (e.g., reading legacy `Stream` structs and writing new `StreamV2` structs).

In Soroban, upgrading the WASM of an existing contract **preserves the contract ID and all
storage**. This is the mechanism StellarStream V1 uses (`upgrade`, multi-sig upgrade
proposals). Data migration is then performed by migration functions that read legacy
storage formats and write the new formats.

### 2.2 Upgrade vs. Data Migration

These are two distinct operations and are frequently confused:

| Operation | What it does | When it is needed |
|---|---|---|
| **WASM upgrade** | Replaces the executable bytecode of a deployed contract (same ID, same storage). | Every time the contract logic changes. |
| **Data migration** | Transforms stored data from an old schema to a new schema. | Only when the **storage schema** changes (new fields, changed types, new keys). |

> 💡 **Rule of thumb:** if the new code can read all existing storage without changes, you
> only need an upgrade. If the new code expects fields or formats that don't exist in old
> storage, you need an upgrade **plus** a data migration.

V1 → V2 involves **both**: V2 is a new contract (`Contract` with `CONTRACT_VERSION = 2`)
that reads streams from V1 (`migrate_stream`, `migrate_v1_stream`) and re-creates them in
its own storage.

### 2.3 Versioning Model

- **Contract-V1** tracks a version via `DataKey::ContractVersion` and records executed
  migrations via `DataKey::MigrationExecuted(u32)`.
  - Version 1: original `Stream` struct.
  - Version 2: `Stream` with `cliff_time` and additional fields.
- **Contract-V2** reports `version()` → `2` from a compile-time constant
  (`CONTRACT_VERSION`).

Versioning rules enforced by the V1 framework:

- Migrations are **forward-only**: `target_version > current_version` or the call panics.
- Migrations are **one-time**: each `MigrationExecuted(version)` key is set after success,
  so the same migration cannot run twice.
- The version is **queryable**: `get_version()` / `get_contract_version()`.

### 2.4 What Changes Between V1 and V2

At a high level, V2 is a re-architected contract with an expanded `StreamV2` data model,
new storage layout, an event log, rate proposals, swap streams, scheduled operations, and
more. For migration purposes, the differences that matter are:

| Area | V1 | V2 |
|---|---|---|
| Contract struct | `StellarStreamContract` | `Contract` |
| Init function | `initialize(env, admin)` | `init(env, admin)` |
| Version query | `get_version()` | `version()` |
| Stream struct | `Stream` (V1 fields) | `StreamV2` (packed storage, more fields) |
| Storage layout | `DataKey::Stream(u64)` etc. | `DataKeyV2::Stream(u64)` packed bitfields |
| Stream IDs | Sequential `u64` | Sequential `u64` (independent counter) |
| Migration entry point | `migrate(env, admin, target_version)` | `migrate_stream(...)` / `migrate_v1_stream(...)` |
| Replay protection | `MigrationExecuted(u32)` | `V1MigratedMap(u64)` per V1 stream ID |
| Migration pause | — (granular pause in upgrade framework) | `toggle_migration_pause(bool)` / `is_migration_paused()` |
| Events | Soroban events per operation | Standardized `NebulaEvent` envelope |

### 2.5 Key Storage Layout (V1)

V1 stores its state under `DataKey` variants (see `contracts/Contract-V1/src/types.rs`):

```rust
pub enum DataKey {
    Stream(u64),          // A stream by ID
    StreamId,             // Next stream ID counter
    Admin,                // Admin address (backward compatible)
    FeeBps,
    Treasury,
    IsPaused,
    ReentrancyLock,
    ContractVersion,      // Current version (u32)
    MigrationExecuted(u32), // One-time migration flags
    Role(Address, Role),  // RBAC assignments
    SoulboundStreams,
    ApprovedVaults,
    VaultShares(u64),
    VotingDelegate(u64),
    UpgradeProposalCount,
    UpgradeProposal(u64),
    UpgradeHistory,
    // ... (additional keys)
}
```

The V1 `Stream` struct (current on `main`):

```rust
pub struct Stream {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_time: u64,
    pub end_time: u64,
    pub withdrawn: i128,
    pub withdrawn_amount: i128,
    pub receipt_owner: Address,
    pub paused_time: u64,
    pub total_paused_duration: u64,
    pub milestones: Vec<Milestone>,
    pub curve_type: CurveType,
    pub interest_strategy: u32,
    pub vault_address: Option<Address>,
    pub deposited_principal: i128,
    pub metadata: Option<BytesN<32>>,
    pub is_usd_pegged: bool,
    pub usd_amount: i128,
    pub oracle_address: Address,
    pub oracle_max_staleness: u64,
    pub price_min: i128,
    pub price_max: i128,
    pub is_soulbound: bool,
    pub clawback_enabled: bool,
    pub arbiter: Option<Address>,
    pub is_frozen: bool,
    pub state: StreamState,
    // ...
}
```

### 2.6 Key Storage Layout (V2)

V2 stores streams in a **packed** format (see `contracts/Contract-V2/src/storage.rs`),
which dramatically reduces storage footprint. Relevant keys include:

```rust
pub enum DataKeyV2 {
    // ...
    Stream(u64),             // A V2 stream (packed StreamV2)
    V1MigratedMap(u64),      // Replay protection: V1 stream ID -> migrated flag
    MigrationPaused,         // Master switch for migration entry points
    Paused,                  // Contract pause flag
    EmergencyMode,
    // ...
}
```

V2 exposes:

- `migrate_stream(v1_contract, v1_stream_id, caller)` — cancels the V1 stream, pulls the
  remaining balance from the receiver, and creates a V2 stream (auth: receiver).
- `migrate_v1_stream(v1_contract, v1_id, caller)` — a symbol-based variant of the bridge.
- `toggle_migration_pause(paused)` / `is_migration_paused()` — operators can halt
  migrations independently of the contract pause.
- `check_balance_integrity(token)` — returns `(on_ledger, tracked)` balances to detect
  drift after migration.
- `bump_active_streams_ttl(ids)` — keeps migrated streams alive past their TTL.

### 2.7 Migration Safety Principles

These principles are non-negotiable. Every procedure in this guide enforces them:

1. **Test on testnet first, repeatedly.** Practice until the runbook takes under 30
   minutes and requires zero improvisation.
2. **Snapshot before you touch anything.** Record the current WASM hash, contract ID,
   admin address, stream count, and a full read-only dump of stream IDs and balances.
3. **Admin-only, multi-sig where possible.** Use the V1 multi-sig upgrade proposal flow
   (`propose_upgrade` → `approve_upgrade` → `execute_upgrade`) for production upgrades.
4. **One-time, idempotent migrations.** Every migration must be safe to *retry* and
   impossible to *double-apply* (replay protection).
5. **Verify after every step.** Do not proceed to the next step until the current one is
   verified on-chain.
6. **Rollback must be pre-planned, not improvised.** Know exactly how you would undo each
   stage *before* you start it.
7. **Communicate before, during, and after.** Users must never be surprised by a
   migration (see §10).
8. **Never migrate a stream that is mid-flight** (paused, frozen, cancelled, or expired).
   V2's `migrate_stream` refuses these (`StreamNotMigratable`).

### 2.8 Two Migration Modes You Must Distinguish

Throughout this guide we use two terms that sound similar but are very different in
practice. Keeping them straight prevents the most common migration mistakes:

| Mode | Trigger | What runs | Example on-chain call |
|---|---|---|---|
| **Schema migration (within V1)** | You upgrade V1's WASM to a version whose *storage layout* changed | V1 framework: `migrate(admin, target_version)` or `migrate_single_stream(admin, stream_id)` | `migrate --admin C... --target_version 2` |
| **Protocol migration (V1 → V2)** | You deploy V2 and want streams to move from the V1 contract to the V2 contract | V2 bridge: `migrate_stream(v1_contract, v1_stream_id, caller)` | `migrate_stream --v1_contract C... --v1_stream_id 42 --caller C...` |

If you skip the schema migration when it is needed, the new V1 code will fail to
deserialize old storage (see troubleshooting scenario B in §12.2). If you run the V2
bridge before the V1 schema migration, you risk reading a half-migrated V1 stream. **Order
matters:** schema migration first (if needed), then protocol migration.

---

## 3. Decision Framework: Choosing a Migration Strategy

### 3.1 Migration Strategies Overview

StellarStream supports two primary strategies, plus a hybrid:

| Strategy | Description | Best for |
|---|---|---|
| **Atomic** (all-at-once) | Upgrade and migrate everything in a single coordinated maintenance window. | Small-to-medium stream counts; protocols that can afford short downtime. |
| **Gradual** (rolling / lazy) | Migrate streams over time — on first access, in batches, or per-receiver. | Large stream counts; protocols that cannot afford downtime; progressive risk reduction. |
| **Hybrid** | Bulk-migrate the most critical streams atomically, then let the rest migrate gradually. | Most production deployments. |

### 3.2 Atomic Migration

In an atomic migration, all of the following happen inside one tightly controlled window:

1. Freeze new stream creation (or put the contract in maintenance mode).
2. Snapshot state.
3. Upgrade the WASM.
4. Run the bulk migration (all streams).
5. Verify.
6. Resume normal operation.

**Pros**

- Single, well-defined state transition — easy to reason about.
- All users are on V2 immediately; no long tail of unmigrated streams.
- Simpler communication story ("we migrated everything on X date").

**Cons**

- Requires **downtime** (or at least a freeze on new streams) proportional to the number
  of streams.
- A failure mid-migration affects everyone at once.
- Larger batches may hit Soroban transaction size/gas limits and need chunking.

**When to choose atomic**

- Fewer than a few thousand streams.
- Streams are low-value or the protocol can tolerate a brief freeze.
- You need a hard cutover (e.g., regulatory or compliance deadline).

### 3.3 Gradual Migration

In a gradual migration, streams are migrated progressively:

- **Lazy / on-access:** the first time a receiver interacts with a V1 stream after
  cutover, the migration runs (`migrate_stream`), then the interaction continues on V2.
- **Batched:** an operator migrates streams in chunks (e.g., 50–100 per transaction) over
  minutes, hours, or days.
- **Per-receiver:** high-value receivers are migrated first, in a priority order.

**Pros**

- **No downtime** — the V1 contract keeps operating for unmigrated streams.
- Risk is spread out: a failure only affects the current batch.
- You can migrate the most important streams first and watch for problems.

**Cons**

- Longer overall migration horizon; there is a long tail of unmigrated streams.
- Two contracts (V1 + V2) must be kept operational simultaneously.
- User-facing complexity: a receiver's stream may live on V1 today and V2 tomorrow.

**When to choose gradual**

- Tens of thousands of streams or more.
- Downtime is unacceptable (e.g., continuous payroll streaming).
- You want progressive verification with real production traffic.

### 3.4 Hybrid Migration (Recommended)

1. **Freeze** new V1 stream creation.
2. **Atomically migrate** the top N streams by value (using the atomic runbook, §7).
3. **Gradually migrate** the remaining streams via lazy/on-access migration.
4. Monitor both contracts until the V1 stream count reaches zero.
5. Decommission the V1 contract (after the claim/withdrawal deadline, per V2's
   `decommission_contract` and `get_claim_deadline`).

### 3.5 Strategy Comparison Matrix

| Criterion | Atomic | Gradual | Hybrid |
|---|---|---|---|
| Downtime | Minutes–hours | None | Minutes for top streams |
| Risk concentration | High (one shot) | Low (spread out) | Medium |
| Operational complexity | Low | Medium | High |
| Migration horizon | Immediate | Days–weeks | Days–weeks |
| Two contracts live? | No | Yes | Temporarily |
| Best for | Small datasets | Large datasets | Production default |

### 3.6 Decision Tree

```
How many active streams?
├─ Fewer than ~1,000  →  ATOMIC (§3.2)
├─ 1,000 – 10,000     →  HYBRID (§3.4)
└─ More than ~10,000  →  GRADUAL (§3.3)

Can you tolerate ANY downtime?
├─ No  →  GRADUAL
└─ Yes →  ATOMIC or HYBRID

Do you have a hard cutover deadline?
├─ Yes →  ATOMIC (or HYBRID with an aggressive schedule)
└─ No  →  HYBRID or GRADUAL
```

> 💡 **Recommendation:** start with the hybrid strategy for any production deployment with
> more than a handful of streams. It gives you an atomic cutover for the critical mass and
> gradual, low-risk migration for the long tail.

---

## 4. Pre-Migration Checklist

Work through this checklist **in full** before any production migration. Every unchecked
box is a reason to delay. Copy this section into your migration ticket and tick items off
as they are completed.

### 4.1 Code Readiness

- [ ] The new contract version compiles cleanly: `cargo build --target wasm32-unknown-unknown --release`
- [ ] All unit tests pass: `cargo test` (Contract-V1 and Contract-V2)
- [ ] Migration-specific tests pass: `cargo test migration` and `cargo test upgrade`
- [ ] V1→V2 integration tests pass: `cargo test v1_to_v2` (Contract-V2)
- [ ] Storage layout changes are intentional and documented (see §5)
- [ ] Public function signatures are unchanged or **additive only** (no breaking renames
      for functions integrators call)
- [ ] Migration entry points are admin-gated and replay-protected
- [ ] WASM size is within the Soroban limit (see `build.sh` — it enforces ≤ 64 KB and
      fails otherwise)
- [ ] The exact WASM binary that will ship has been built from the exact commit being
      reviewed (record the commit hash)

### 4.2 Environment Readiness

- [ ] Stellar CLI installed and authenticated for testnet **and** mainnet
- [ ] `stellar network` shows correct RPC endpoints for testnet and mainnet
- [ ] Admin account(s) funded and their secret keys stored in a password manager / HSM
- [ ] Multi-sig upgrade signers identified and their keys accessible
- [ ] The **current deployed WASM hash** is recorded (needed for rollback)
- [ ] A testnet replica of the production contract exists and is in the same state
- [ ] Block explorer access (e.g., Stellar Expert, StellarChain) for event verification
- [ ] Gas/fee budget approved for the migration transactions

### 4.3 Team Readiness

- [ ] A **migration owner** is named (single point of accountability)
- [ ] A **backup operator** is named (can take over if the owner is unavailable)
- [ ] At least two team members have rehearsed the migration on testnet end-to-end
- [ ] A security reviewer has signed off on the migration plan
- [ ] An on-call rotation is established for 48 hours post-migration
- [ ] Rollback decision authority is defined (who can call rollback, and when)
- [ ] All operators know how to reach each other during the window (signal channel)

### 4.4 Data Readiness

- [ ] A read-only inventory of all V1 streams exists: `stream_id`, sender, receiver,
      token, total_amount, withdrawn, state, end_time
- [ ] The inventory has been cross-checked against on-chain queries (`get_stream`)
- [ ] No streams are paused/frozen/cancelled/expired at migration time, **or** those
      streams are explicitly excluded and handled
- [ ] Total outstanding value is computed and matches the V1 contract's tracked totals
- [ ] Token contracts used by streams are confirmed alive and unpaused
- [ ] TTL of long-lived storage entries is checked (migrated streams need their TTL
      bumped — see `bump_active_streams_ttl`)
- [ ] A data-dump snapshot is saved to durable storage (see `scripts/migrate/02_snapshot.sh`)

### 4.5 Communications Readiness

- [ ] Announcement drafted and scheduled (see §10 templates)
- [ ] Support/help-desk staff briefed on the migration and the FAQ
- [ ] Status page / in-app banner mechanism tested
- [ ] A "migration complete" message is drafted
- [ ] A "rollback" message is drafted (hopefully never used)
- [ ] External integrators (if any) have been notified of the cutover date and any API
      changes

### 4.6 Final Go / No-Go

- [ ] All of the above boxes are ticked
- [ ] Testnet rehearsal completed at least twice with no open issues
- [ ] The chosen strategy (§3) is documented with rationale
- [ ] The migration window is announced and on the calendar
- [ ] **GO / NO-GO** (circle one): GO — with named owner and rollback authority

---

## 5. Data Migration Procedures

### 5.1 Understanding the Data Model

The core data unit is the **stream**. In V1 it is the `Stream` struct stored under
`DataKey::Stream(u64)`; in V2 it is the packed `StreamV2` stored under
`DataKeyV2::Stream(u64)`.

The migration does **not** copy V1 structs byte-for-byte. It:

1. Reads the V1 stream.
2. Computes the **remaining** (unlocked-but-not-yet-withdrawn) balance at the current time.
3. Cancels the V1 stream, releasing the remaining balance to the receiver (V1's
   `cancel_stream` returns the balance).
4. Pulls the released funds from the receiver into the V2 contract (token transfer).
5. Creates a fresh V2 stream with `start_time = now`, `cliff_time = now`,
   `withdrawn_amount = 0`, and the **remaining** balance as `total_amount`.
6. Marks the V1 stream ID as migrated (`V1MigratedMap(v1_stream_id)`) to prevent replay.

Because the V2 stream restarts vesting at `now` with the remaining balance, the receiver's
economics are preserved: they keep the value already earned, and the rest continues to
stream over the original remaining duration (`end_time - now`).

### 5.2 Field Mapping V1 → V2

| V1 field | V2 field | Mapping rule |
|---|---|---|
| `sender` | `sender` | Copied as-is |
| `receiver` | `receiver` | Copied as-is |
| `receiver` | `beneficiary` | Initialized to the caller (receiver) |
| `token` | `token` | Copied as-is |
| `total_amount` | `total_amount` | **Remaining** balance = `total_amount - unlocked` |
| `withdrawn` / `withdrawn_amount` | `withdrawn_amount` | Reset to `0` (remaining balance only is migrated) |
| `start_time` | `start_time` | Set to migration time (`now`) |
| `cliff_time` | `cliff_time` | Set to `now` (no new cliff for migrated streams) |
| `end_time` | `end_time` | Copied from V1 (original end) |
| `state` | `cancelled` / status | Must be `Active`; paused/frozen/cancelled streams are rejected |
| — | `migrated_from_v1` | `true` |
| — | `v1_stream_id` | Original V1 stream ID (audit trail) |
| Everything else | defaults | `step_duration=0`, `multiplier_bps=0`, `penalty_bps=0`, `curve_type=0`, no vault/split/recurrence |

> ⚠️ **Watch out:** migrated streams restart with `start_time = now`. If you need to
> preserve the *original* elapsed time for reporting, read it from the `migrated`
> event / the `v1_stream_id` back-reference before the V1 contract is decommissioned.

### 5.3 Concrete Example: A Schema Migration in V1 (adding a field)

Suppose V1.1 adds a `recipient_note: Option<BytesN<32>>` field to `Stream`. Old storage
has `Stream` records without that field. The V1 migration framework handles this with a
legacy struct plus a conversion function:

```rust
// Legacy struct: exactly the on-disk format of the previous version.
#[contracttype]
#[derive(Clone)]
pub struct LegacyStream {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub end_time: u64,
    pub withdrawn_amount: i128,
    // ... all fields that existed in the old schema, in order
}

/// Migration body: read legacy, write new, mark executed.
fn migrate_v1_to_v2(env: &Env) {
    let stream_count: u64 = env
        .storage()
        .instance()
        .get(&DataKey::StreamId)
        .unwrap_or(0);

    for stream_id in 1..=stream_count {
        let key = DataKey::Stream(stream_id);
        if let Some(legacy) = env
            .storage()
            .persistent()
            .get::<DataKey, LegacyStream>(&key)
        {
            let migrated = Stream {
                sender: legacy.sender,
                receiver: legacy.receiver,
                token: legacy.token,
                total_amount: legacy.total_amount,
                start_time: legacy.start_time,
                cliff_time: legacy.start_time, // default: no cliff
                end_time: legacy.end_time,
                withdrawn_amount: legacy.withdrawn_amount,
                recipient_note: None,          // NEW field, safe default
                // ... remaining fields with defaults
            };
            env.storage().persistent().set(&key, &migrated);
        }
    }
}
```

Rules for writing a safe schema migration:

1. **Keep the legacy struct definition in the codebase** for as long as any contract
   could still hold old data. Deleting it makes rollback impossible.
2. **Every new field needs an explicit default** (e.g., `None`, `0`, `false`) so
   semantics are defined, not accidental.
3. **Never reorder or rename fields** in the legacy struct — it must match the old
   on-disk bytes exactly.
4. **Validate before writing** when a field's type changes (e.g., `i128` → `u128`):
   panic if a value would lose data.
5. **Mark the migration executed only after all records are written** so a crash
   mid-migration is retryable.

### 5.4 Migration Functions

#### V1 internal migration framework (post-upgrade schema migration)

If you are upgrading **within V1** (e.g., adding a field), use the V1 framework:

```rust
// Query the current version
pub fn get_version(env: Env) -> u32

// Run all migrations up to target_version (admin only)
pub fn migrate(env: Env, admin: Address, target_version: u32)

// Migrate a single stream (admin only) — useful for gradual migration
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

The framework is self-destructing (one-time), forward-only, admin-gated, and emits
`migrate` / `mig_strm` events.

#### V2 migration bridge (V1 → V2)

```rust
// Primary bridge: receiver calls this to migrate their own stream
pub fn migrate_stream(env: Env, v1_contract: Address, v1_stream_id: u64, caller: Address)
    -> Result<u64, Error>

// Symbol-based variant
pub fn migrate_v1_stream(env: Env, v1_contract: Address, v1_id: Symbol, caller: Address)
    -> Result<u64, Error>
```

Authorization: `caller.require_auth()` and `v1_stream.receiver == caller`.
Replay protection: `is_v1_migrated(v1_stream_id)` → `AlreadyMigrated`.
State guard: paused/frozen/cancelled/expired streams → `StreamNotMigratable`.

### 5.5 Replay-Attack Prevention

- **V1 framework:** `MigrationExecuted(u32)` prevents re-running the same schema migration.
- **V2 bridge:** `V1MigratedMap(u64)` (per V1 stream ID) prevents migrating the same V1
  stream twice. Attempting a second migration returns `Error::AlreadyMigrated`.

Never remove these guards. If you need to re-run a failed migration, fix the failure and
retry the *same* transaction (idempotent), or add a new migration version — never bypass
the existing one.

### 5.6 Idempotency and Retry Semantics

Migrations are designed to be **safe to retry**:

- A migration that fails partway (e.g., out of gas) leaves the V1 stream intact because
  the V1 cancel + V2 create happen in a sequence where the V2 record is only written after
  the V1 cancel succeeds.
- Re-running a successful migration is blocked by replay protection.
- For batch migrations, chunk the work so a single failed transaction only needs that
  chunk retried, not the whole batch.

### 5.7 Batch Migration (Atomic Path)

Batch migration is appropriate for the atomic/hybrid strategy. The idea: iterate over the
stream inventory and migrate streams in chunks small enough to fit in a single
transaction's gas budget.

Pseudo-code for a batch migration helper:

```rust
/// Migrate a batch of V1 streams to V2 in one transaction.
/// Returns the number successfully migrated.
pub fn migrate_batch(
    env: Env,
    v1_contract: Address,
    caller: Address,
    stream_ids: Vec<u64>,
) -> u32 {
    let mut migrated = 0u32;
    for id in stream_ids.iter() {
        match Self::migrate_stream(
            env.clone(),
            v1_contract.clone(),
            id,
            caller.clone(),
        ) {
            Ok(_) => migrated += 1,
            Err(_) => { /* skip; caller decides whether to fail the batch */ }
        }
    }
    migrated
}
```

> ⚠️ **Gas budgeting:** each stream migration involves a cross-contract read, a V1 cancel
> (which transfers tokens), and a V2 storage write. Keep batch sizes conservative
> (start with 10–20 per transaction) and measure actual gas on testnet before scaling up.

### 5.8 Per-Stream (Lazy) Migration (Gradual Path)

For the gradual strategy, each receiver migrates their own stream by calling
`migrate_stream` the first time they interact after cutover:

```bash
stellar contract invoke \
  --id "$V2_CONTRACT_ID" \
  --source "$RECEIVER_SECRET" \
  --network testnet \
  -- \
  migrate_stream \
  --v1_contract "$V1_CONTRACT_ID" \
  --v1_stream_id 42 \
  --caller "$RECEIVER_ADDRESS"
```

Frontends should detect "stream is on V1, contract is on V2" and surface a one-click
"Migrate my stream" action. See §10 for the user-facing messaging.

### 5.9 Data Integrity Checks

After any migration, verify:

1. **Count:** number of V2 streams equals number of successfully migrated V1 streams.
2. **Value:** sum of V2 `total_amount` across migrated streams ≈ sum of V1 remaining
   balances (within rounding).
3. **Per-stream:** for a sample (and ideally all) migrated streams, `get_stream(v2_id)`
   shows the expected sender, receiver, token, and `migrated_from_v1 = true`,
   `v1_stream_id` matches.
4. **Contract balance:** `check_balance_integrity(token)` returns matching on-ledger vs
   tracked balances (V2).
5. **Events:** every migration emitted a `migrated` event with the expected payload
   (see Appendix C).

---

## 6. Testing the Migration on Testnet

> ⚠️ **This section is mandatory reading.** "We'll test it in production" is not a
> strategy. The acceptance criteria for this guide require practicing on testnet
> **multiple times**.

### 6.1 Testnet Setup

1. **Build** both contracts:

   ```bash
   # Contract-V1
   cd contracts/Contract-V1 && ./build.sh

   # Contract-V2
   cd ../Contract-V2 && stellar contract build --optimize
   ```

2. **Deploy V1** and initialize with a test admin:

   ```bash
   V1_CONTRACT_ID=$(stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
     --source "$ADMIN_SECRET" \
     --network testnet)
   echo "V1: $V1_CONTRACT_ID"

   stellar contract invoke \
     --id "$V1_CONTRACT_ID" --source "$ADMIN_SECRET" --network testnet \
     -- initialize --admin "$ADMIN_ADDRESS"
   ```

3. **Deploy V2** and initialize:

   ```bash
   V2_CONTRACT_ID=$(stellar contract deploy \
     --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts_v2.wasm \
     --source "$ADMIN_SECRET" --network testnet)
   echo "V2: $V2_CONTRACT_ID"

   stellar contract invoke \
     --id "$V2_CONTRACT_ID" --source "$ADMIN_SECRET" --network testnet \
     -- init --admin "$ADMIN_ADDRESS"
   ```

4. **Fund** test accounts (admin, senders, receivers) and the token contracts with
   testnet assets.

5. **Create representative streams** on V1 covering the matrix in §6.4.

### 6.2 Migration Rehearsal Procedure

Run this end-to-end, in order, exactly as you would on mainnet:

1. **Preflight:** run `scripts/migrate/01_preflight.sh` and confirm every check passes.
2. **Snapshot:** run `scripts/migrate/02_snapshot.sh` and save the output artifact.
3. **Build & install:** run `scripts/migrate/03_build_install.sh` (records the new WASM
   hash).
4. **Upgrade:** execute the upgrade (see §7.4).
5. **Migrate:** run the atomic or gradual migration scripts (see §7.5).
6. **Verify:** run `scripts/migrate/06_verify.sh` and confirm all integrity checks pass.
7. **Rollback drill:** after verifying, practice the rollback (see §8) so the team knows
   how to undo a migration.
8. **Repeat.** Do this at least twice. The second rehearsal should be uneventful.

### 6.3 Test Data

Create streams covering at least:

- A fresh stream with the full amount still unvested.
- A stream mid-vesting (partially unlocked, partially withdrawn).
- A stream that just started (elapsed ≈ 0).
- A stream near its end (mostly unlocked).
- A soulbound stream.
- A stream with milestones and a non-linear curve.
- A paused stream, a frozen stream, and a cancelled stream (to confirm they are
  **rejected** by the bridge).
- An expired stream (to confirm it is rejected).
- A stream with a vault / interest strategy (to observe how V2 handles it).

### 6.4 Test Cases

| # | Test case | Expected result |
|---|---|---|
| T1 | Migrate an active mid-vesting stream | V2 stream created; remaining balance correct; V1 stream cancelled; `migrated` event emitted |
| T2 | Migrate the same stream again | `Error::AlreadyMigrated` |
| T3 | Non-receiver calls `migrate_stream` | `Error::UnauthorizedSender` |
| T4 | Migrate a paused stream | `Error::StreamNotMigratable` |
| T5 | Migrate a frozen stream | `Error::StreamNotMigratable` |
| T6 | Migrate an expired stream | `Error::StreamNotMigratable` |
| T7 | Withdraw from a migrated V2 stream | Correct unlocked amount (no cliff, `start_time = now`) |
| T8 | `check_balance_integrity(token)` after batch | On-ledger == tracked |
| T9 | Pause migrations (`toggle_migration_pause(true)`) then migrate | `Error::MigrationPaused` |
| T10 | Upgrade with a non-admin | Panics / authorization error |
| T11 | Multi-sig upgrade proposal: propose → approve → execute | Upgrade succeeds only after timelock elapses |
| T12 | Rollback after upgrade (before data migration) | Contract returns to previous WASM; storage intact |
| T13 | Batch migration of 20 streams in one tx | All 20 migrated; 20 events |
| T14 | Restart a partially-failed batch | Only un-migrated streams are processed; no duplicates |

### 6.5 Gas and Cost Estimation

During rehearsal, record for the largest realistic batch:

- Gas used per single-stream migration.
- Gas used per N-stream batch.
- Ledger footprint / TTL bumps required.

Use this to size production batches and to estimate the number of transactions needed for
the full dataset. If gas per stream is high, reduce batch size or move to the gradual
strategy.

### 6.6 Testnet Sign-off Criteria

Only proceed to production when **all** of these hold:

- [ ] All test cases T1–T14 pass consistently across two or more full rehearsals.
- [ ] The full runbook (preflight → snapshot → upgrade → migrate → verify) completes
      without improvisation.
- [ ] Rollback drill completed successfully at least once.
- [ ] Gas numbers recorded and batch sizes finalized.
- [ ] A second team member has independently run the rehearsal.
- [ ] The production WASM hash matches the testnet-installed hash (build from the same
      commit).

---

## 7. Production Migration Runbook

This runbook is for the **atomic** path. For gradual, replace steps 5–6 with the
per-stream flow in §5.8.

> 🔴 **Pause point:** after each step, verify before continuing. If anything looks wrong,
> stop and consult §8 (rollback) and §12 (troubleshooting).

### 7.1 Pre-Flight (T-minus 24h)

- [ ] Re-run `scripts/migrate/01_preflight.sh` against production.
- [ ] Confirm the stream inventory matches on-chain data.
- [ ] Confirm admin/multi-sig keys are accessible.
- [ ] Confirm the maintenance window with the comms lead.

### 7.2 Freeze and Snapshot

1. **Freeze new stream creation** (contract pause or maintenance mode) so no streams are
   created mid-migration:

   ```bash
   stellar contract invoke \
     --id "$V1_CONTRACT_ID" --source "$PAUSER_SECRET" --network mainnet \
     -- pause_contract
   ```

2. **Record the current WASM hash** (this is your rollback target):

   ```bash
   CURRENT_WASM_HASH=$(stellar contract info \
     --id "$V1_CONTRACT_ID" --network mainnet | jq -r '.wasm_hash')
   echo "Keep this for rollback: $CURRENT_WASM_HASH"
   ```

3. **Snapshot all stream data**:

   ```bash
   bash contracts/Contract-V1/scripts/migrate/02_snapshot.sh \
     --contract "$V1_CONTRACT_ID" --network mainnet \
     --out "snapshots/mainnet-$(date +%Y%m%d-%H%M%S).json"
   ```

### 7.3 Build and Install the New WASM

```bash
# Build from the exact reviewed commit
cd contracts/Contract-V2
stellar contract build --optimize

# Optimize (V1's build.sh already does this; keep the flag for V2)
NEW_WASM_HASH=$(stellar contract install \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts_v2.wasm \
  --source "$ADMIN_SECRET" --network mainnet)
echo "New WASM hash: $NEW_WASM_HASH"
```

> 💡 For a **V1-internal** upgrade (same contract ID), install the new V1 WASM and record
> its hash — this is the hash you pass to `upgrade`/`propose_upgrade`.

### 7.4 Execute the Upgrade

**Option A — direct upgrade (V1, SuperAdmin):**

```bash
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --source "$ADMIN_SECRET" --network mainnet \
  -- upgrade \
  --admin "$ADMIN_ADDRESS" \
  --new_wasm_hash "$NEW_WASM_HASH"
```

**Option B — multi-sig upgrade proposal (V1, recommended for production):**

```bash
# 1. Propose
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --source "$ADMIN_SECRET" --network mainnet \
  -- propose_upgrade \
  --proposer "$ADMIN_ADDRESS" \
  --new_wasm_hash "$NEW_WASM_HASH" \
  --required_approvals 2 \
  --description "V2 migration"

# 2. Approve (from each signer; timelock = 48h, expiry = 7d)
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --source "$SIGNER2_SECRET" --network mainnet \
  -- approve_upgrade --proposal_id 1 --approver "$SIGNER2_ADDRESS"

# 3. Execute (only after the 48h timelock has elapsed)
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --source "$ADMIN_SECRET" --network mainnet \
  -- execute_upgrade --proposal_id 1 --executor "$ADMIN_ADDRESS"
```

**Verify the upgrade:**

```bash
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --network mainnet -- get_admin
# and, for the upgrade history:
stellar contract invoke \
  --id "$V1_CONTRACT_ID" --network mainnet -- get_upgrade_history
```

### 7.5 Run the Migration

**Atomic path** — migrate all streams in chunks:

```bash
bash contracts/Contract-V1/scripts/migrate/04_migrate_atomic.sh \
  --v1-contract "$V1_CONTRACT_ID" \
  --v2-contract "$V2_CONTRACT_ID" \
  --admin-secret "$ADMIN_SECRET" \
  --network mainnet \
  --batch-size 20
```

**Gradual path** — leave migration to receivers, or run batches over time:

```bash
bash contracts/Contract-V1/scripts/migrate/05_migrate_gradual.sh \
  --v1-contract "$V1_CONTRACT_ID" \
  --v2-contract "$V2_CONTRACT_ID" \
  --receiver-secret "$RECEIVER_SECRET" \
  --network mainnet \
  --stream-ids 101,102,103
```

> 🔴 If a batch fails, **stop**. Inspect the error (see §12), fix the cause, and resume
> from the failed batch. Never blindly retry the whole dataset.

### 7.6 Verify

Run the full verification suite:

```bash
bash contracts/Contract-V1/scripts/migrate/06_verify.sh \
  --v1-contract "$V1_CONTRACT_ID" \
  --v2-contract "$V2_CONTRACT_ID" \
  --network mainnet
```

Confirm at minimum: stream counts, value reconciliation, a sampled `get_stream` on V2,
`check_balance_integrity`, and the presence of `migrated` events. See §11 for the full
verification checklist.

### 7.7 Resume Operation

- [ ] Unpause V2 (or confirm it was never paused).
- [ ] Announce completion (§10).
- [ ] Begin 48-hour heightened monitoring (§11).
- [ ] Leave the V1 contract in place (frozen) until the long tail is migrated or the
      claim deadline passes, then decommission (§3.4).

---

## 8. Rollback Procedures

> 🧯 **Rollback is a plan, not a panic.** Decide in advance who can trigger it and what
> "successful rollback" means. A rollback that half-works is worse than no rollback.

### 8.1 When to Roll Back

Trigger a rollback when any of the following is true:

- The upgrade itself failed or left the contract in an unusable state.
- Post-migration verification shows data loss, incorrect balances, or unexpected errors.
- A critical user-facing flow is broken and cannot be hot-fixed within the window.
- Monitoring flags anomalous contract behavior within the first 48 hours.

### 8.2 Rollback Strategies by Stage

| Stage | Rollback action |
|---|---|
| **Before upgrade** | Nothing to roll back — abort the window. |
| **After upgrade, before data migration** | **WASM rollback:** upgrade back to the old WASM hash. Storage is unchanged, so this is clean. |
| **Mid data migration** | **Stop + WASM rollback** for the V1 contract; V2 streams already created stay on V2 (or are reconciled). |
| **After data migration** | **Reconcile:** the V1 contract was cancelled for migrated streams; roll back by re-creating V1 streams from the snapshot (§8.4). |

### 8.3 WASM-Level Rollback (the easy case)

If no data migration has run, rolling back is just another upgrade:

```bash
# You recorded CURRENT_WASM_HASH in §7.2. Re-install it if needed and upgrade back.
stellar contract install \
  --wasm "$OLD_WASM_FILE" --source "$ADMIN_SECRET" --network mainnet

stellar contract invoke \
  --id "$CONTRACT_ID" --source "$ADMIN_SECRET" --network mainnet \
  -- upgrade \
  --admin "$ADMIN_ADDRESS" \
  --new_wasm_hash "$OLD_WASM_HASH"
```

Verify the old version is active (`get_version` / `get_contract_version`) and that
storage reads correctly.

### 8.4 Data-Level Rollback (after migration ran)

Once `migrate_stream` has run for a stream, the V1 stream is cancelled and its remaining
balance moved into V2. Rolling back that stream means **re-creating the V1 stream from the
snapshot**:

1. Take the V1 stream record from the snapshot (§7.2, `02_snapshot.sh` output).
2. Have the receiver (or admin, with the receiver's cooperation) transfer the remaining
   balance back from the V2 contract to the V1 contract:
   - Cancel the V2 stream (`cancel`), returning funds to the receiver.
   - The receiver (or the migration operator, with signed authorization) funds the V1
     contract with the original `total_amount - withdrawn` that was migrated.
3. Re-create the V1 stream with the original parameters (`create_stream` with the
   original sender/receiver/token/amount/times).
4. Clear the `V1MigratedMap` entry **only** if the migration framework allows it, or
   deploy a fresh V1 instance and re-point users.

> ⚠️ **This is the hardest rollback in the protocol.** It requires token movement and
> coordination with the receiver. This is exactly why the pre-migration snapshot and the
> "no mid-flight streams" rule matter. **Avoid needing it** by rehearsing on testnet until
> data migrations never fail.

### 8.5 Post-Rollback Verification

- [ ] Contract reports the previous version.
- [ ] Stream count matches the snapshot.
- [ ] A sample of streams reads back with correct balances.
- [ ] Contract token balance matches tracked totals.
- [ ] Users have been told the migration was rolled back (§10 templates).

---

## 8A. Security Considerations

Migrations touch the most sensitive parts of the protocol: admin keys, token balances,
and upgrade paths. This section collects the security properties the migration flow must
preserve, and the threats it must defend against.

### 8A.1 Threat Model

| Threat | Defended by |
|---|---|
| Attacker migrates someone else's stream | `caller.require_auth()` + `receiver == caller` check in `migrate_stream` |
| Replay: migrating the same stream twice to drain value | `V1MigratedMap(v1_stream_id)` in V2; `MigrationExecuted(version)` in V1 |
| Rogue admin upgrades to malicious WASM | Multi-sig proposal flow + 48h timelock + SuperAdmin RBAC (V1 upgrade framework) |
| Downgrade attack (old code reading new storage) | Forward-only version checks; `target_version <= current` panics |
| Stale-oracle / wrong-price reads during migration | Migrate only `Active` streams; reject frozen/paused/expired |
| Front-running the migration to withdraw mid-flight | Freeze new stream creation during the window; migration is receiver-gated |
| Snapshot tampering (rollback to wrong state) | Store snapshots off-chain in durable storage; hash them and record the hash |

### 8A.2 Key-Handling Rules

- **Never** put a live admin secret key in a script, commit, or CI log. The scripts in
  this repo read secrets from environment variables and never echo them.
- Use **separate keys** for: migration operator (read-only + batch submission),
  upgrade signers (multi-sig), and emergency rollback. Compromise of one should not
  compromise the others.
- Rotate any key that appears in a log, screenshot, or shared terminal session.

### 8A.3 Rehearsal = Security

The best security control for migrations is *familiarity*. A team that has rehearsed the
migration on testnet five times will:

- Spot anomalous events quickly (they know what normal looks like);
- Execute rollback without fumbling (muscle memory beats panic);
- Avoid improvisation, which is where most mistakes happen.

### 8A.4 Security Review Checklist

- [ ] Migration functions are admin-gated or receiver-gated, never permissionless
- [ ] Replay protection keys exist and are tested (`AlreadyMigrated` case)
- [ ] No secrets in scripts, examples, or documentation
- [ ] Rollback path reviewed by a second engineer
- [ ] Upgrade history is bounded (V1 keeps max 20 entries) and queryable
- [ ] Events emitted for every migration (audit trail, see Appendix C)
- [ ] Testnet rehearsal included an adversarial attempt (e.g., replay, wrong caller)

---

## 8B. Backend and Indexer Coordination

Contract migration is only half the story. The backend indexer, event watcher, and API
layer must understand the new contract before, during, and after the cutover.

### 8B.1 What the Backend Must Handle

1. **Two contract IDs.** During a gradual migration both V1 and V2 are live. The
   indexer must watch both and merge streams into one view for users.
2. **Event schema change.** V2 emits standardized `NebulaEvent` envelopes; V1 emits
   plain Soroban events. Event-watcher parsing must branch on contract ID/version.
3. **`migrated` events.** The backend should record the `v1_stream_id → v2_stream_id`
   mapping as it observes `migrated` events, so user-facing history can link across
   the cutover.
4. **Balance reconciliation.** Use V2's `check_balance_integrity(token)` in monitoring
   to confirm the on-ledger balance matches tracked totals after migration batches.
5. **Decommissioning V1.** After the long tail reaches zero and the claim deadline
   passes, V2's `decommission_contract` can be exercised; the backend must stop
   querying V1 at that point.

### 8B.2 Migration-Friendly Backend Changes

- Add a `contract_version` column to the stream model (or store `contract_address`).
- Store `migrated_from_v1` / `v1_stream_id` on V2 stream records.
- Make the API accept either contract ID for `get_stream`-style lookups and resolve
  through the migration map.
- Add an alert when a `migrated` event arrives for a stream the indexer has already
  marked migrated (should never happen — replay protection).

### 8B.3 Cutover Sequence for the Backend

1. **Before:** index both contracts read-only; freeze writes to V1-derived records.
2. **During:** process events from both contracts; update the migration map.
3. **After:** switch reads to V2; backfill history from the migration map; verify the
   merged view against the snapshot (§7.2).

---

## 9. Downtime Considerations

### 9.1 Expected Downtime

| Strategy | Expected downtime |
|---|---|
| Atomic | Minutes to hours (proportional to stream count and batch size) |
| Gradual | None (streams migrate lazily; contract stays live) |
| Hybrid | Minutes for the top-stream batch; none after |

Downtime in the atomic path comes from the **freeze** (no new streams) and the time the
migration transactions take to settle. Reads usually remain available throughout.

### 9.2 Minimizing Downtime

1. **Use the gradual or hybrid strategy** when downtime is unacceptable.
2. **Pre-compute** the stream inventory and batch list so the runbook is pure execution.
3. **Pre-install** the new WASM hash (install is separate from upgrade) so the upgrade
   transaction is the only on-chain step.
4. **Parallelize carefully** — multiple migration transactions can be submitted
   concurrently, but beware nonce/sequence conflicts from the same account; use separate
   accounts or a queue.
5. **Keep batches small** enough that failures are cheap to retry.

### 9.3 Maintenance Windows

- Announce a specific window (e.g., "02:00–04:00 UTC") and stick to it.
- Prefer low-traffic periods (weekends, low-streaming hours) for the atomic path.
- Build **buffer time** into the window — the runbook should take half the window, leaving
  the rest for verification and any rollback.
- If the window is missed, **abort and reschedule**. Do not rush.

### 9.4 SLAs and Expectations

- Set expectations in the announcement: what stays available, what is briefly frozen,
  when full service resumes.
- Define the *maximum acceptable* downtime before auto-rollback triggers.
- For the gradual path, define how long the long tail may take (and when V1 is
  decommissioned).

---

## 10. User Communication Plan

### 10.1 Principles

1. **Announce early and often.** Users need time to withdraw or prepare.
2. **Be specific.** State dates, times (with timezone), what changes, and what users must
   do (usually: nothing, unless they want to migrate early).
3. **Have a single source of truth** (status page + pinned announcement).
4. **Never surprise users.** If something goes wrong, communicate immediately and
   honestly, including rollback status.
5. **Provide self-service migration UX** for the gradual path ("Migrate my stream"
   button), so users don't have to understand the mechanics.

### 10.2 Communication Timeline

| When | Channel | Message |
|---|---|---|
| T-minus 7 days | Announcement | Migration date, what changes, what users should do (§10.3.1) |
| T-minus 24h | Reminder | Window start/end, freeze details, links (§10.3.2) |
| T-minus 1h | In-app/status page | "Maintenance starting soon" (§10.3.3) |
| During | Status page | Live status: "Upgrade complete — migrating streams" (§10.3.4) |
| T+0 (complete) | Announcement | Migration complete, what to expect (§10.3.5) |
| If rolled back | Announcement | Rollback notice (§10.3.6) |

Full templates live in `contracts/Contract-V1/docs/communication-templates/` and are
reproduced in §10.3.

### 10.3 Templates

#### 10.3.1 Pre-Migration Announcement (T-minus 7 days)

> **Subject: Upcoming StellarStream contract migration — [DATE]**
>
> Hello StellarStream users,
>
> We are upgrading the StellarStream protocol from Contract V1 to Contract V2 on
> **[DATE at TIME UTC]**. This upgrade brings improved gas efficiency, an expanded stream
> model, and a more robust event system.
>
> **What you need to do:**
> - **Nothing**, if you are happy to have your stream(s) migrated automatically.
> - If you want to migrate your stream early, you can do so starting [DATE] via the
>   "Migrate my stream" action in the app.
>
> **What happens to your streams:**
> - Your streams keep their value; the remaining balance continues streaming on V2.
> - Paused, frozen, or expired streams will NOT be migrated and will remain on V1 until
>   resolved.
>
> **Downtime:** [Brief freeze on new streams — approx. X hours / no downtime].
>
> We will post updates on the status page throughout the migration. Questions? See our FAQ
> or contact support.

#### 10.3.2 Reminder (T-minus 24h)

> **Subject: Reminder: StellarStream migration starts in 24 hours**
>
> This is a reminder that the StellarStream V1→V2 migration begins **[TIME UTC]** on
> **[DATE]**. New streams will be frozen from **[TIME]** for approximately **[DURATION]**.
> Existing streams are unaffected during the freeze. Full details: [status page link].

#### 10.3.3 Maintenance Starting (T-minus 1h)

> **Maintenance starting soon.** StellarStream will begin its contract migration in
> approximately 1 hour. New stream creation will be temporarily paused. We'll post live
> updates here.

#### 10.3.4 In-Progress Update

> **Upgrade complete — migrating streams.** The contract upgrade succeeded. We are now
> migrating streams to V2 in batches. Most users won't notice anything; if you use the app
> during this window you may see a "Migrate my stream" prompt. We'll confirm completion
> shortly.

#### 10.3.5 Migration Complete

> **Subject: StellarStream V2 is live 🎉**
>
> The migration is complete. Your streams are now on Contract V2.
>
> **What changed:** improved gas efficiency, richer stream features, standardized events.
> **What you should check:** your stream balances appear as expected; withdrawals work as
> before.
>
> If you notice anything unusual in the next 48 hours, contact support immediately.
> Thank you for your patience!

#### 10.3.6 Rollback Notice (use only if needed)

> **Subject: Important — StellarStream migration rolled back**
>
> During the migration we detected [brief, honest description of the issue]. As a safety
> measure, we rolled the protocol back to Contract V1. Your streams are safe and
> unchanged. We will reschedule the migration after resolving the issue and will announce
> the new date in advance. We apologize for the disruption.

---

## 11. Post-Migration Verification

### 11.1 Immediate Checks (within minutes)

- [ ] `version()` on V2 returns `2`.
- [ ] Upgrade history shows the upgrade event (`get_upgrade_history` on V1).
- [ ] Admin address is correct (`admin()` on V2, `get_admin()` on V1).
- [ ] A sample of migrated streams returns correct data (`get_stream` on V2).
- [ ] A test withdrawal from a migrated stream succeeds.
- [ ] `check_balance_integrity(token)` matches for all tokens used by migrated streams.
- [ ] All `migrated` events are present in the ledger (see Appendix C).

### 11.2 Short-Term Monitoring (24–48h)

- [ ] No unexpected contract errors in logs/events.
- [ ] Withdrawal success rate at or above pre-migration baseline.
- [ ] Stream creation works on V2 (`create_stream`).
- [ ] Migration pause flag is OFF (`is_migration_paused` == false) — or intentionally on.
- [ ] Gas costs per operation are within expected bounds.
- [ ] Support queue has no migration-related issues beyond the FAQ.

### 11.3 Long-Term Monitoring (7–30 days)

- [ ] TTL of migrated streams is being maintained (`bump_active_streams_ttl` running).
- [ ] Long tail of gradual migration is trending to zero.
- [ ] No `AlreadyMigrated` or `StreamNotMigratable` error spikes.
- [ ] V1 contract is decommissioned only after all streams migrated and the claim
      deadline has passed.

---

## 12. Troubleshooting Common Issues

### 12.1 Error Reference

| Error / symptom | Likely cause | Fix |
|---|---|---|
| `AlreadyMigrated` | V1 stream was already migrated (replay) | Not an error — verify the V2 stream exists; do not retry |
| `MigrationPaused` | `toggle_migration_pause(true)` is active | Operator: `toggle_migration_pause(false)` |
| `StreamNotMigratable` | Stream paused, frozen, cancelled, or expired | Resolve the stream state on V1 first, or exclude it |
| `UnauthorizedSender` | Caller ≠ `stream.receiver` | Receiver must call `migrate_stream` |
| `StreamNotFound` | V1 stream ID doesn't exist or wrong contract ID | Check `--v1_contract` and the stream ID |
| `NothingToWithdraw` | Remaining balance ≤ 0 at migration time | Stream is fully claimed; nothing to migrate |
| `ContractPaused` | Contract is paused | Unpause before migrating (`unpause_contract` / `unpause`) |
| Deserialization error reading V1 stream | Storage schema mismatch after WASM upgrade | Run the V1 schema migration first (`migrate`), then bridge to V2 |
| Out of gas on batch | Batch too large | Reduce `--batch-size` (start at 10–20) and retry the chunk |
| Transaction too large / footprint exceeded | Too many streams per transaction | Reduce batch size; split by token or receiver |
| Nonce/sequence conflict during parallel batches | Same account submits concurrently | Use a single operator account with a queue, or separate accounts |
| `AlreadyInitialized` on V2 `init` | V2 already initialized | Don't re-init; call `admin()` to confirm |

### 12.2 Scenario Walkthroughs

**Scenario A — Batch fails at stream 7 of 20.**

1. Read the error (e.g., `StreamNotMigratable` because stream 7 is paused).
2. Remove stream 7 from the input list (or resolve its state).
3. Retry the batch. Streams 1–6 are already migrated; replay protection makes the retry
   safe (they will be skipped/return `AlreadyMigrated`).
4. Continue with the remaining batches.

**Scenario B — Upgrade succeeded but reads fail (deserialization errors).**

This happens when the new WASM expects a schema the old storage doesn't have.

1. Do NOT run the V1→V2 bridge yet.
2. Run the V1 schema migration: `migrate --admin $ADMIN --target_version 2`
   (or `migrate_single_stream` per stream).
3. Re-verify reads (`get_stream`).
4. Only then proceed to the V2 bridge.

**Scenario C — Users report wrong balances after migration.**

1. Verify against the snapshot (§7.2): compare V2 `get_stream` vs snapshot V1 remaining
   balances.
2. Check `check_balance_integrity(token)` — if on-ledger ≠ tracked, investigate token
   transfers before anything else.
3. If a specific stream is wrong and it has NOT been withdrawn from on V2, roll that
   stream back per §8.4 and re-migrate.
4. Communicate status per §10.3.6 if the issue is broad.

**Scenario D — Migration window is running long.**

1. Abort new batches; let in-flight transactions settle.
2. Decide: extend the window (if comms allow) or roll back the upgrade (WASM rollback,
   §8.3 — clean because data migration barely started).
3. Never "keep going to see what happens."

---

## 13. Migration Scripts

A complete, auditable script suite ships with this guide under
`contracts/Contract-V1/scripts/migrate/`:

| Script | Purpose |
|---|---|
| `01_preflight.sh` | Verifies CLI, network, accounts, and current contract state before migrating |
| `02_snapshot.sh` | Dumps a read-only snapshot of all V1 streams (JSON) for rollback and reconciliation |
| `03_build_install.sh` | Builds the new WASM, installs it, and prints the new WASM hash |
| `04_migrate_atomic.sh` | Migrates all streams to V2 in configurable batches (atomic path) |
| `05_migrate_gradual.sh` | Migrates a specific list of streams (gradual/lazy path) |
| `06_verify.sh` | Runs post-migration verification (counts, balances, integrity, events) |
| `07_rollback.sh` | Restores the previous WASM hash (WASM-level rollback) |
| `common.sh` | Shared helpers (env loading, logging, RPC helpers) |
| `README.md` | Usage, requirements, and environment variables |

See `contracts/Contract-V1/scripts/migrate/README.md` for full usage. **Always review
these scripts before running them against production**, and run them on testnet first.

---

## 14. Example Migrations

### 14.1 Example 1 — Atomic migration of a small protocol (200 streams)

1. **Strategy:** atomic (§3.2).
2. **Freeze:** pause V1 (`pause_contract`).
3. **Snapshot:** `02_snapshot.sh` → `snapshots/mainnet-20260819.json` (200 records).
4. **Build & install:** `03_build_install.sh` → hash `a1b2...`.
5. **Upgrade:** direct `upgrade` (single SuperAdmin) or multi-sig proposal.
6. **Migrate:** `04_migrate_atomic.sh --batch-size 20` → 10 batches, ~15 minutes.
7. **Verify:** `06_verify.sh` → counts match, integrity OK.
8. **Resume:** unpause, announce, monitor 48h.

### 14.2 Example 2 — Gradual migration of a large payroll protocol (50k streams)

1. **Strategy:** hybrid (§3.4).
2. **Freeze new V1 streams**, keep existing live.
3. **Top-100 by value:** atomic batch (`04_migrate_atomic.sh` with a curated ID list).
4. **Long tail:** frontends surface "Migrate my stream" (calls `migrate_stream`).
5. **Monitoring:** `06_verify.sh` daily; `bump_active_streams_ttl` job keeps streams alive.
6. **Decommission V1** after the tail reaches zero and the claim deadline passes.

### 14.3 Example 3 — Rollback drill transcript

```
$ bash scripts/migrate/07_rollback.sh --contract C... --wasm-hash 9f86... --network testnet
[1/3] Installing previous WASM .......... ok
[2/3] Upgrading contract ................ ok
[3/3] Verifying version ................. version() == 1  ok
Rollback complete. Snapshot saved to snapshots/rollback-<ts>.json
```

---

## 15. FAQ

**Q1: Will my streams keep their value after migration?**

Yes. The already-unlocked portion is yours (it is released when the V1 stream is
cancelled), and the *remaining* balance continues streaming on V2 over the original
remaining duration. The V2 stream starts at `now` with no new cliff.

**Q2: Do I need to do anything as a user?**

In the atomic path: no. In the gradual path: optionally click "Migrate my stream" in the
app, or simply keep interacting — the frontend migrates your stream on first access.

**Q3: What happens to paused, frozen, or expired streams?**

They are **not** migrated by the V2 bridge (`StreamNotMigratable`). Resolve their state
on V1 first (e.g., resume a paused stream) and then migrate.

**Q4: Can I migrate my stream more than once?**

No. Replay protection (`V1MigratedMap`) returns `AlreadyMigrated` on a second attempt.
This is intentional and prevents value duplication.

**Q5: How long does the migration take?**

Atomic: minutes to a few hours depending on stream count and batch size. Gradual: no
perceived downtime — streams migrate lazily over days/weeks.

**Q6: What if the migration fails partway?**

Individual failures are retryable and safe: successful streams are marked migrated;
failed ones remain on V1. Fix the cause (see §12) and retry the batch.

**Q7: How do I know the migration worked?**

Run the verification suite (§11, `06_verify.sh`): version checks, stream sampling,
balance integrity, and event inspection.

**Q8: Can we roll back?**

Before any data migration runs: yes, cleanly, by upgrading back to the old WASM (§8.3).
After data migration: yes, but it is an emergency procedure requiring the snapshot
(§8.4). This is why rehearsal and snapshots are non-negotiable.

**Q9: Is there downtime?**

Atomic: a short freeze on new streams. Gradual: none. See §9 for the full breakdown.

**Q10: Who can trigger a migration?**

V1 schema migrations are admin-only. V2 bridge migrations are receiver-authorized (each
receiver migrates their own streams). Upgrades are SuperAdmin-gated and, on mainnet,
should go through the multi-sig + timelock proposal flow.

**Q11: Do integrators need to change their code?**

If they read streams from the contract directly: yes — they must query V2's contract ID
and handle the `NebulaEvent` schema. The backend coordination section (§8B) covers this.

**Q12: What about the 64 KB WASM size limit?**

`build.sh` enforces it and fails the build if exceeded. Keep the migration logic lean;
remember that the V1→V2 bridge lives in V2, so it counts against V2's budget.

---

## 16. Review Sign-Off

This guide is a living document. Before any production migration, have it reviewed by
**at least two experienced developers** (ideally one smart-contract engineer and one
protocol operator). Use this sign-off block:

### Reviewer 1 — Smart Contract Engineer

- [ ] Storage layout changes are accurate and complete (§5)
- [ ] Migration functions, auth, and replay protection are correctly described (§5.4–5.5)
- [ ] Rollback procedures are technically sound (§8)
- [ ] Security checklist is complete (§8A)
- [ ] CLI commands and function signatures match the codebase (Appendix A)

Name: \_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_\_\_\_\_

### Reviewer 2 — Protocol Operator / DevOps

- [ ] Runbook is executable end-to-end without improvisation (§7)
- [ ] Scripts in `scripts/migrate/` are correct and match the runbook (§13)
- [ ] Downtime estimates are realistic (§9)
- [ ] Monitoring and post-migration checks are sufficient (§11)
- [ ] Communication templates are ready to send (§10)

Name: \_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_\_\_\_\_

### Final Gate

- [ ] Testnet rehearsal completed twice with no open issues
- [ ] Snapshot captured and stored off-chain
- [ ] Rollback authority named
- [ ] **Approved for production:** \_\_\_\_\_\_\_\_\_\_\_\_ Date: \_\_\_\_\_\_\_\_\_\_\_\_

---

## Appendix A: CLI Quick Reference

```bash
# Build
stellar contract build --optimize                          # or: ./build.sh (V1)

# Deploy
stellar contract deploy --wasm <file> --source <sk> --network <net>

# Install WASM (get hash for upgrade)
stellar contract install --wasm <file> --source <sk> --network <net>

# Invoke
stellar contract invoke --id <id> --source <sk> --network <net> -- <fn> <args...>

# Read contract info (current WASM hash)
stellar contract info --id <id> --network <net>

# Events
stellar events --id <id> --network <net> --start-ledger <n>

# Networks
stellar network add --rpc-url <url> --network-passphrase <pass> <name>
```

## Appendix B: Storage Key Reference

**V1 (`DataKey`):** `Stream(u64)`, `StreamId`, `Admin`, `FeeBps`, `Treasury`,
`IsPaused`, `ReentrancyLock`, `ContractVersion`, `MigrationExecuted(u32)`,
`Role(Address, Role)`, `SoulboundStreams`, `ApprovedVaults`, `VaultShares(u64)`,
`VotingDelegate(u64)`, `UpgradeProposalCount`, `UpgradeProposal(u64)`, `UpgradeHistory`.

**V2 (`DataKeyV2`):** `Stream(u64)` (packed `StreamV2`), `V1MigratedMap(u64)`,
`MigrationPaused`, `Paused`, `EmergencyMode`, plus protocol configuration keys.

## Appendix C: Migration Events

**V1 schema migration:** topic `("migrate", admin)` → data `target_version`;
topic `("mig_strm", admin)` → data `stream_id`.

**V2 bridge:** topic `(v2_stream_id, "migrated")` → `NebulaEvent` with
`version=2`, `action="migrated"`, and data
`[v2_stream_id, v1_stream_id, caller, remaining_balance, timestamp]`.

**V1 upgrade:** topic `("upgrade", admin)` → data `new_wasm_hash`;
`UpgradeProposedEvent` / `UpgradeApprovedEvent` / `UpgradeExecutedEvent` /
`UpgradeCancelledEvent` for the multi-sig flow.

## Appendix D: Sample Snapshot Format

The `02_snapshot.sh` script emits JSON in this shape. Keep it in durable storage and
hash it (record the hash in your migration ticket) so rollback can never be pointed at a
tampered snapshot.

```json
{
  "network": "mainnet",
  "snapshot_at": "2026-08-19T02:00:00Z",
  "v1_contract": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2VM",
  "stream_count": 3,
  "streams": [
    {
      "stream_id": 1,
      "data": {
        "sender": "C...SENDER...",
        "receiver": "C...RECEIVER...",
        "token": "C...TOKEN...",
        "total_amount": "1000000000",
        "start_time": "1780000000",
        "cliff_time": "1780000000",
        "end_time": "1782592000",
        "withdrawn": "0",
        "state": "Active"
      }
    }
  ]
}
```

Reconciliation rule: for each migrated stream, `V2.total_amount` should equal
`V1.total_amount - V1.unlocked_at_migration_time` computed from this snapshot (within
token rounding).

## Appendix E: Glossary

| Term | Definition |
|---|---|
| **Atomic migration** | Migrating all data in one coordinated window (§3.2) |
| **Gradual migration** | Migrating data over time, on access or in batches (§3.3) |
| **WASM upgrade** | Replacing deployed contract bytecode while keeping ID and storage (§2.2) |
| **Data migration** | Transforming stored state to a new schema (§2.2) |
| **Schema migration** | V1-internal conversion of storage to a new layout (§2.8) |
| **Protocol migration** | Moving streams from the V1 contract to the V2 contract (§2.8) |
| **Replay attack** | Re-applying a migration that already ran; prevented by `V1MigratedMap` / `MigrationExecuted` |
| **Timelock** | Mandatory delay (48h) before a multi-sig upgrade executes |
| **TTL** | Soroban storage lifetime; migrated streams need `bump_active_streams_ttl` |
| **StreamNotMigratable** | V2 bridge rejection for paused/frozen/cancelled/expired streams |
| **NebulaEvent** | V2's standardized event envelope, emitted for every operation incl. migration |
| **SuperAdmin** | V1 RBAC role required for upgrades; multi-sig flow adds timelock |

---

*This guide is maintained by the StellarStream protocol team. If you find an error or
missing procedure, please open an issue or pull request. Migrations are high-risk — test,
verify, and communicate.*
