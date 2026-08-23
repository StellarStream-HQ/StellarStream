//! Upgrade Proposal Module for StellarStream Contract-V1
//!
//! This module implements a secure upgrade mechanism with:
//! - Multi-sig upgrade proposals (M-of-N approval)
//! - Timelock delay before execution
//! - Version tracking and upgrade history
//! - Event emission for transparency
//! - Guard rails against common upgrade pitfalls

use crate::errors::Error;
use crate::rbac::Role;
use crate::storage::{UPGRADE_PROPOSAL_COUNT, UPGRADE_HISTORY};
use crate::types::{
    DataKey, UpgradeApprovedEvent, UpgradeCancelledEvent, UpgradeExecutedEvent,
    UpgradeProposal, UpgradeProposalStatus, UpgradeProposedEvent, UpgradeRecord,
};
use crate::StellarStreamContract;
use soroban_sdk::{symbol_short, Address, BytesN, Env, Vec};

/// Timelock delay in seconds (48 hours)
pub const UPGRADE_TIMELOCK_SECS: u64 = 172_800; // 48 hours

/// Proposal expiry in seconds (7 days)
pub const PROPOSAL_EXPIRY_SECS: u64 = 604_800; // 7 days

/// Maximum upgrade proposals that can be stored in history
pub const MAX_UPGRADE_HISTORY: u32 = 20;

// ======================== Storage Helpers ========================

/// Get the next upgrade proposal ID
pub fn next_proposal_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::UpgradeProposalCount)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::UpgradeProposalCount, &(id + 1));
    id
}

/// Store an upgrade proposal
pub fn store_proposal(env: &Env, proposal: &UpgradeProposal) {
    let key = DataKey::UpgradeProposal(proposal.proposal_id);
    env.storage().instance().set(&key, proposal);
}

/// Retrieve an upgrade proposal
pub fn get_proposal(env: &Env, proposal_id: u64) -> Option<UpgradeProposal> {
    let key = DataKey::UpgradeProposal(proposal_id);
    env.storage().instance().get(&key)
}

/// Remove an upgrade proposal (after expiry)
pub fn remove_proposal(env: &Env, proposal_id: u64) {
    let key = DataKey::UpgradeProposal(proposal_id);
    env.storage().instance().remove(&key);
}

/// Record an upgrade in history
pub fn record_upgrade(env: &Env, record: &UpgradeRecord) {
    let mut history: Vec<UpgradeRecord> = env
        .storage()
        .instance()
        .get(&DataKey::UpgradeHistory)
        .unwrap_or(Vec::new(env));

    // Keep history bounded
    if history.len() >= MAX_UPGRADE_HISTORY as u32 {
        // Remove oldest entry
        let mut new_history: Vec<UpgradeRecord> = Vec::new(env);
        for i in 1..history.len() {
            new_history.push_back(history.get(i).unwrap());
        }
        history = new_history;
    }

    history.push_back(record.clone());
    env.storage()
        .instance()
        .set(&DataKey::UpgradeHistory, &history);
}

/// Get upgrade history
pub fn get_upgrade_history(env: &Env) -> Vec<UpgradeRecord> {
    env.storage()
        .instance()
        .get(&DataKey::UpgradeHistory)
        .unwrap_or(Vec::new(env))
}

// ======================== Contract Functions ========================

