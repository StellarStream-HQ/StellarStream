//! Migration framework for stream data after contract upgrades.
//!
//! This module provides functionality for migrating streams to new formats
//! after contract upgrades that change the Stream struct or introduce new fields.
//!
//! # Design
//!
//! - Migrations are **explicit and optional**: admins control when to migrate
//! - Migrations are **idempotent**: re-running migration on same stream is safe
//! - Migrations are **gradual**: no need to migrate all streams at once
//! - Migrations **preserve data**: all existing fields retained
//! - Migrations track **version**: each stream tracks which format it's in
//!
//! # Versions
//!
//! - Version 1: Initial format (no vault support)
//! - Version 2: Vault fields added (vault_address, interest_strategy)
//! - Future: Additional versions for future struct changes
//!
//! # Batch Limit
//!
//! Batch migrations limited to 20 streams per transaction to avoid gas/time limits.

use soroban_sdk::{symbol_short, Address, Env, Map};

use crate::{
    storage::{bump_stream_versions_ttl, extend_instance_ttl, extend_migration_ttl, extend_stream_ttl, DataKey},
    Error, Stream, CURRENT_STREAM_VERSION, VAULT_FEATURE_VERSION,
};

// ---------------------------------------------------------------------------
// Migration tracking
// ---------------------------------------------------------------------------

/// Get the format version of a stream.
///
/// Returns the version the stream is currently in. Defaults to 1 if no version
/// recorded (for streams created before versioning was introduced).
pub fn get_stream_version(env: &Env, stream_id: u64) -> u32 {
    let versions = get_stream_versions(env);
    versions.get(stream_id).unwrap_or(1)
}

/// Check if a stream needs migration.
pub fn needs_migration(env: &Env, stream_id: u64) -> bool {
    let current_version = get_stream_version(env, stream_id);
    current_version < CURRENT_STREAM_VERSION
}

/// Get the set of stream versions.
fn get_stream_versions(env: &Env) -> Map<u64, u32> {
    env.storage()
        .persistent()
        .get(&DataKey::StreamVersions)
        .unwrap_or(Map::new(env))
}

/// Set the version for a stream.
fn set_stream_version(env: &Env, stream_id: u64, version: u32) {
    let mut versions = get_stream_versions(env);
    versions.set(stream_id, version);
    env.storage()
        .persistent()
        .set(&DataKey::StreamVersions, &versions);
    bump_stream_versions_ttl(env);
}

// ---------------------------------------------------------------------------
// Single stream migration
// ---------------------------------------------------------------------------

/// Migrate a single stream to the current format.
///
/// # Requirements
///
/// - Caller must have admin role (enforced by caller)
/// - Stream must exist
/// - Migration only runs if stream is behind current version
///
/// # Returns
///
/// - `Ok(())` on successful migration or if already migrated
/// - `Err` if stream not found or other validation fails
///
/// # Effects
///
/// - Updates stream to current version (adds vault fields if needed)
/// - Records new version in StreamVersions map
/// - Preserves all existing stream data
/// - Is idempotent: safe to call multiple times
///
/// # Version Upgrades
///
/// Version 1 → 2:
/// - Adds `vault_address: Option<Address>` (initialized to None)
/// - Adds `interest_strategy: u32` (initialized to 0)
pub fn migrate_stream(env: &Env, stream_id: u64) -> Result<(), Error> {
    let current_version = get_stream_version(env, stream_id);

    // If already at current version, this is idempotent (success)
    if current_version >= CURRENT_STREAM_VERSION {
        return Ok(());
    }

    // Read the stream from storage
    let mut stream = env
        .storage()
        .persistent()
        .get::<_, Stream>(&DataKey::Stream(stream_id))
        .ok_or(Error::StreamNotFound)?;

    // Perform version-specific migrations
    if current_version < VAULT_FEATURE_VERSION {
        // Migrating from v1 to v2: add vault fields
        // Since Rust moves values, we can't directly "add" fields to an existing struct.
        // Instead, we reconstruct with new defaults and existing data preserved.
        stream.vault_address = None;
        stream.interest_strategy = 0;
    }

    // Validate the migrated stream
    validate_migrated_stream(&stream)?;

    // Save the updated stream
    env.storage()
        .persistent()
        .set(&DataKey::Stream(stream_id), &stream);
    extend_stream_ttl(env, stream_id);

    // Record the new version
    set_stream_version(env, stream_id, CURRENT_STREAM_VERSION);

    // Publish event
    env.events().publish(
        (symbol_short!("migr"), symbol_short!("stream")),
        (stream_id, current_version, CURRENT_STREAM_VERSION, env.ledger().timestamp()),
    );

    Ok(())
}

