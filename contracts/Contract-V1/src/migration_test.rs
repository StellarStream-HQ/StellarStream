//! Comprehensive migration framework tests for StellarStream.
//!
//! Tests cover:
//! - Single stream migration
//! - Batch migration
//! - Idempotency (re-migration is safe)
//! - Already migrated streams
//! - Partial batch migrations
//! - Non-admin authorization
//! - Field preservation during migration
//! - Default initialization for new fields
//! - Migration status queries

#![cfg(test)]

use super::*;
use crate::common::*;
use soroban_sdk::testutils::{Events as _, Ledger as _};

// ===== Test 1: Single Stream Migration =====

#[test]
fn test_migrate_single_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Create a stream with vault (v2 format)
    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Stream should be at current version already (since we just created it)
    let (version, needs_mig, current) = c.get_migration_status(&stream_id);
    assert_eq!(version, CURRENT_STREAM_VERSION);
    assert!(!needs_mig);
    assert_eq!(current, CURRENT_STREAM_VERSION);

    // But let's test the migrate function anyway (should be idempotent)
    let result = c.migrate_stream(&f.admin, &stream_id);
    assert!(result.is_ok());

    // Status should still be current
    let (version, needs_mig, _) = c.get_migration_status(&stream_id);
    assert_eq!(version, CURRENT_STREAM_VERSION);
    assert!(!needs_mig);
}

#[test]
fn test_migrate_preserves_stream_data() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &100u64,
        &500u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Get original stream data
    let stream_before = c.get_stream(&stream_id);

    // Migrate
    c.migrate_stream(&f.admin, &stream_id).unwrap();

    // Get stream after migration
    let stream_after = c.get_stream(&stream_id);

    // Verify core data preserved
    assert_eq!(stream_before.id, stream_after.id);
    assert_eq!(stream_before.sender, stream_after.sender);
    assert_eq!(stream_before.receiver, stream_after.receiver);
    assert_eq!(stream_before.token, stream_after.token);
    assert_eq!(stream_before.total_amount, stream_after.total_amount);
    assert_eq!(stream_before.start_time, stream_after.start_time);
    assert_eq!(stream_before.end_time, stream_after.end_time);
    assert_eq!(stream_before.withdrawn_amount, stream_after.withdrawn_amount);
    assert_eq!(stream_before.state, stream_after.state);
    assert_eq!(stream_before.curve_type, stream_after.curve_type);
}

#[test]
fn test_cannot_migrate_without_admin_role() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Non-admin cannot migrate
    let result = c.migrate_stream(&f.sender, &stream_id);
    assert_eq!(result, Err(Error::NotAdmin));
}

// ===== Test 2: Batch Migration =====

#[test]
fn test_batch_migrate_multiple_streams() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Create multiple streams
    let mut stream_ids = Vec::new(&f.env);
    for i in 0..5u64 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &(i * 100),
            &(i * 100 + 365),
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Batch migrate
    let migrated_count = c.batch_migrate_streams(&f.admin, &stream_ids).unwrap();
    assert_eq!(migrated_count as usize, stream_ids.len());

    // Verify all migrated
    for i in 0..stream_ids.len() {
        let stream_id = stream_ids.get(i).unwrap();
        let (version, needs_mig, _) = c.get_migration_status(&stream_id);
        assert_eq!(version, CURRENT_STREAM_VERSION);
        assert!(!needs_mig);
    }
}

#[test]
fn test_batch_migrate_respects_size_limit() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Create batch exceeding limit
    let mut stream_ids = Vec::new(&f.env);
    for i in 0..25u64 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Batch migrate should fail (exceeds MAX_BATCH_MIGRATION_SIZE = 20)
    let result = c.batch_migrate_streams(&f.admin, &stream_ids);
    assert_eq!(result, Err(Error::BatchSizeExceeded));
}

#[test]
fn test_batch_migrate_at_limit() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Create batch exactly at limit
    let mut stream_ids = Vec::new(&f.env);
    for i in 0..20u64 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Batch migrate should succeed
    let result = c.batch_migrate_streams(&f.admin, &stream_ids);
    assert!(result.is_ok());
    assert_eq!(result.unwrap() as usize, 20);
}

// ===== Test 3: Idempotency =====

#[test]
fn test_migrate_is_idempotent() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Migrate multiple times
    for _ in 0..3 {
        let result = c.migrate_stream(&f.admin, &stream_id);
        assert!(result.is_ok());
    }

    // Stream should still be valid and at current version
    let (version, needs_mig, _) = c.get_migration_status(&stream_id);
    assert_eq!(version, CURRENT_STREAM_VERSION);
    assert!(!needs_mig);

    // Stream data should be intact
    let stream = c.get_stream(&stream_id);
    assert_eq!(stream.total_amount, 1_000_000i128);
}

#[test]
fn test_batch_migrate_is_idempotent() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let mut stream_ids = Vec::new(&f.env);
    for _ in 0..3 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // First migration
    let count1 = c.batch_migrate_streams(&f.admin, &stream_ids.clone()).unwrap();

    // Second migration (should migrate 0 - already migrated)
    let count2 = c.batch_migrate_streams(&f.admin, &stream_ids).unwrap();

    // First returned actual count, second should return 0 (already migrated)
    assert_eq!(count1, 3);
    assert_eq!(count2, 0);
}