impl StellarStreamContract {
    /// Propose an upgrade to a new WASM hash.
    ///
    /// Creates a multi-sig upgrade proposal that requires `required_approvals`
    /// approvals from SuperAdmin addresses before it can be executed.
    ///
    /// # Parameters
    /// - `env`: Contract environment
    /// - `proposer`: Address proposing the upgrade (must have SuperAdmin role)
    /// - `new_wasm_hash`: The 32-byte hash of the new WASM binary
    /// - `required_approvals`: Number of approvals required (M-of-N)
    /// - `description`: Human-readable description of the upgrade reason
    ///
    /// # Returns
    /// The proposal ID if successful
    pub fn propose_upgrade(
        env: Env,
        proposer: Address,
        new_wasm_hash: BytesN<32>,
        required_approvals: u32,
        description: soroban_sdk::String,
    ) -> Result<u64, Error> {
        proposer.require_auth();

        // Only SuperAdmin can propose upgrades
        if !Self::has_role(&env, &proposer, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }

        // Validate inputs
        if required_approvals == 0 {
            return Err(Error::InvalidApprovalThreshold);
        }

        // Validate WASM hash is not empty
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        if new_wasm_hash == zero_hash {
            return Err(Error::InvalidAmount); // Reuse error for invalid hash
        }

        let now = env.ledger().timestamp();
        let proposal_id = next_proposal_id(&env);

        let proposal = UpgradeProposal {
            proposal_id,
            new_wasm_hash: new_wasm_hash.clone(),
            approvers: Vec::new(&env),
            required_approvals,
            created_at: now,
            timelock_expiry: now + UPGRADE_TIMELOCK_SECS,
            deadline: now + PROPOSAL_EXPIRY_SECS,
            status: UpgradeProposalStatus::Pending,
            description: description.clone(),
        };

        store_proposal(&env, &proposal);

        // Emit event
        env.events().publish(
            (symbol_short!("upg_prop"), proposer.clone()),
            UpgradeProposedEvent {
                proposal_id,
                proposer: proposer.clone(),
                new_wasm_hash,
                required_approvals,
                timelock_expiry: proposal.timelock_expiry,
                deadline: proposal.deadline,
                description,
                timestamp: now,
            },
        );

        Ok(proposal_id)
    }

    /// Approve an upgrade proposal.
    ///
    /// Each SuperAdmin can approve once. When the required number of approvals
    /// is reached, the proposal status changes to `Approved`.
    ///
    /// # Parameters
    /// - `env`: Contract environment
    /// - `proposal_id`: The ID of the upgrade proposal
    /// - `approver`: Address approving the proposal (must have SuperAdmin role)
    pub fn approve_upgrade(env: Env, proposal_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();

        // Only SuperAdmin can approve upgrades
        if !Self::has_role(&env, &approver, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }

        let mut proposal = get_proposal(&env, proposal_id).ok_or(Error::ProposalNotFound)?;

        // Check proposal status
        match proposal.status {
            UpgradeProposalStatus::Executed => {
                return Err(Error::ProposalAlreadyExecuted);
            }
            UpgradeProposalStatus::Expired | UpgradeProposalStatus::Rejected => {
                return Err(Error::ProposalExpired);
            }
            UpgradeProposalStatus::Approved => {
                return Err(Error::AlreadyApproved);
            }
            UpgradeProposalStatus::Pending => {
                // Proceed with approval
            }
        }

        // Check if proposal has expired
        let now = env.ledger().timestamp();
        if now > proposal.deadline {
            proposal.status = UpgradeProposalStatus::Expired;
            store_proposal(&env, &proposal);
            return Err(Error::ProposalExpired);
        }

        // Check for duplicate approval
        for existing_approver in proposal.approvers.iter() {
            if existing_approver == approver {
                return Err(Error::AlreadyApproved);
            }
        }

        // Add approval
        proposal.approvers.push_back(approver.clone());

        // Check if threshold reached
        let approval_count = proposal.approvers.len();
        if approval_count >= proposal.required_approvals {
            proposal.status = UpgradeProposalStatus::Approved;
        }

        store_proposal(&env, &proposal);

        // Emit event
        env.events().publish(
            (symbol_short!("upg_appr"), approver.clone()),
            UpgradeApprovedEvent {
                proposal_id,
                approver: approver.clone(),
                approval_count,
                required_approvals: proposal.required_approvals,
                timestamp: now,
            },
        );

        Ok(())
    }