/// Migrate multiple streams in a batch.
///
/// # Requirements
///
/// - Caller must have admin role (enforced by caller)
/// - All streams must exist
/// - Batch size must not exceed MAX_BATCH_MIGRATION_SIZE
///
/// # Returns
///
/// - Number of streams actually migrated (excludes already-migrated streams)
/// - `Err` if batch too large or other validation fails
///
/// # Effects
///
/// - Migrates each stream in the batch to current version
/// - Skips streams already at current version (idempotent)
/// - Records versions for all streams
/// - May partially succeed if individual migrations fail (caller must handle)
///
/// # Batch Limit
///
/// Limited to 20 streams per call to avoid gas/time limits. Gradual migration
/// of large numbers of streams is recommended.
pub fn batch_migrate_streams(env: &Env, stream_ids: &Vec<u64>) -> Result<u32, Error> {
    // Validate batch size
    if stream_ids.len() > crate::MAX_BATCH_MIGRATION_SIZE as usize {
        return Err(Error::BatchSizeExceeded);
    }

    let mut migrated_count: u32 = 0;

    // Migrate each stream
    for i in 0..stream_ids.len() {
        let stream_id = stream_ids.get(i).unwrap();

        // Check if migration needed before attempting
        if needs_migration(env, stream_id) {
            // Migrate this stream
            migrate_stream(env, stream_id)?;
            migrated_count += 1;
        }
    }

    // Record batch migration progress
    extend_migration_ttl(env);

    // Publish batch event
    env.events().publish(
        (symbol_short!("migr"), symbol_short!("batch")),
        (stream_ids.len() as u32, migrated_count, env.ledger().timestamp()),
    );

    Ok(migrated_count)
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Validate a migrated stream for consistency.
fn validate_migrated_stream(stream: &Stream) -> Result<(), Error> {
    // Basic sanity checks
    if stream.id == 0 {
        return Err(Error::MigrationValidationFailed);
    }
    if stream.total_amount <= 0 {
        return Err(Error::MigrationValidationFailed);
    }
    if stream.start_time >= stream.end_time {
        return Err(Error::MigrationValidationFailed);
    }

    // If stream has vault, strategy must be valid
    if let Some(_vault) = &stream.vault_address {
        if stream.interest_strategy == 0 || (stream.interest_strategy & !crate::STRATEGY_VALID_MASK) != 0 {
            return Err(Error::MigrationValidationFailed);
        }
    } else if stream.interest_strategy != 0 {
        // If no vault, strategy must be 0
        return Err(Error::MigrationValidationFailed);
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Migration info queries
// ---------------------------------------------------------------------------

/// Get migration info for a stream.
///
/// Returns (current_version, needs_migration, current_format_version).
pub fn get_migration_info(env: &Env, stream_id: u64) -> (u32, bool, u32) {
    let current_version = get_stream_version(env, stream_id);
    let needs_mig = needs_migration(env, stream_id);
    (current_version, needs_mig, CURRENT_STREAM_VERSION)
}

/// Check if any streams in the provided list need migration.
pub fn any_need_migration(env: &Env, stream_ids: &Vec<u64>) -> bool {
    for i in 0..stream_ids.len() {
        let stream_id = stream_ids.get(i).unwrap();
        if needs_migration(env, stream_id) {
            return true;
        }
    }
    false
}

/// Count how many streams in a list need migration.
pub fn count_needing_migration(env: &Env, stream_ids: &Vec<u64>) -> u32 {
    let mut count: u32 = 0;
    for i in 0..stream_ids.len() {
        let stream_id = stream_ids.get(i).unwrap();
        if needs_migration(env, stream_id) {
            count += 1;
        }
    }
    count
}