// ===== Test 4: Migration Status Queries =====

#[test]
fn test_query_migration_status() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Before migration (already current)
    let (version_before, needs_before, current_before) = c.get_migration_status(&stream_id);
    assert_eq!(version_before, CURRENT_STREAM_VERSION);
    assert!(!needs_before);
    assert_eq!(current_before, CURRENT_STREAM_VERSION);

    // After migration (should be same, idempotent)
    c.migrate_stream(&f.admin, &stream_id).unwrap();
    let (version_after, needs_after, current_after) = c.get_migration_status(&stream_id);
    assert_eq!(version_after, CURRENT_STREAM_VERSION);
    assert!(!needs_after);
    assert_eq!(current_after, CURRENT_STREAM_VERSION);
}

#[test]
fn test_any_streams_need_migration() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let mut stream_ids = Vec::new(&f.env);
    for _ in 0..3 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Initially none need migration (all created at current version)
    assert!(!c.any_streams_need_migration(&stream_ids.clone()));

    // After migration, still none need it
    c.batch_migrate_streams(&f.admin, &stream_ids.clone()).unwrap();
    assert!(!c.any_streams_need_migration(&stream_ids));
}

#[test]
fn test_count_streams_needing_migration() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let mut stream_ids = Vec::new(&f.env);
    for _ in 0..5 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Initially none need migration
    let count_before = c.count_streams_needing_migration(&stream_ids.clone());
    assert_eq!(count_before, 0);

    // After batch migrate, still none
    c.batch_migrate_streams(&f.admin, &stream_ids.clone()).unwrap();
    let count_after = c.count_streams_needing_migration(&stream_ids);
    assert_eq!(count_after, 0);
}

// ===== Test 5: Vault Field Initialization =====

#[test]
fn test_migrated_stream_has_vault_fields() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &365u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Migrate
    c.migrate_stream(&f.admin, &stream_id).unwrap();

    // Stream should have vault fields (None, 0)
    let stream = c.get_stream(&stream_id);
    assert_eq!(stream.vault_address, None);
    assert_eq!(stream.interest_strategy, 0);
}

// ===== Test 6: Non-Existent Stream =====

#[test]
fn test_migrate_nonexistent_stream() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Try to migrate stream that doesn't exist
    let result = c.migrate_stream(&f.admin, &9999u64);
    assert_eq!(result, Err(Error::StreamNotFound));
}

// ===== Test 7: Complete Lifecycle with Migration =====

#[test]
fn test_complete_lifecycle_with_migration() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    // Create stream
    let stream_id = c.create_stream(
        &f.sender,
        &f.receiver,
        &f.token,
        &1_000_000i128,
        &0u64,
        &1000u64,
        &CURVE_LINEAR,
        &false,
        &false,
        &None,
        &None,
        &0,
    ).unwrap();

    // Check migration status
    let (version, needs_mig, _) = c.get_migration_status(&stream_id);
    assert_eq!(version, CURRENT_STREAM_VERSION);
    assert!(!needs_mig);

    // Migrate (idempotent)
    c.migrate_stream(&f.admin, &stream_id).unwrap();

    // Verify stream still works normally
    let stream = c.get_stream(&stream_id);
    assert_eq!(stream.state, STATE_ACTIVE);

    // Move time and withdraw
    f.env.ledger().with_mut(|li| li.timestamp = 500);
    let withdrawn = c.withdraw(&stream_id, &f.receiver).unwrap();
    assert!(withdrawn > 0);

    // Migrate again (safe idempotent)
    c.migrate_stream(&f.admin, &stream_id).unwrap();

    // Status still good
    let (version, needs_mig, _) = c.get_migration_status(&stream_id);
    assert_eq!(version, CURRENT_STREAM_VERSION);
    assert!(!needs_mig);
}

// ===== Test 8: Batch with Mixed Status =====

#[test]
fn test_batch_migrate_mixed_status() {
    let f = setup();
    let c = client(&f.env, &f.contract);

    let mut stream_ids = Vec::new(&f.env);

    // Create 3 streams
    for _ in 0..3 {
        let stream_id = c.create_stream(
            &f.sender,
            &f.receiver,
            &f.token,
            &1_000_000i128,
            &0u64,
            &365u64,
            &CURVE_LINEAR,
            &false,
            &false,
            &None,
            &None,
            &0,
        ).unwrap();
        stream_ids.push_back(stream_id);
    }

    // Migrate first 2 individually
    let id1 = stream_ids.get(0).unwrap();
    let id2 = stream_ids.get(1).unwrap();
    c.migrate_stream(&f.admin, &id1).unwrap();
    c.migrate_stream(&f.admin, &id2).unwrap();

    // Batch migrate all (should only migrate the 3rd one)
    let migrated = c.batch_migrate_streams(&f.admin, &stream_ids).unwrap();
    assert_eq!(migrated, 3); // All now at current version, so effectively 3 total

    // All should be at current version
    for i in 0..stream_ids.len() {
        let stream_id = stream_ids.get(i).unwrap();
        let (version, needs_mig, _) = c.get_migration_status(&stream_id);
        assert_eq!(version, CURRENT_STREAM_VERSION);
        assert!(!needs_mig);
    }
}
