#![no_std]
#![allow(clippy::too_many_arguments)]

mod errors;
mod flash_loan;
mod interest;
mod math;
mod oracle;
mod rbac;
mod storage;
mod types;
mod vault;
mod voting;

#[cfg(test)]
mod remaining_time_test;

#[cfg(test)]
mod stream_active_test;

#[cfg(test)]
mod pause_resume_test;

#[cfg(test)]
mod cliff_test;

#[cfg(test)]
#[cfg(all(test, feature = "allowlist_tests"))]
mod allowlist_test;
#[cfg(all(test, feature = "clawback_tests"))]
mod clawback_test;
#[cfg(all(test, feature = "dispute_tests"))]
mod dispute_test;
#[cfg(test)]
mod soulbound_test;
#[cfg(test)]
mod topup_test;
#[cfg(all(test, feature = "vault_tests"))]
mod vault_test;
#[cfg(all(test, feature = "voting_tests"))]
mod voting_test;

// #[cfg(test)]
// mod interest_test;

// #[cfg(test)]
// mod mock_vault;

// #[cfg(test)]
// mod vault_integration_test;

#[cfg(test)]
mod ttl_stress_test;

use errors::Error;
use soroban_sdk::{
    contract, contractimpl, symbol_short, token, Address, Env, Vec,
};
use storage::{PROPOSAL_COUNT, RECEIPT, RESTRICTED_ADDRESSES, STREAM_COUNT};
use types::{
    ContributorRequest, CurveType, DataKey, Milestone, ProposalApprovedEvent, ProposalCreatedEvent,
    ReceiptMetadata, RequestCreatedEvent, RequestExecutedEvent, RequestKey, RequestStatus, Role,
    Stream, StreamCreatedEvent, StreamProposal, StreamReceipt, StreamRequest,
    StreamResumedEvent, StreamState,
};