    /// Execute an approved upgrade proposal.
    ///
    /// Requirements:
    /// 1. Proposal must have status `Approved`
    /// 2. Timelock period must have elapsed
    /// 3. Caller must be a SuperAdmin
    ///
    /// # Parameters
    /// - `env`: Contract environment
    /// - `proposal_id`: The ID of the upgrade proposal
    /// - `executor`: Address executing the upgrade (must have SuperAdmin role)
    pub fn execute_upgrade(env: Env, proposal_id: u64, executor: Address) -> Result<(), Error> {
        executor.require_auth();

        // Only SuperAdmin can execute upgrades
        if !Self::has_role(&env, &executor, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }

        let mut proposal = get_proposal(&env, proposal_id).ok_or(Error::ProposalNotFound)?;

        // Check proposal is in approved state
        if proposal.status != UpgradeProposalStatus::Approved {
            return Err(Error::ProposalAlreadyExecuted);
        }

        let now = env.ledger().timestamp();

        // Check timelock has elapsed
        if now < proposal.timelock_expiry {
            return Err(Error::InvalidTimeRange);
        }

        // Check proposal hasn't expired
        if now > proposal.deadline {
            proposal.status = UpgradeProposalStatus::Expired;
            store_proposal(&env, &proposal);
            return Err(Error::ProposalExpired);
        }

        // Mark as executed BEFORE the upgrade to prevent reentrancy
        proposal.status = UpgradeProposalStatus::Executed;
        store_proposal(&env, &proposal);

        // Get current version before upgrade
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1);

        // Perform the actual WASM upgrade
        env.deployer()
            .update_current_contract_wasm(proposal.new_wasm_hash.clone());

        // Note: After upgrade_current_contract_wasm, the contract code is replaced.
        // The storage (including the upgrade proposal state) is preserved.
        // Record the upgrade in history (storage persists across WASM changes)
        let upgrade_record = UpgradeRecord {
            wasm_hash: proposal.new_wasm_hash.clone(),
            version: current_version + 1,
            executed_by: executor.clone(),
            executed_at: now,
        };
        record_upgrade(&env, &upgrade_record);

        // Update version
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &(current_version + 1));

        // Emit event (this happens after upgrade, so the new code should handle it,
        // but the event data is already written to storage)
        env.events().publish(
            (symbol_short!("upg_exec"), executor.clone()),
            UpgradeExecutedEvent {
                proposal_id,
                new_wasm_hash: proposal.new_wasm_hash,
                executed_by: executor,
                new_version: current_version + 1,
                timestamp: now,
            },
        );

        Ok(())
    }

    /// Cancel an upgrade proposal before it's executed.
    /// Only the proposer or a SuperAdmin can cancel.
    ///
    /// # Parameters
    /// - `env`: Contract environment
    /// - `proposal_id`: The ID of the upgrade proposal
    /// - `caller`: Address cancelling the proposal
    /// - `reason`: Reason for cancellation
    pub fn cancel_upgrade(
        env: Env,
        proposal_id: u64,
        caller: Address,
        reason: soroban_sdk::String,
    ) -> Result<(), Error> {
        caller.require_auth();

        let proposal = get_proposal(&env, proposal_id).ok_or(Error::ProposalNotFound)?;

        // Only the proposer or a SuperAdmin can cancel
        // Since we don't store the proposer separately, we check SuperAdmin role
        if !Self::has_role(&env, &caller, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }

        // Cannot cancel an already executed proposal
        if proposal.status == UpgradeProposalStatus::Executed {
            return Err(Error::ProposalAlreadyExecuted);
        }

        // Cannot cancel already expired or rejected
        if proposal.status == UpgradeProposalStatus::Rejected {
            return Err(Error::ProposalExpired);
        }

        // Mark as rejected
        let mut updated_proposal = proposal.clone();
        updated_proposal.status = UpgradeProposalStatus::Rejected;
        store_proposal(&env, &updated_proposal);

        // Emit event
        env.events().publish(
            (symbol_short!("upg_cncl"), caller.clone()),
            UpgradeCancelledEvent {
                proposal_id,
                cancelled_by: caller,
                reason,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Get an upgrade proposal by ID
    pub fn get_upgrade_proposal(env: Env, proposal_id: u64) -> Option<UpgradeProposal> {
        get_proposal(&env, proposal_id)
    }

    /// Get the upgrade history
    pub fn get_upgrade_history(env: Env) -> Vec<UpgradeRecord> {
        get_upgrade_history(&env)
    }

    /// Get the current contract version
    pub fn get_contract_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1)
    }
}