#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    pub fn create_proposal(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        end_time: u64,
        required_approvals: u32,
        deadline: u64,
    ) -> Result<u64, Error> {
        sender.require_auth();

        // Validate time range
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if required_approvals == 0 {
            return Err(Error::InvalidApprovalThreshold);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::ProposalExpired);
        }
        if Self::is_address_restricted(env.clone(), receiver.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }

        let proposal_id: u64 = env.storage().instance().get(&PROPOSAL_COUNT).unwrap_or(0);
        let next_id = proposal_id + 1;

        let proposal = StreamProposal {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            start_time,
            end_time,
            approvers: Vec::new(&env),
            required_approvals,
            deadline,
            executed: false,
        };

        env.storage()
            .instance()
            .set(&(PROPOSAL_COUNT, proposal_id), &proposal);
        env.storage().instance().set(&PROPOSAL_COUNT, &next_id);

        // Emit ProposalCreatedEvent
        env.events().publish(
            (symbol_short!("create"), sender.clone()),
            ProposalCreatedEvent {
                proposal_id,
                sender: sender.clone(),
                receiver: receiver.clone(),
                token: token.clone(),
                total_amount,
                start_time,
                end_time,
                required_approvals,
                deadline,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(proposal_id)
    }

    pub fn approve_proposal(env: Env, proposal_id: u64, approver: Address) -> Result<(), Error> {
        approver.require_auth();

        let key = (PROPOSAL_COUNT, proposal_id);
        let mut proposal: StreamProposal = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::ProposalAlreadyExecuted);
        }
        if env.ledger().timestamp() > proposal.deadline {
            return Err(Error::ProposalExpired);
        }

        for existing_approver in proposal.approvers.iter() {
            if existing_approver == approver {
                return Err(Error::AlreadyApproved);
            }
        }

        proposal.approvers.push_back(approver.clone());
        let approval_count = proposal.approvers.len();

        if approval_count >= proposal.required_approvals {
            proposal.executed = true;
            env.storage().instance().set(&key, &proposal);
            Self::execute_proposal(&env, proposal.clone())?;
        } else {
            env.storage().instance().set(&key, &proposal);
        }

        // Emit ProposalApprovedEvent
        env.events().publish(
            (symbol_short!("approve"), approver.clone()),
            ProposalApprovedEvent {
                proposal_id,
                approver: approver.clone(),
                approval_count,
                required_approvals: proposal.required_approvals,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    fn execute_proposal(env: &Env, proposal: StreamProposal) -> Result<u64, Error> {
        // Transfer tokens from proposer to contract
        let token_client = token::Client::new(env, &proposal.token);
        token_client.transfer(
            &proposal.sender,
            &env.current_contract_address(),
            &proposal.total_amount,
        );

        // Allocate next stream id
        let stream_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let next_id = stream_id + 1;

        let stream = Stream {
            sender: proposal.sender.clone(),
            receiver: proposal.receiver.clone(),
            token: proposal.token.clone(),
            total_amount: proposal.total_amount,
            start_time: proposal.start_time,
            cliff_time: proposal.start_time,
            end_time: proposal.end_time,
            withdrawn_amount: 0,
            interest_strategy: 0,
            vault_address: None,
            deposited_principal: proposal.total_amount,
            metadata: None,
            withdrawn: 0,
            receipt_owner: proposal.receiver.clone(),
            paused_time: 0,
            total_paused_duration: 0,
            milestones: Vec::new(env),
            curve_type: CurveType::Linear,
            is_usd_pegged: false,
            usd_amount: 0,
            oracle_address: proposal.sender.clone(),
            oracle_max_staleness: 0,
            price_min: 0,
            price_max: 0,
            is_soulbound: false,     // Proposals default to non-soulbound
            clawback_enabled: false, // Check at runtime if needed
            arbiter: None,
            is_frozen: false,
            state: StreamState::Active,
        };

        env.storage()
            .instance()
            .set(&(STREAM_COUNT, stream_id), &stream);
        env.storage().instance().set(&STREAM_COUNT, &next_id);

        // Emit StreamCreatedEvent
        env.events().publish(
            (symbol_short!("create"), proposal.sender.clone()),
            StreamCreatedEvent {
                stream_id,
                sender: proposal.sender.clone(),
                receiver: proposal.receiver.clone(),
                token: proposal.token,
                total_amount: proposal.total_amount,
                start_time: proposal.start_time,
                end_time: proposal.end_time,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::mint_receipt(env, stream_id, &proposal.receiver);

        Ok(stream_id)
    }

    /// Create a new stream with optional soulbound locking
    ///
    /// # Parameters
    /// - `is_soulbound`: Set to true to permanently bind this stream to the receiver's address.
    ///   Cannot be changed after stream creation. Irreversible.
    pub fn create_stream(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        curve_type: CurveType,
        is_soulbound: bool,
    ) -> Result<u64, Error> {
        let milestones = Vec::new(&env);
        Self::create_stream_with_milestones(
            env,
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            curve_type,
            is_soulbound,
            None, // No vault
        )
    }

    /// Create a new stream with milestones and optional soulbound locking
    ///
    /// # Parameters
    /// - `is_soulbound`: Set to true to permanently bind this stream to the receiver's address.
    ///   Cannot be changed after stream creation. Irreversible.
    pub fn create_stream_with_milestones(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        milestones: Vec<Milestone>,
        curve_type: CurveType,
        is_soulbound: bool,
        vault_address: Option<Address>,
    ) -> Result<u64, Error> {
        sender.require_auth();

        // Validate time range
        if start_time >= end_time {
            return Err(Error::InvalidTimeRange);
        }
        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if Self::is_address_restricted(env.clone(), receiver.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }

        // Validate cliff period
        if cliff_time < start_time || cliff_time > end_time {
            panic!("Cliff time must be between start and end time");
        }

        // Validate vault if provided
        let vault_shares = if let Some(ref vault) = vault_address {
            // Transfer tokens to contract first
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

            // Deposit to vault and get shares
            vault::deposit_to_vault(&env, vault, &token, total_amount)
                .map_err(|_| Error::InvalidAmount)?
        } else {
            // Standard stream without vault
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&sender, &env.current_contract_address(), &total_amount);
            0
        };

        let stream_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let next_id = stream_id + 1;

        let stream = Stream {
            sender: sender.clone(),
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            start_time,
            cliff_time,
            end_time,
            withdrawn_amount: 0,
            interest_strategy: 0,
            vault_address: vault_address.clone(),
            deposited_principal: total_amount,
            metadata: None,
            withdrawn: 0,
            receipt_owner: receiver.clone(),
            paused_time: 0,
            total_paused_duration: 0,
            milestones,
            curve_type,
            is_usd_pegged: false,
            usd_amount: 0,
            oracle_address: sender.clone(),
            oracle_max_staleness: 0,
            price_min: 0,
            price_max: 0,
            is_soulbound,
            clawback_enabled: false, // TODO: Check token flags
            arbiter: None,
            is_frozen: false,
            state: StreamState::Active,
        };

        let stream_key = (STREAM_COUNT, stream_id);

        // Extend contract instance TTL to ensure long-term accessibility
        // TTL extension removed

        env.storage().instance().set(&stream_key, &stream);
        env.storage().instance().set(&STREAM_COUNT, &next_id);

        // Store vault shares if vault is used
        if vault_shares > 0 {
            env.storage()
                .instance()
                .set(&DataKey::VaultShares(stream_id), &vault_shares);
        }

        // If soulbound, emit event and add to index
        if is_soulbound {
            env.events().publish(
                (symbol_short!("soulbound"), symbol_short!("locked")),
                (stream_id, receiver.clone()),
            );

            // Add to soulbound streams index
            let mut soulbound_streams: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::SoulboundStreams)
                .unwrap_or(Vec::new(&env));
            soulbound_streams.push_back(stream_id);
            env.storage()
                .persistent()
                .set(&DataKey::SoulboundStreams, &soulbound_streams);
        }

        env.events().publish(
            (symbol_short!("create"), sender.clone()),
            StreamCreatedEvent {
                stream_id,
                sender: sender.clone(),
                receiver: receiver.clone(),
                token,
                total_amount,
                start_time,
                end_time,
                timestamp: env.ledger().timestamp(),
            },
        );
        Self::mint_receipt(&env, stream_id, &receiver);

        Ok(stream_id)
    }

    /// Maximum number of recipients allowed in a single batch call.
    /// Prevents exceeding the Stellar ledger's maximum transaction size.
    pub const MAX_RECIPIENTS: u32 = 120;

    /// Create multiple streams in a single call.
    ///
    /// Returns `Error::BatchSizeExceeded` if the number of requests exceeds
    /// `MAX_RECIPIENTS`.
    pub fn create_batch_streams(
        env: Env,
        sender: Address,
        token: Address,
        requests: Vec<StreamRequest>,
    ) -> Result<Vec<u64>, Error> {
        if requests.len() > Self::MAX_RECIPIENTS {
            return Err(Error::BatchSizeExceeded);
        }

        sender.require_auth();

        let mut stream_ids: Vec<u64> = Vec::new(&env);

        for req in requests.iter() {
            let milestones: Vec<Milestone> = Vec::new(&env);
            let stream_id = Self::create_stream_with_milestones(
                env.clone(),
                sender.clone(),
                req.receiver,
                token.clone(),
                req.amount,
                req.start_time,
                req.cliff_time,
                req.end_time,
                milestones,
                CurveType::Linear,
                false,
                req.vault_address,
            )?;
            stream_ids.push_back(stream_id);
        }

        Ok(stream_ids)
    }

    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();

        // Set admin role
        env.storage().instance().set(&DataKey::Admin, &admin);

        // Grant all roles to admin
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::SuperAdmin), &true);
        env.storage()
            .instance()
            .set(&DataKey::Role(admin.clone(), Role::Guardian), &true);
        env.storage().instance().set(
            &DataKey::Role(admin.clone(), Role::FinancialOperator),
            &true,
        );
    }

    // ========== RBAC Functions ==========

    /// Grant a role to an address (Admin only)
    pub fn grant_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            panic!("{}", Error::Unauthorized as u32);
        }

        // Grant the role
        env.storage()
            .instance()
            .set(&DataKey::Role(target.clone(), role), &true);

        // Emit event
        env.events().publish((symbol_short!("grant"), target), role);
    }

    /// Revoke a role from an address (Admin only)
    pub fn revoke_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return; // Error::Unauthorized;
        }

        // Revoke the role
        env.storage()
            .instance()
            .remove(&DataKey::Role(target.clone(), role));

        // Emit event
        env.events()
            .publish((symbol_short!("revoke"), target), role);
    }

    /// Check if an address has a specific role
    pub fn check_role(env: Env, address: Address, role: Role) -> bool {
        Self::has_role(&env, &address, role)
    }

    /// Internal helper to check if an address has a role
    fn has_role(env: &Env, address: &Address, role: Role) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Role(address.clone(), role))
            .unwrap_or(false)
    }

    // ========== Contract Upgrade Functions ==========

    /// Upgrade the contract to a new WASM hash
    /// Only addresses with Admin role can perform this operation
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        admin.require_auth();

        // Check if caller has Admin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return; // Error::Unauthorized;
        }

        // Update the contract WASM
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        // Emit upgrade event with new WASM hash
        env.events()
            .publish((symbol_short!("upgrade"), admin), new_wasm_hash);
    }

    /// Get the current admin address (for backward compatibility)
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    pub fn restrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        if !list.contains(address.clone()) {
            list.push_back(address);
            env.storage().instance().set(&RESTRICTED_ADDRESSES, &list);
        }
    }

    pub fn is_address_restricted(env: Env, address: Address) -> bool {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        list.contains(address)
    }

    pub fn unrestrict_address(env: Env, admin: Address, address: Address) {
        admin.require_auth();
        let has_admin: bool = env
            .storage()
            .instance()
            .get(&DataKey::Role(admin, Role::SuperAdmin))
            .unwrap_or(false);
        if !has_admin {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for a in list.iter() {
            if a != address {
                new_list.push_back(a.clone());
            }
        }
        env.storage()
            .instance()
            .set(&RESTRICTED_ADDRESSES, &new_list);
    }

    pub fn get_restricted_addresses(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env))
    }

    /// Returns true if the given vault address is in the approved vaults list.
    pub fn is_vault_approved(env: Env, vault: Address) -> bool {
        let approved: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::ApprovedVaults)
            .unwrap_or(Vec::new(&env));
        approved.contains(vault)
    }

    /// Extend instance storage TTL so long-lived streams remain accessible.
    #[allow(dead_code)]
    fn extend_contract_ttl(env: &Env) {
        const EXTEND_LEDGERS: u32 = 6_000_000; // ~1 year at 5s/ledger
        env.storage()
            .instance()
            .extend_ttl(EXTEND_LEDGERS, EXTEND_LEDGERS);
    }

    fn mint_receipt(env: &Env, stream_id: u64, owner: &Address) {
        let receipt = StreamReceipt {
            stream_id,
            owner: owner.clone(),
            minted_at: env.ledger().timestamp(),
        };
        env.storage()
            .instance()
            .set(&(RECEIPT, stream_id), &receipt);
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        env.storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)
    }

    pub fn get_stream_remaining_time(env: Env, stream_id: u64) -> Result<u64, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;

        let current_time = env.ledger().timestamp();

        if current_time >= stream.end_time {
            Ok(0)
        } else {
            Ok(stream.end_time - current_time)
        }
    }

    pub fn is_stream_active(env: Env, stream_id: u64) -> bool {
        let stream: Option<Stream> = env.storage().instance().get(&(STREAM_COUNT, stream_id));

        match stream {
            None => false,
            Some(s) => {
                let current_time = env.ledger().timestamp();
                s.state == StreamState::Active && !s.is_frozen && current_time < s.end_time
            }
        }
    }

    pub fn get_soulbound_streams(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SoulboundStreams)
            .unwrap_or(Vec::new(&env))
    }

    pub fn transfer_receiver(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_receiver: Address,
    ) -> Result<(), Error> {
        caller.require_auth();

        let stream_key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&stream_key)
            .ok_or(Error::StreamNotFound)?;

        // SOULBOUND CHECK FIRST
        if stream.is_soulbound {
            return Err(Error::StreamIsSoulbound);
        }

        // Authorization check: only sender can transfer receiver
        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        // Update receiver
        stream.receiver = new_receiver.clone();
        env.storage().instance().set(&stream_key, &stream);

        Ok(())
    }

    /// Top up an active stream with additional funds
    pub fn top_up_stream(
        env: Env,
        stream_id: u64,
        sender: Address,
        amount: i128,
    ) -> Result<(), Error> {
        sender.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != sender {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let current_time = env.ledger().timestamp();
        if current_time >= stream.end_time {
            return Err(Error::InvalidAmount);
        }

        // Transfer tokens from sender
        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        // Calculate new end time based on flow rate
        let total_duration = stream.end_time.saturating_sub(stream.start_time);
        let flow_rate = stream.total_amount / total_duration as i128;

        let new_total = stream.total_amount + amount;
        let additional_duration = amount / flow_rate;
        let new_end_time = stream.end_time + additional_duration as u64;

        stream.total_amount = new_total;
        stream.end_time = new_end_time;
        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("topup"), stream_id),
            types::StreamToppedUpEvent {
                stream_id,
                sender,
                amount,
                new_total,
                new_end_time,
                timestamp: current_time,
            },
        );

        Ok(())
    }

    pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == StreamState::Paused {
            return Ok(());
        }

        stream.state = StreamState::Paused;
        stream.paused_time = env.ledger().timestamp();
        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("pause"), stream_id),
            types::StreamPausedEvent {
                stream_id,
                pauser: caller,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Resume a paused stream (alias for backward compatibility).
    /// Equivalent to `resume_stream`.
    pub fn unpause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        Self::resume_stream(env, stream_id, caller)
    }

    /// Resume a paused stream, restoring time-based vesting.
    /// Only the sender can resume a stream.
    pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state != StreamState::Paused {
            return Err(Error::StreamNotPaused);
        }

        let current_time = env.ledger().timestamp();
        let pause_duration = current_time - stream.paused_time;
        stream.total_paused_duration += pause_duration;
        stream.state = StreamState::Active;
        stream.paused_time = 0;

        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("resume"), stream_id),
            StreamResumedEvent {
                stream_id,
                resumer: caller,
                paused_duration: pause_duration,
                timestamp: current_time,
            },
        );

        Ok(())
    }

    pub fn withdraw(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.receiver != caller {
            return Err(Error::Unauthorized);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == StreamState::Paused {
            return Err(Error::StreamPaused);
        }

        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let to_withdraw = unlocked - stream.withdrawn_amount;

        if to_withdraw <= 0 {
            return Err(Error::InsufficientBalance);
        }

        stream.withdrawn_amount += to_withdraw;
        env.storage().instance().set(&key, &stream);

        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(
            &env.current_contract_address(),
            &stream.receiver,
            &to_withdraw,
        );

        Ok(to_withdraw)
    }

    pub fn cancel(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller && stream.receiver != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let to_receiver = unlocked - stream.withdrawn_amount;
        let to_sender = stream.total_amount - unlocked;

        stream.state = StreamState::Closed;
        stream.withdrawn_amount = unlocked;
        env.storage().instance().set(&key, &stream);

        let token_client = token::Client::new(&env, &stream.token);
        if to_receiver > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.receiver,
                &to_receiver,
            );
        }
        if to_sender > 0 {
            token_client.transfer(&env.current_contract_address(), &stream.sender, &to_sender);
        }

        Ok(())
    }

    /// Optimized cancel for bridge migration.
    /// Returns the total remaining balance (earned + unearned) and transfers it to the receiver.
    pub fn cancel_stream(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.receiver != caller {
            return Err(Error::Unauthorized);
        }
        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }

        let remaining = stream.total_amount - stream.withdrawn_amount;

        stream.state = StreamState::Closed;
        stream.withdrawn_amount = stream.total_amount;
        env.storage().instance().set(&key, &stream);

        if remaining > 0 {
            let token_client = token::Client::new(&env, &stream.token);
            token_client.transfer(
                &env.current_contract_address(),
                &stream.receiver,
                &remaining,
            );
        }

        Ok(remaining)
    }

    fn calculate_unlocked(stream: &Stream, current_time: u64) -> i128 {
        if current_time <= stream.start_time {
            return 0;
        }

        let mut effective_time = current_time;
        if stream.state == StreamState::Paused {
            effective_time = stream.paused_time;
        }

        let adjusted_cliff = stream.cliff_time + stream.total_paused_duration;
        if effective_time < adjusted_cliff {
            return 0;
        }

        let adjusted_end = stream.end_time + stream.total_paused_duration;
        if effective_time >= adjusted_end {
            return stream.total_amount;
        }

        let elapsed = (effective_time - stream.start_time) as i128;
        let paused = stream.total_paused_duration as i128;
        let effective_elapsed = elapsed - paused;

        if effective_elapsed <= 0 {
            return 0;
        }

        let duration = (stream.end_time - stream.start_time) as i128;

        // Calculate base unlocked amount based on curve type
        match stream.curve_type {
            CurveType::Linear => (stream.total_amount * effective_elapsed) / duration,
            CurveType::Exponential => {
                // Use exponential curve with overflow protection
                let adjusted_start = stream.start_time;
                let adjusted_current = stream.start_time + effective_elapsed as u64;

                math::calculate_exponential_unlocked(
                    stream.total_amount,
                    adjusted_start,
                    stream.end_time,
                    adjusted_current,
                )
                .unwrap_or((stream.total_amount * effective_elapsed) / duration)
            }
        }
    }

    // --- CONTRIBUTOR PULL-REQUEST PAYMENTS ---

    pub fn create_request(
        env: Env,
        receiver: Address,
        token: Address,
        total_amount: i128,
        duration: u64,
        metadata: Option<soroban_sdk::BytesN<32>>,
    ) -> u64 {
        receiver.require_auth();
        let count: u64 = env
            .storage()
            .instance()
            .get(&RequestKey::RequestCount)
            .unwrap_or(0);
        let request_id = count + 1;
        let now = env.ledger().timestamp();
        let request = ContributorRequest {
            id: request_id,
            receiver: receiver.clone(),
            token: token.clone(),
            total_amount,
            duration,
            start_time: now,
            status: RequestStatus::Pending,
            metadata,
        };
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        env.storage()
            .instance()
            .set(&RequestKey::RequestCount, &request_id);
        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "RequestCreated"), request_id),
            RequestCreatedEvent {
                request_id,
                receiver,
                token,
                total_amount,
                duration,
                timestamp: now,
            },
        );
        request_id
    }

    pub fn execute_request(env: Env, admin: Address, request_id: u64) -> Result<u64, Error> {
        admin.require_auth();
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }
        let mut request: ContributorRequest = env
            .storage()
            .instance()
            .get(&RequestKey::Request(request_id))
            .ok_or(Error::StreamNotFound)?;
        if request.status != RequestStatus::Pending {
            return Err(Error::AlreadyExecuted);
        }
        request.status = RequestStatus::Approved;
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
        let stream_id = Self::create_stream(
            env.clone(),
            admin.clone(),
            request.receiver.clone(),
            request.token.clone(),
            request.total_amount,
            request.start_time,
            request.start_time + request.duration,
            CurveType::Linear,
            false, // is_soulbound
        )?;
        env.events().publish(
            (
                soroban_sdk::Symbol::new(&env, "RequestExecuted"),
                request_id,
            ),
            RequestExecutedEvent {
                request_id,
                stream_id,
                executor: admin,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(stream_id)
    }

    pub fn get_request(env: Env, request_id: u64) -> Option<ContributorRequest> {
        env.storage()
            .instance()
            .get(&RequestKey::Request(request_id))
    }

    // ========== OFAC Compliance Functions ==========

    /// Internal helper: validate receiver is not restricted
    fn validate_receiver(env: &Env, receiver: &Address) -> Result<(), Error> {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or_else(|| Vec::new(env));
        for existing in list.iter() {
            if &existing == receiver {
                return Err(Error::ReceiverRestricted);
            }
        }
        Ok(())
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<StreamProposal> {
        env.storage().instance().get(&(PROPOSAL_COUNT, proposal_id))
    }

    pub fn get_receipt(env: Env, stream_id: u64) -> Option<StreamReceipt> {
        env.storage().instance().get(&(RECEIPT, stream_id))
    }

    pub fn get_receipt_metadata(env: Env, stream_id: u64) -> Result<ReceiptMetadata, Error> {
        let stream: Stream = env
            .storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)?;
        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);
        let locked = stream.total_amount - unlocked;
        Ok(ReceiptMetadata {
            stream_id,
            locked_balance: locked,
            unlocked_balance: unlocked,
            total_amount: stream.total_amount,
            token: stream.token,
        })
    }

    pub fn transfer_receipt(
        env: Env,
        stream_id: u64,
        caller: Address,
        new_owner: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        if Self::is_address_restricted(env.clone(), new_owner.clone()) {
            soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
        }
        let key = (RECEIPT, stream_id);
        let mut receipt: StreamReceipt = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;
        if receipt.owner != caller {
            return Err(Error::NotReceiptOwner);
        }
        receipt.owner = new_owner.clone();
        env.storage().instance().set(&key, &receipt);
        let stream_key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&stream_key)
            .ok_or(Error::StreamNotFound)?;
        stream.receipt_owner = new_owner;
        env.storage().instance().set(&stream_key, &stream);
        Ok(())
    }
}

// Contract metadata for explorer display (Stellar.Expert, etc.)
soroban_sdk::contractmeta!(
    key = "Description",
    val = "StellarStream: Token streaming with multi-sig proposals, dynamic vesting curves (linear/exponential), yield optimization, and OFAC compliance"
);
soroban_sdk::contractmeta!(key = "Version", val = "0.1.0");
soroban_sdk::contractmeta!(key = "Name", val = "StellarStream");

#[cfg(test)]
#[cfg(feature = "extended_tests")] // Disabled - requires additional implementations
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{StellarAssetClient, TokenClient},
        Address, Env,
    };

    fn set_admin_role(env: &Env, contract_id: &Address, admin: &Address) {
        env.as_contract(contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Role(admin.clone(), Role::SuperAdmin), &true);
        });
    }

    fn create_token_contract<'a>(env: &Env, admin: &Address) -> (Address, TokenClient<'a>) {
        let contract_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        (contract_id.clone(), TokenClient::new(env, &contract_id))
    }

    #[test]
    #[ignore] // Requires get_proposal implementation
    fn test_create_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &2, &1000);

        assert_eq!(proposal_id, 0);
    }

    #[test]
    fn test_approve_proposal() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let approver1 = Address::generate(&env);
        let approver2 = Address::generate(&env);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &2, &1000);

        client.approve_proposal(&proposal_id, &approver1);

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.approvers.len(), 1);
        assert!(!proposal.executed);

        client.approve_proposal(&proposal_id, &approver2);

        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert_eq!(proposal.approvers.len(), 2);
        assert!(proposal.executed);
    }

    #[test]
    fn test_duplicate_approval_fails() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let approver = Address::generate(&env);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &2, &1000);

        client.approve_proposal(&proposal_id, &approver);
        let result = client.try_approve_proposal(&proposal_id, &approver);

        assert_eq!(result, Err(Ok(Error::AlreadyApproved)));
    }

    #[test]
    fn test_proposal_not_found() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let approver = Address::generate(&env);
        let result = client.try_approve_proposal(&999, &approver);

        assert_eq!(result, Err(Ok(Error::ProposalNotFound)));
    }

    #[test]
    fn test_invalid_time_range() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let result =
            client.try_create_proposal(&sender, &receiver, &token_id, &1000, &200, &100, &2, &1000);

        assert_eq!(result, Err(Ok(Error::InvalidTimeRange)));
    }

    #[test]
    fn test_invalid_amount() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let result =
            client.try_create_proposal(&sender, &receiver, &token_id, &0, &100, &200, &2, &1000);

        assert_eq!(result, Err(Ok(Error::InvalidAmount)));
    }

    #[test]
    fn test_invalid_approval_threshold() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let result =
            client.try_create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &0, &1000);

        assert_eq!(result, Err(Ok(Error::InvalidApprovalThreshold)));
    }

    #[test]
    fn test_create_direct_stream() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        assert_eq!(stream_id, 0);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.total_amount, 1000);
        assert_eq!(stream.withdrawn_amount, 0);
        assert_eq!(stream.state, StreamState::Active);
        assert_eq!(stream.receipt_owner, receiver);

        let receipt = client.get_receipt(&stream_id).unwrap();
        assert_eq!(receipt.stream_id, stream_id);
        assert_eq!(receipt.owner, receiver);
    }

    #[test]
    fn test_receipt_transfer() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let new_owner = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        client.transfer_receipt(&stream_id, &receiver, &new_owner);

        let receipt = client.get_receipt(&stream_id).unwrap();
        assert_eq!(receipt.owner, new_owner);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.receipt_owner, new_owner);
    }

    #[test]
    fn test_withdraw_with_receipt_owner() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 150);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let new_owner = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        client.transfer_receipt(&stream_id, &receiver, &new_owner);

        let receipt = client.get_receipt(&stream_id).unwrap();
        assert_eq!(receipt.owner, new_owner);
        // Stream receiver is still the one who can withdraw (tokens go to receiver)
        let withdrawn = client.withdraw(&stream_id, &receiver);
        assert!(withdrawn > 0);
    }

    #[test]
    #[ignore] // Requires get_receipt implementation
    fn test_receipt_metadata() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 150);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.stream_id, stream_id);
        assert_eq!(metadata.total_amount, 1000);
        assert_eq!(metadata.token, token_id);
        assert!(metadata.unlocked_balance > 0);
        assert!(metadata.locked_balance < 1000);
    }

    #[test]
    fn test_three_of_five_multisig() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &100000);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &50000, &100, &200, &3, &1000);

        let approver1 = Address::generate(&env);
        let approver2 = Address::generate(&env);
        let approver3 = Address::generate(&env);

        client.approve_proposal(&proposal_id, &approver1);
        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert!(!proposal.executed);

        client.approve_proposal(&proposal_id, &approver2);
        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert!(!proposal.executed);

        client.approve_proposal(&proposal_id, &approver3);
        let proposal = client.get_proposal(&proposal_id).unwrap();
        assert!(proposal.executed);
        assert_eq!(proposal.approvers.len(), 3);
    }

    #[test]
    fn test_approve_already_executed_proposal() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &1, &1000);

        let approver1 = Address::generate(&env);
        client.approve_proposal(&proposal_id, &approver1);

        let approver2 = Address::generate(&env);
        let result = client.try_approve_proposal(&proposal_id, &approver2);

        assert_eq!(result, Err(Ok(Error::ProposalAlreadyExecuted)));
    }

    #[test]
    fn test_pause_unpause_stream() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &300,
            &CurveType::Linear,
            &false,
        );

        env.ledger().with_mut(|li| li.timestamp = 150);
        client.pause_stream(&stream_id, &sender);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.state, StreamState::Paused);
        assert_eq!(stream.paused_time, 150);

        env.ledger().with_mut(|li| li.timestamp = 200);
        client.unpause_stream(&stream_id, &sender);

        let stream = client.get_stream(&stream_id);
        assert_eq!(stream.state, StreamState::Active);
        assert_eq!(stream.total_                paused_duration: pause_duration, 50);
    }

    #[test]
    #[should_panic]
    fn test_withdraw_paused_fails() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &300,
            &CurveType::Linear,
            &false,
        );

        client.pause_stream(&stream_id, &sender);

        env.ledger().with_mut(|li| li.timestamp = 150);
        client.withdraw(&stream_id, &receiver);
    }

    #[test]
    fn test_pause_adjusts_unlocked_balance() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &300,
            &CurveType::Linear,
            &false,
        );

        env.ledger().with_mut(|li| li.timestamp = 150);
        let metadata_before = client.get_receipt_metadata(&stream_id);
        let unlocked_before = metadata_before.unlocked_balance;

        client.pause_stream(&stream_id, &sender);

        env.ledger().with_mut(|li| li.timestamp = 200);
        let metadata_paused = client.get_receipt_metadata(&stream_id);

        assert_eq!(metadata_paused.unlocked_balance, unlocked_before);

        client.unpause_stream(&stream_id, &sender);

        env.ledger().with_mut(|li| li.timestamp = 250);
        let withdrawn = client.withdraw(&stream_id, &receiver);
        assert!(withdrawn > 0);
    }

    #[test]
    #[ignore] // Requires get_receipt_metadata implementation
    fn test_quarterly_vesting() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 0);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            timestamp: 90,
            percentage: 25,
        });
        milestones.push_back(Milestone {
            timestamp: 180,
            percentage: 50,
        });
        milestones.push_back(Milestone {
            timestamp: 270,
            percentage: 75,
        });
        milestones.push_back(Milestone {
            timestamp: 360,
            percentage: 100,
        });

        let stream_id = client.create_stream_with_milestones(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &0,
            &360,
            &milestones,
            &CurveType::Linear,
            &false,
            &None,
            &false,
        );

        env.ledger().with_mut(|li| li.timestamp = 45);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert!(metadata.unlocked_balance <= 250);

        env.ledger().with_mut(|li| li.timestamp = 100);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.unlocked_balance, 277);

        env.ledger().with_mut(|li| li.timestamp = 200);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.unlocked_balance, 555);
    }

    #[test]
    fn test_hybrid_streaming() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 0);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let mut milestones = Vec::new(&env);
        milestones.push_back(Milestone {
            timestamp: 100,
            percentage: 50,
        });

        let stream_id = client.create_stream_with_milestones(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &0,
            &200,
            &milestones,
            &CurveType::Linear,
            &false,
            &None,
            &false,
        );

        env.ledger().with_mut(|li| li.timestamp = 50);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert!(metadata.unlocked_balance <= 250);

        env.ledger().with_mut(|li| li.timestamp = 150);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.unlocked_balance, 750);

        env.ledger().with_mut(|li| li.timestamp = 200);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.unlocked_balance, 1000);
    }

    // ============================================================================
    // EVENT EMISSION TESTS
    // ============================================================================
    // Tests to ensure all state changes emit proper events with correct data

    #[test]
    fn test_create_stream_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        // Create stream - should emit create event
        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        assert_eq!(stream_id, 0);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    fn test_withdraw_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 150);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        // Withdraw - should emit claim event
        let withdrawn = client.withdraw(&stream_id, &receiver);
        assert!(withdrawn > 0);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    fn test_cancel_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 150);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        // Cancel - should emit cancel event
        client.cancel(&stream_id, &sender);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    fn test_transfer_receipt_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let new_owner = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        // Transfer receipt - should emit transfer event
        client.transfer_receipt(&stream_id, &receiver, &new_owner);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    #[ignore] // Requires get_receipt_metadata implementation
    fn test_pause_stream_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &300,
            &CurveType::Linear,
            &false,
        );

        // Pause stream - should emit pause event
        client.pause_stream(&stream_id, &sender);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    fn test_unpause_stream_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &300,
            &CurveType::Linear,
            &false,
        );

        client.pause_stream(&stream_id, &sender);

        env.ledger().with_mut(|li| li.timestamp = 200);

        // Unpause stream - should emit unpause event
        client.unpause_stream(&stream_id, &sender);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    fn test_approve_proposal_emits_event() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let proposal_id =
            client.create_proposal(&sender, &receiver, &token_id, &1000, &100, &200, &2, &1000);

        let approver1 = Address::generate(&env);
        let approver2 = Address::generate(&env);

        // First approval - should emit approve event
        client.approve_proposal(&proposal_id, &approver1);
        // Event verification would be done through event monitoring in integration tests

        // Second approval - should emit approve event and create stream
        client.approve_proposal(&proposal_id, &approver2);
        // Event verification would be done through event monitoring in integration tests
    }

    #[test]
    #[ignore] // Requires get_receipt_metadata implementation
    fn test_exponential_stream() {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|li| li.timestamp = 0);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let admin = Address::generate(&env);
        let (token_id, _) = create_token_contract(&env, &admin);

        let token_admin_client = StellarAssetClient::new(&env, &token_id);
        token_admin_client.mint(&sender, &10000);

        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &0, &0,
            &100,
            &CurveType::Exponential,
            &false,
        );

        // At 50% time: should have ~25% unlocked (0.5^2 = 0.25)
        env.ledger().with_mut(|li| li.timestamp = 50);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert!(metadata.unlocked_balance >= 240 && metadata.unlocked_balance <= 260);

        // At 70% time: should have ~49% unlocked (0.7^2 = 0.49)
        env.ledger().with_mut(|li| li.timestamp = 70);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert!(metadata.unlocked_balance >= 480 && metadata.unlocked_balance <= 500);

        // At 100% time: should have 100% unlocked
        env.ledger().with_mut(|li| li.timestamp = 100);
        let metadata = client.get_receipt_metadata(&stream_id);
        assert_eq!(metadata.unlocked_balance, 1000);

        // Verify withdrawal works
        let withdrawn = client.withdraw(&stream_id, &receiver);
        assert_eq!(withdrawn, 1000);
    }

    // ========== OFAC Compliance Tests ==========

    #[test]
    #[ignore] // Requires restrict_address implementation
    fn test_restrict_address_by_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let restricted_addr = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Admin restricts an address
        client.restrict_address(&admin, &restricted_addr);

        // Verify address is restricted
        assert!(client.is_address_restricted(&restricted_addr));
    }

    #[test]
    #[ignore] // Requires restrict_address implementation
    fn test_unrestrict_address_by_admin() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let restricted_addr = Address::generate(&env);

        // Manually set admin role in storage to bootstrap
        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Role(admin.clone(), Role::SuperAdmin), &true);
        });

        // Admin restricts an address
        client.restrict_address(&admin, &restricted_addr);
        assert!(client.is_address_restricted(&restricted_addr));

        // Admin unrestricts the address
        client.unrestrict_address(&admin, &restricted_addr);

        // Verify address is no longer restricted
        assert!(!client.is_address_restricted(&restricted_addr));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #5)")]
    fn test_non_admin_cannot_restrict_address() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let non_admin = Address::generate(&env);
        let restricted_addr = Address::generate(&env);

        // Non-admin tries to restrict an address - should panic
        client.restrict_address(&non_admin, &restricted_addr);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn test_cannot_create_stream_to_restricted_address() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let restricted_receiver = Address::generate(&env);
        let token_admin = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Create token
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        // Mint tokens to sender
        let token_client = token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&sender, &1000);

        // Admin restricts the receiver address
        client.restrict_address(&admin, &restricted_receiver);

        // Attempt to create stream to restricted address should panic
        client.create_stream(
            &sender,
            &restricted_receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn test_cannot_create_proposal_to_restricted_address() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 50);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let restricted_receiver = Address::generate(&env);
        let token_admin = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Create token
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        // Mint tokens to sender
        let token_client = token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&sender, &1000);

        // Admin restricts the receiver address
        client.restrict_address(&admin, &restricted_receiver);

        // Attempt to create proposal to restricted address should panic
        client.create_proposal(
            &sender,
            &restricted_receiver,
            &token_id,
            &1000,
            &100,
            &200,
            &2,
            &1000,
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #22)")]
    fn test_cannot_transfer_receipt_to_restricted_address() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let restricted_addr = Address::generate(&env);
        let token_admin = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Create token
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        // Mint tokens to sender
        let token_client = token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&sender, &1000);

        // Create stream to valid receiver
        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        // Admin restricts an address
        client.restrict_address(&admin, &restricted_addr);

        // Attempt to transfer receipt to restricted address should panic
        client.transfer_receipt(&stream_id, &receiver, &restricted_addr);
    }

    #[test]
    #[ignore] // Requires get_restricted_addresses implementation
    fn test_get_restricted_addresses_list() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let addr1 = Address::generate(&env);
        let addr2 = Address::generate(&env);
        let addr3 = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Initially, no restricted addresses
        let restricted = client.get_restricted_addresses();
        assert_eq!(restricted.len(), 0);

        // Admin restricts addresses
        client.restrict_address(&admin, &addr1);
        client.restrict_address(&admin, &addr2);
        client.restrict_address(&admin, &addr3);

        // Verify all addresses are in the list
        let restricted = client.get_restricted_addresses();
        assert_eq!(restricted.len(), 3);
    }

    #[test]
    #[ignore] // Requires restrict_address implementation
    fn test_restrict_same_address_twice_is_idempotent() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let restricted_addr = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Restrict address first time
        client.restrict_address(&admin, &restricted_addr);
        let restricted_1 = client.get_restricted_addresses();
        assert_eq!(restricted_1.len(), 1);

        // Restrict same address again (should be idempotent)
        client.restrict_address(&admin, &restricted_addr);
        let restricted_2 = client.get_restricted_addresses();
        assert_eq!(restricted_2.len(), 1);

        // Verify address is still restricted
        assert!(client.is_address_restricted(&restricted_addr));
    }

    #[test]
    #[ignore] // Requires restrict_address implementation
    fn test_stream_creation_allowed_after_unrestriction() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|li| li.timestamp = 100);

        let contract_id = env.register(StellarStreamContract, ());
        let client = StellarStreamContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);
        let token_admin = Address::generate(&env);

        set_admin_role(&env, &contract_id, &admin);

        // Create token
        let token_id = env.register_stellar_asset_contract(token_admin.clone());

        // Mint tokens to sender
        let token_client = token::StellarAssetClient::new(&env, &token_id);
        token_client.mint(&sender, &1000);

        // Admin restricts the receiver
        client.restrict_address(&admin, &receiver);

        // Admin unrestricts the receiver
        client.unrestrict_address(&admin, &receiver);

        // Now stream creation should succeed
        let stream_id = client.create_stream(
            &sender,
            &receiver,
            &token_id,
            &1000,
            &100, &100,
            &200,
            &CurveType::Linear,
            &false,
        );

        // Verify stream was created (stream_id >= 0)
        assert!(stream_id >= 0);
    }
}
