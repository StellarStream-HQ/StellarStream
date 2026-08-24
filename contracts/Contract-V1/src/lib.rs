#![no_std]
#![allow(clippy::too_many_arguments)]

pub mod errors;
mod flash_loan;
pub mod interest;
pub mod math;
mod oracle;
mod rbac;
mod storage;
pub mod types;
mod upgrade;
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
#[cfg(test)]
mod dispute_test;
#[cfg(test)]
mod soulbound_test;
#[cfg(test)]
mod topup_test;

// Advanced-feature integration test suites (issue #1480).
// These exercise RBAC, multi-sig proposals, vault integration, OFAC
// compliance, and multi-step cross-feature workflows against the current
// contract implementation.
#[cfg(test)]
mod rbac_test;
#[cfg(test)]
mod proposal_test;
#[cfg(test)]
mod vault_test;
#[cfg(test)]
mod compliance_test;
#[cfg(test)]
mod advanced_test;

#[cfg(all(test, feature = "voting_tests"))]
mod voting_test;

#[cfg(test)]
mod bench_test;

// #[cfg(test)]
// mod interest_test;

// #[cfg(test)]
// mod mock_vault;

// #[cfg(test)]
// mod vault_integration_test;

#[cfg(test)]
mod ttl_stress_test;

#[cfg(test)]
mod upgrade_test;

#[cfg(test)]
mod test;

use errors::Error;
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Map, String, Vec};
use storage::{
    ARBITRATORS, DISPUTE, DISPUTE_COUNT, PROPOSAL_COUNT, RECEIPT, RESTRICTED_ADDRESSES,
    STREAM_COUNT,
};
use types::{
    ContributorRequest, CurveType, DataKey, Dispute, DisputeRaisedEvent, DisputeResolution,
    DisputeResolvedEvent, DisputeVotedEvent, Milestone, ProposalApprovedEvent, ProposalCreatedEvent,
    ReceiptMetadata, RequestCreatedEvent, RequestExecutedEvent, RequestKey, RequestStatus, Role,
    Stream, StreamCreatedEvent, StreamOptions, StreamProposal, StreamReceipt, StreamRequest,
    StreamResumedEvent, StreamState,
};

/// The StellarStream token-streaming contract.
///
/// Implements linear/cliff/exponential vesting streams funded directly or via
/// multi-sig [`StreamProposal`]s, contributor-initiated [`ContributorRequest`]s,
/// role-based access control ([`Role`]), OFAC-style address restrictions, and
/// optional lending-vault integration for idle principal.
#[contract]
pub struct StellarStreamContract;

#[contractimpl]
impl StellarStreamContract {
    /// Creates a multi-signature proposal to fund a stream, requiring `required_approvals`
    /// approvals (via [`approve_proposal`](StellarStreamContract::approve_proposal)) before the stream is
    /// actually created and funded.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `sender` - Address that will fund the stream once the proposal is approved
    /// * `receiver` - Address that will receive the resulting stream
    /// * `token` - Token contract address to be streamed
    /// * `total_amount` - Total tokens to stream; must be greater than zero
    /// * `start_time` - Unix timestamp when the resulting stream's vesting begins
    /// * `end_time` - Unix timestamp when the resulting stream's vesting completes; must
    ///   be strictly after `start_time`
    /// * `required_approvals` - Number of approvals required to execute the proposal;
    ///   must be greater than zero
    /// * `deadline` - Unix timestamp after which the proposal can no longer be approved
    ///
    /// # Returns
    /// The newly created proposal's ID.
    ///
    /// # Errors
    /// * [`Error::InvalidTimeRange`] - `start_time >= end_time`
    /// * [`Error::InvalidAmount`] - `total_amount <= 0`
    /// * [`Error::InvalidApprovalThreshold`] - `required_approvals == 0`
    /// * [`Error::ProposalExpired`] - `deadline` is not in the future
    ///
    /// # Panics
    /// Panics with [`Error::AddressRestricted`] if `receiver` is on the restricted list.
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

    /// Approves a pending stream proposal; once enough approvals are collected, the
    /// stream is automatically created and funded.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `proposal_id` - ID of the proposal to approve
    /// * `approver` - Address casting the approval; must authenticate this call
    ///
    /// # Returns
    /// `Ok(())` whether or not this approval was the one that triggered execution.
    ///
    /// # Errors
    /// * [`Error::ProposalNotFound`] - No proposal exists for `proposal_id`
    /// * [`Error::ProposalAlreadyExecuted`] - The proposal has already been executed
    /// * [`Error::ProposalExpired`] - The current time is past the proposal's deadline
    /// * [`Error::AlreadyApproved`] - `approver` has already approved this proposal
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

    /// Creates and immediately funds a new token stream from `sender` to `receiver`.
    ///
    /// Transfers `total_amount` of `token` from `sender` to the contract, mints an
    /// ownership receipt for `receiver`, and emits a [`StreamCreatedEvent`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `sender` - Address funding the stream; must authenticate this call
    /// * `receiver` - Address that will receive the streamed tokens
    /// * `token` - Token contract address (SAC-compatible)
    /// * `total_amount` - Total tokens to stream; must be greater than zero
    /// * `start_time` - Unix timestamp when streaming begins
    /// * `cliff_time` - Unix timestamp before which nothing unlocks; must be between
    ///   `start_time` and `end_time`
    /// * `end_time` - Unix timestamp when streaming completes; must be strictly after
    ///   `start_time`
    /// * `curve_type` - Vesting curve to apply ([`CurveType::Linear`] or
    ///   [`CurveType::Exponential`])
    /// * `is_soulbound` - If `true`, permanently binds this stream's receipt to
    ///   `receiver`'s address; the receipt can never be transferred afterward. This
    ///   cannot be changed after creation.
    ///
    /// # Returns
    /// The newly created stream's ID.
    ///
    /// # Errors
    /// * [`Error::InvalidTimeRange`] - `start_time >= end_time`
    /// * [`Error::InvalidAmount`] - `total_amount <= 0`
    ///
    /// # Panics
    /// * Panics if `cliff_time` is not between `start_time` and `end_time`.
    /// * Panics with [`Error::AddressRestricted`] if `receiver` is on the restricted list.
    ///
    /// # Examples
    /// ```ignore
    /// let stream_id = client.create_stream(
    ///     &sender,
    ///     &receiver,
    ///     &token,
    ///     &1_000_000,
    ///     &start,
    ///     &start, // no cliff
    ///     &end,
    ///     &CurveType::Linear,
    ///     &false,
    /// );
    /// ```
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
        sender.require_auth();

        let milestones = Vec::new(&env);
        let options = StreamOptions {
            curve_type,
            is_soulbound,
            vault_address: None,
        };
        Self::create_stream_internal(
            env,
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            options,
        )
    }

    /// Creates and funds a new stream with a milestone-based unlock schedule, and
    /// optionally deposits its principal into a yield-bearing vault.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `sender` - Address funding the stream; must authenticate this call
    /// * `receiver` - Address that will receive the streamed tokens
    /// * `token` - Token contract address (SAC-compatible)
    /// * `total_amount` - Total tokens to stream; must be greater than zero
    /// * `start_time` - Unix timestamp when streaming begins
    /// * `cliff_time` - Unix timestamp before which nothing unlocks; must be between
    ///   `start_time` and `end_time`
    /// * `end_time` - Unix timestamp when streaming completes; must be strictly after
    ///   `start_time`
    /// * `milestones` - Optional milestone unlock schedule
    /// * `options` - Bundled optional configuration (curve type, soulbound flag, and
    ///   optional yield-bearing vault address). Bundled into a single struct so this
    ///   entry point stays within Soroban's maximum contract function parameter count.
    ///
    /// # Returns
    /// The newly created stream's ID.
    ///
    /// # Errors
    /// * [`Error::InvalidTimeRange`] - `start_time >= end_time`
    /// * [`Error::InvalidAmount`] - `total_amount <= 0`
    /// * [`Error::InvalidAmount`] - the vault deposit failed (when `options.vault_address`
    ///   is set)
    ///
    /// # Panics
    /// * Panics if `cliff_time` is not between `start_time` and `end_time`.
    /// * Panics with [`Error::AddressRestricted`] if `receiver` is on the restricted list.
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
        options: StreamOptions,
    ) -> Result<u64, Error> {
        sender.require_auth();
        Self::create_stream_internal(
            env,
            sender,
            receiver,
            token,
            total_amount,
            start_time,
            cliff_time,
            end_time,
            milestones,
            options,
        )
    }

    /// Internal, non-authorizing stream creation shared by the public entry
    /// points. Callers must authenticate `sender` exactly once per invocation
    /// to avoid duplicate-authorization traps.
    fn create_stream_internal(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        total_amount: i128,
        start_time: u64,
        cliff_time: u64,
        end_time: u64,
        milestones: Vec<Milestone>,
        options: StreamOptions,
    ) -> Result<u64, Error> {
        let StreamOptions {
            curve_type,
            is_soulbound,
            vault_address,
        } = options;

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

        Self::update_token_tvl(&env, token.clone(), total_amount);

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

    /// Creates multiple linear streams in a single call, one per entry in `requests`.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `sender` - Address funding all resulting streams; must authenticate this call
    /// * `token` - Token contract address (SAC-compatible) used for every stream
    /// * `requests` - Per-recipient stream parameters; at most [`StellarStreamContract::MAX_RECIPIENTS`]
    ///
    /// # Returns
    /// The newly created stream IDs, in the same order as `requests`.
    ///
    /// # Errors
    /// * [`Error::BatchSizeExceeded`] - `requests.len() > MAX_RECIPIENTS`
    /// * Propagates any error from the underlying per-stream creation (e.g.
    ///   [`Error::InvalidTimeRange`], [`Error::InvalidAmount`]).
    /// This is not a loop over [`Self::create_stream`]: everything that would
    /// otherwise be repeated per item is hoisted out of the loop so the
    /// marginal cost of each extra stream in the batch is just its own
    /// storage write, receipt, and event.
    ///
    /// - **Single authorization check.** `sender.require_auth()` runs once for
    ///   the whole batch instead of once per stream.
    /// - **Fail-fast validation.** Every request (time range, amount, cliff
    ///   bounds, restricted receiver) is validated in a first pass, before any
    ///   storage write or token transfer happens. An invalid item anywhere in
    ///   the batch is rejected without having paid for the transfers or writes
    ///   of the items ahead of it.
    /// - **Cached restricted-address list.** The compliance list is read from
    ///   storage once and reused for every request instead of once per item.
    /// - **Cached stream counter.** `STREAM_COUNT` is read once, advanced in
    ///   memory for the whole batch, and written back once instead of on every
    ///   iteration.
    /// - **Bulk token transfer.** Every request's principal (vault-bound or
    ///   not) is summed and moved from `sender` to the contract in a single
    ///   token transfer instead of one transfer per stream. A per-item
    ///   transfer from the contract into its vault still happens for
    ///   vault-bound requests, since each may target a different vault.
    ///
    /// The `Stream` record and NFT-style receipt for each requested stream
    /// still require one storage write apiece — each occupies its own ledger
    /// entry and can't be merged — so per-item cost does not go to zero, but
    /// every cost that was previously duplicated across the batch is now paid
    /// exactly once.
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

        if requests.is_empty() {
            return Ok(Vec::new(&env));
        }

        // Fail-fast validation pass: every request is checked, and the batch
        // total is computed, before anything is written or transferred.
        let restricted = Self::restricted_addresses(&env);
        let mut total_amount: i128 = 0;
        for req in requests.iter() {
            if req.start_time >= req.end_time {
                return Err(Error::InvalidTimeRange);
            }
            if req.amount <= 0 {
                return Err(Error::InvalidAmount);
            }
            if req.cliff_time < req.start_time || req.cliff_time > req.end_time {
                panic!("Cliff time must be between start and end time");
            }
            if restricted.contains(&req.receiver) {
                soroban_sdk::panic_with_error!(&env, Error::AddressRestricted);
            }
            total_amount += req.amount;
        }

        // One transfer covers every request's principal instead of one per item.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        let mut next_id: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let mut stream_ids: Vec<u64> = Vec::new(&env);

        for req in requests.iter() {
            let stream_id = next_id;
            next_id += 1;

            // Contract already holds the funds from the bulk transfer above;
            // vault-bound requests still need their own contract-to-vault leg.
            let vault_shares = if let Some(ref vault) = req.vault_address {
                vault::deposit_to_vault(&env, vault, &token, req.amount)
                    .map_err(|_| Error::InvalidAmount)?
            } else {
                0
            };

            let stream = Stream {
                sender: sender.clone(),
                receiver: req.receiver.clone(),
                token: token.clone(),
                total_amount: req.amount,
                start_time: req.start_time,
                cliff_time: req.cliff_time,
                end_time: req.end_time,
                withdrawn_amount: 0,
                interest_strategy: 0,
                vault_address: req.vault_address.clone(),
                deposited_principal: req.amount,
                metadata: None,
                withdrawn: 0,
                receipt_owner: req.receiver.clone(),
                paused_time: 0,
                total_paused_duration: 0,
                milestones: Vec::new(&env),
                curve_type: CurveType::Linear,
                is_usd_pegged: false,
                usd_amount: 0,
                oracle_address: sender.clone(),
                oracle_max_staleness: 0,
                price_min: 0,
                price_max: 0,
                is_soulbound: false,
                clawback_enabled: false,
                arbiter: None,
                is_frozen: false,
                state: StreamState::Active,
            };

            env.storage()
                .instance()
                .set(&(STREAM_COUNT, stream_id), &stream);

            if vault_shares > 0 {
                env.storage()
                    .instance()
                    .set(&DataKey::VaultShares(stream_id), &vault_shares);
            }

            env.events().publish(
                (symbol_short!("create"), sender.clone()),
                StreamCreatedEvent {
                    stream_id,
                    sender: sender.clone(),
                    receiver: req.receiver.clone(),
                    token: token.clone(),
                    total_amount: req.amount,
                    start_time: req.start_time,
                    end_time: req.end_time,
                    timestamp: env.ledger().timestamp(),
                },
            );
            Self::mint_receipt(&env, stream_id, &req.receiver);

            stream_ids.push_back(stream_id);
        }

        env.storage().instance().set(&STREAM_COUNT, &next_id);

        Ok(stream_ids)
    }

    /// Initializes the contract, recording `admin` as the contract admin and granting
    /// it all three RBAC roles ([`Role::SuperAdmin`], [`Role::Guardian`],
    /// [`Role::FinancialOperator`]).
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Address to install as the initial administrator; must authenticate
    ///   this call
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

    /// Grants a role to an address. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `target` - Address to grant the role to
    /// * `role` - Role to grant
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
    pub fn grant_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has SuperAdmin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }

        // Grant the role
        env.storage()
            .instance()
            .set(&DataKey::Role(target.clone(), role), &true);

        // Emit event
        env.events().publish((symbol_short!("grant"), target), role);
    }

    /// Revokes a role from an address. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `target` - Address to revoke the role from
    /// * `role` - Role to revoke
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
    pub fn revoke_role(env: Env, admin: Address, target: Address, role: Role) {
        admin.require_auth();

        // Check if caller has SuperAdmin role
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }

        // Revoke the role
        env.storage()
            .instance()
            .remove(&DataKey::Role(target.clone(), role));

        // Emit event
        env.events()
            .publish((symbol_short!("revoke"), target), role);
    }

    /// Checks whether an address holds a given role.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `address` - Address to check
    /// * `role` - Role to check for
    ///
    /// # Returns
    /// `true` if `address` holds `role`.
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

    /// Upgrades the contract to new WASM code. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `new_wasm_hash` - Hash of the new WASM code to upgrade to
    ///
    /// Upgrades the contract to new WASM code. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Upgrade process
    /// 1. Caller authenticates and is verified to hold [`Role::SuperAdmin`].
    /// 2. The current version is read from [`DataKey::ContractVersion`]
    ///    (defaults to `1` on a deployment that has never been upgraded).
    /// 3. `env.deployer().update_current_contract_wasm` atomically swaps the WASM.
    ///    Instance storage — including all stream state, role assignments, and the
    ///    version counter — is **preserved** across the swap.
    /// 4. The version counter is incremented by one and written back to storage.
    /// 5. An `upgrade` event is emitted carrying the new hash, new version, and caller.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate and hold [`Role::SuperAdmin`]
    /// * `new_wasm_hash` - 32-byte hash of the new WASM binary
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] — caller does not hold [`Role::SuperAdmin`]
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), Error> {
        admin.require_auth();

        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            return Err(Error::Unauthorized);
        }

        // Read current version (defaults to 1 for a first upgrade of an
        // unversioned deployment).
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1);
        let new_version = current_version + 1;

        // Atomically swap the WASM. Instance storage persists across the swap,
        // so the version write below is still visible after the upgrade.
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        // Persist the incremented version.
        env.storage()
            .instance()
            .set(&DataKey::ContractVersion, &new_version);

        // Emit upgrade event: (topic, data = (hash, new_version, admin))
        env.events().publish(
            (symbol_short!("upgrade"), admin.clone()),
            (new_wasm_hash, new_version, admin),
        );

        Ok(())
    }

    /// Returns the current contract version.
    ///
    /// The version starts at `1` on a fresh deployment and increments by one
    /// each time [`upgrade`](StellarStreamContract::upgrade) succeeds.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    ///
    /// # Returns
    /// Current version as `u32`. Returns `1` if the contract has never been upgraded.
    pub fn get_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ContractVersion)
            .unwrap_or(1)
    }

    /// Returns the contract admin address recorded at [`initialize`](StellarStreamContract::initialize).
    /// Retained for backward compatibility; prefer role checks via
    /// [`check_role`](StellarStreamContract::check_role) for authorization decisions.
    ///
    /// # Panics
    /// Panics if the contract has not been initialized.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set")
    }

    /// Adds an address to the restricted-address list, blocking it from being used as
    /// a stream receiver or receipt transfer target. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `address` - Address to restrict; a no-op if already restricted
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
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

    /// Checks whether an address is on the restricted-address list.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `address` - Address to check
    ///
    /// # Returns
    /// `true` if `address` is restricted.
    pub fn is_address_restricted(env: Env, address: Address) -> bool {
        Self::restricted_addresses(&env).contains(&address)
    }

    /// Load the restricted-address list once. Callers that need to check
    /// several addresses (e.g. batch validation) should reuse the returned
    /// `Vec` instead of re-reading storage per address.
    fn restricted_addresses(env: &Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(env))
    }

    /// Removes an address from the restricted-address list. Caller must hold
    /// [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `address` - Address to unrestrict
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
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

    /// Returns every address currently on the restricted-address list.
    pub fn get_restricted_addresses(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&RESTRICTED_ADDRESSES)
            .unwrap_or(Vec::new(&env))
    }

    /// Checks whether a vault address is in the approved-vaults list.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `vault` - Vault address to check
    ///
    /// # Returns
    /// `true` if `vault` is approved for use with streams.
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

    /// Fetches a stream's full record by ID.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to fetch
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error> {
        env.storage()
            .instance()
            .get(&(STREAM_COUNT, stream_id))
            .ok_or(Error::StreamNotFound)
    }

    /// Returns the number of seconds remaining until a stream's `end_time`.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to check
    ///
    /// # Returns
    /// `0` if the stream has already reached `end_time`; otherwise the number of
    /// seconds remaining.
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
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

    /// Checks whether a stream is currently active: it exists, is in
    /// [`StreamState::Active`], is not frozen, and has not yet reached `end_time`.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to check
    ///
    /// # Returns
    /// `false` if no stream exists for `stream_id`; otherwise whether it is active.
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

    /// Returns the IDs of every stream ever created as soulbound (receipt permanently
    /// locked to the original receiver).
    pub fn get_soulbound_streams(env: Env) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::SoulboundStreams)
            .unwrap_or(Vec::new(&env))
    }

    /// Reassigns a stream's `receiver` to a new address. Only the stream's `sender`
    /// may do this, and only for non-soulbound, non-closed streams.
    ///
    /// Note this changes who is entitled to *future* withdrawals (`Stream::receiver`);
    /// it does not move the ownership receipt itself (see
    /// [`transfer_receipt`](StellarStreamContract::transfer_receipt) for that).
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to update
    /// * `caller` - Address performing the transfer; must authenticate this call and
    ///   must be the stream's `sender`
    /// * `new_receiver` - Address to become the new receiver
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::StreamIsSoulbound`] - The stream's receiver is permanently locked
    /// * [`Error::Unauthorized`] - `caller` is not the stream's `sender`
    /// * [`Error::AlreadyCancelled`] - The stream is [`StreamState::Closed`]
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

    /// Adds `amount` additional funds to an active stream, extending its `end_time` so
    /// the new funds vest at the stream's existing flow rate.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to top up
    /// * `sender` - Address supplying the additional funds; must authenticate this
    ///   call and must be the stream's `sender`
    /// * `amount` - Amount to add; must be greater than zero
    ///
    /// # Errors
    /// * [`Error::InvalidAmount`] - `amount <= 0`, or the stream has already reached
    ///   `end_time`
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `sender` is not the stream's `sender`
    /// * [`Error::AlreadyCancelled`] - The stream is [`StreamState::Closed`]
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

        Self::update_token_tvl(&env, stream.token.clone(), amount);

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

    /// Pauses an active stream, freezing its vesting schedule until resumed. Only the
    /// stream's `sender` may pause it. A no-op if the stream is already paused.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to pause
    /// * `caller` - Address performing the pause; must authenticate this call and must
    ///   be the stream's `sender`
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `caller` is not the stream's `sender`
    /// * [`Error::AlreadyCancelled`] - The stream is [`StreamState::Closed`]
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

    /// Resumes a paused stream. Alias of [`resume_stream`](StellarStreamContract::resume_stream),
    /// retained for backward compatibility.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to resume
    /// * `caller` - Address performing the resume; must authenticate this call and
    ///   must be the stream's `sender`
    ///
    /// # Errors
    /// See [`resume_stream`](StellarStreamContract::resume_stream).
    pub fn unpause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        Self::resume_stream(env, stream_id, caller)
    }

    /// Resumes a paused stream, restoring time-based vesting. The paused duration is
    /// added to the stream's `total_paused_duration` so the receiver does not lose
    /// vested time to the pause. Only the stream's `sender` may resume it.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to resume
    /// * `caller` - Address performing the resume; must authenticate this call and
    ///   must be the stream's `sender`
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `caller` is not the stream's `sender`
    /// * [`Error::AlreadyCancelled`] - The stream is [`StreamState::Closed`]
    /// * [`Error::StreamNotPaused`] - The stream is not currently paused
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

    /// Withdraws all currently-vested, not-yet-withdrawn tokens from a stream to its
    /// receiver.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to withdraw from
    /// * `caller` - Address performing the withdrawal; must authenticate this call and
    ///   must be the stream's `receiver`
    ///
    /// # Returns
    /// The amount withdrawn.
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::NotReceiver`] - `caller` is not the stream's `receiver`
    /// * [`Error::AlreadyCancelled`] - The stream is [`StreamState::Closed`]
    /// * [`Error::StreamPaused`] - The stream is currently paused
    /// * [`Error::InsufficientWithdrawable`] - Nothing is currently withdrawable
    ///
    /// # Notes
    /// The final withdrawal transfers the exact remaining balance (`total_amount -
    /// withdrawn_amount`) to handle rounding dust. The function extends storage TTL
    /// and emits a [`StreamClaimEvent`] with the withdrawn amount.
    pub fn withdraw(env: Env, stream_id: u64, caller: Address) -> Result<i128, Error> {
        caller.require_auth();

        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.receiver != caller {
            return Err(Error::NotReceiver);
        }

        if stream.state == StreamState::Closed {
            return Err(Error::AlreadyCancelled);
        }
        if stream.state == StreamState::Paused {
            return Err(Error::StreamPaused);
        }

        let current_time = env.ledger().timestamp();
        let unlocked = Self::calculate_unlocked(&stream, current_time);

        // For the final withdrawal, transfer the exact remaining balance to
        // handle rounding dust and prevent contract insolvency.
        let to_withdraw = if current_time >= stream.end_time {
            stream.total_amount - stream.withdrawn_amount
        } else {
            unlocked - stream.withdrawn_amount
        };

        if to_withdraw <= 0 {
            return Err(Error::InsufficientWithdrawable);
        }

        stream.withdrawn_amount += to_withdraw;

        if stream.withdrawn_amount >= stream.total_amount {
            stream.state = StreamState::Closed;
        }

        env.storage().instance().set(&key, &stream);

        // Extend storage TTL for long-lived streams
        Self::extend_contract_ttl(&env);

        Self::update_token_tvl(&env, stream.token.clone(), -to_withdraw);

        let token_client = token::Client::new(&env, &stream.token);
        token_client.transfer(
            &env.current_contract_address(),
            &stream.receiver,
            &to_withdraw,
        );

        // Emit Withdrawal event
        env.events().publish(
            (symbol_short!("withdraw"), stream_id),
            types::StreamClaimEvent {
                stream_id,
                claimer: caller,
                amount: to_withdraw,
                total_claimed: stream.withdrawn_amount,
                timestamp: current_time,
            },
        );

        Ok(to_withdraw)
    }

    /// Cancels a stream, splitting its remaining balance: the vested-but-unwithdrawn
    /// portion goes to the receiver, and the unvested remainder is returned to the
    /// sender. May be called by either the sender or the receiver.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to cancel
    /// * `caller` - Address performing the cancellation; must authenticate this call
    ///   and must be the stream's `sender` or `receiver`
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `caller` is neither the sender nor the receiver
    /// * [`Error::AlreadyCancelled`] - The stream is already [`StreamState::Closed`]
    /// Withdraw unlocked funds from multiple streams owned by `caller` in a
    /// single call.
    ///
    /// Applies the same gas optimizations as [`Self::create_batch_streams`],
    /// tuned for the fact that on Soroban a host-managed [`Vec`] read or
    /// write is itself a metered operation, not a free native one — so the
    /// optimization that matters most here is *not* allocating extra `Vec`s
    /// to stage per-stream data, on top of the ones the batch already needs:
    ///
    /// - **Single authorization check.** `caller.require_auth()` runs once
    ///   for the whole batch instead of once per stream.
    /// - **One pass, write-then-transfer per stream.** Each stream is loaded,
    ///   validated, and has its `withdrawn_amount` written in the same loop
    ///   — matching the checks-effects-interactions order [`Self::withdraw`]
    ///   already uses, so a reentrant call during a later transfer can't
    ///   double-spend a stream whose balance was already updated. Soroban
    ///   only commits storage writes if the whole invocation succeeds, so a
    ///   bad stream anywhere in the batch still leaves the ledger exactly as
    ///   if nothing had been written: failing fast doesn't require *staging*
    ///   the batch in extra `Vec`s before writing, just rejecting it before
    ///   any transfer is issued.
    /// - **Transfers grouped per token.** Streams that share a token are
    ///   summed into one running total (in a small `Vec` bounded by the
    ///   number of *distinct* tokens, not by batch size) and paid out with a
    ///   single transfer, since the destination (`caller`) is the same for
    ///   all of them.
    ///
    /// Each stream's `withdrawn_amount` still requires its own storage write
    /// (each stream is an independent ledger entry), so per-item cost does
    /// not go to zero, but authorization and same-token transfers are now
    /// paid for once instead of once per stream.
    ///
    /// Unlike [`Self::create_batch_streams`], this function's win doesn't
    /// show up as a large drop in the CPU-instruction benchmarks in
    /// `bench_test.rs`: per-stream storage I/O is the dominant, irreducible
    /// cost here, and those benchmarks run under `mock_all_auths`, which
    /// makes the auth-check consolidation look free even though real
    /// signature verification is not. The real savings — one token-contract
    /// invocation instead of `N` for a same-token batch, and one set of auth
    /// entries instead of `N` in the transaction envelope — are measured
    /// directly (by event count) in
    /// `bench_batch_withdraw_emits_one_transfer_event_per_distinct_token`.
    ///
    /// Returns the amount withdrawn from each stream, in the same order as
    /// `stream_ids`. Returns `Error::BatchSizeExceeded` if `stream_ids`
    /// exceeds `MAX_RECIPIENTS`.
    pub fn batch_withdraw(
        env: Env,
        caller: Address,
        stream_ids: Vec<u64>,
    ) -> Result<Vec<i128>, Error> {
        if stream_ids.len() > Self::MAX_RECIPIENTS {
            return Err(Error::BatchSizeExceeded);
        }

        caller.require_auth();

        if stream_ids.is_empty() {
            return Ok(Vec::new(&env));
        }

        let current_time = env.ledger().timestamp();

        // Validate, write, and group-by-token in one pass. Writes happen
        // before any transfer below, so a reentrant call can't observe a
        // stream whose balance hasn't been updated yet.
        let mut amounts: Vec<i128> = Vec::new(&env);
        let mut tokens: Vec<Address> = Vec::new(&env);
        let mut totals: Vec<i128> = Vec::new(&env);
        for stream_id in stream_ids.iter() {
            let mut stream: Stream = env
                .storage()
                .instance()
                .get(&(STREAM_COUNT, stream_id))
                .ok_or(Error::StreamNotFound)?;

            if stream.receiver != caller {
                return Err(Error::NotReceiver);
            }
            if stream.state == StreamState::Closed {
                return Err(Error::AlreadyCancelled);
            }
            if stream.state == StreamState::Paused {
                return Err(Error::StreamPaused);
            }

            let unlocked = Self::calculate_unlocked(&stream, current_time);
            let to_withdraw = unlocked - stream.withdrawn_amount;
            if to_withdraw <= 0 {
                return Err(Error::InsufficientWithdrawable);
            }

            stream.withdrawn_amount += to_withdraw;
            let token = stream.token.clone();
            env.storage()
                .instance()
                .set(&(STREAM_COUNT, stream_id), &stream);

            match tokens.iter().position(|t| t == token) {
                Some(idx) => {
                    let running = totals.get(idx as u32).unwrap();
                    totals.set(idx as u32, running + to_withdraw);
                }
                None => {
                    tokens.push_back(token);
                    totals.push_back(to_withdraw);
                }
            }

            amounts.push_back(to_withdraw);
        }

        for i in 0..tokens.len() {
            let token = tokens.get(i).unwrap();
            let total = totals.get(i).unwrap();
            let token_client = token::Client::new(&env, &token);
            token_client.transfer(&env.current_contract_address(), &caller, &total);
        }

        Ok(amounts)
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

        let remaining = stream.total_amount - stream.withdrawn_amount;

        stream.state = StreamState::Closed;
        stream.withdrawn_amount = unlocked;
        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), -remaining);

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

    /// Optimized cancellation path for bridge migration: closes the stream and sends
    /// its entire remaining balance (both vested and unvested) to the receiver, unlike
    /// [`cancel`](StellarStreamContract::cancel) which splits the balance between sender and receiver.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to cancel
    /// * `caller` - Address performing the cancellation; must authenticate this call
    ///   and must be the stream's `receiver`
    ///
    /// # Returns
    /// The total remaining balance transferred to the receiver.
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `caller` is not the stream's `receiver`
    /// * [`Error::AlreadyCancelled`] - The stream is already [`StreamState::Closed`]
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

        Self::update_token_tvl(&env, stream.token.clone(), -remaining);

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

    /// Computes a stream's vested amount at `current_time`, freezing progress at
    /// `paused_time` while paused and shifting the cliff/end by `total_paused_duration`
    /// once resumed so paused time is never counted as vesting time.
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
                // Use exponential curve with overflow protection and paused duration
                math::calculate_unlocked_exponential(
                    stream.total_amount,
                    stream.start_time,
                    stream.end_time,
                    effective_time,
                    stream.total_paused_duration,
                )
                .unwrap_or((stream.total_amount * effective_elapsed) / duration)
            }
        }
    }

    fn update_token_tvl(env: &Env, token: Address, delta: i128) {
        let key = (storage::TOKEN_TVL, token);
        let mut tvl: i128 = env.storage().instance().get(&key).unwrap_or(0);
        tvl += delta;
        env.storage().instance().set(&key, &tvl);
    }

    /// Query the total value locked for a specific token across all active streams.
    ///
    /// TVL is calculated as the sum of remaining locked amounts (total_amount - withdrawn_amount)
    /// for every non-closed stream denominated in the given token.
    pub fn get_token_tvl(env: Env, token: Address) -> i128 {
        env.storage()
            .instance()
            .get(&(storage::TOKEN_TVL, token))
            .unwrap_or(0)
    }

    /// Query the total value locked for all tokens across all active streams.
    ///
    /// Returns a map where each key is a token address with a non-zero TVL and the value is the
    /// total locked amount for that token. Only non-closed streams are counted.
    pub fn get_all_tokens_tvl(env: Env) -> Map<Address, i128> {
        let stream_count: u64 = env.storage().instance().get(&STREAM_COUNT).unwrap_or(0);
        let mut tvl_map = Map::new(&env);

        for stream_id in 0..stream_count {
            let key = (STREAM_COUNT, stream_id);
            if let Some(stream) = env.storage().instance().get::<_, Stream>(&key) {
                if stream.state != StreamState::Closed {
                    let remaining = stream.total_amount - stream.withdrawn_amount;
                    if remaining > 0 {
                        let current = tvl_map.get(stream.token.clone()).unwrap_or(0);
                        tvl_map.set(stream.token.clone(), current + remaining);
                    }
                }
            }
        }

        tvl_map
    }

    // --- CONTRIBUTOR PULL-REQUEST PAYMENTS ---

    /// Creates a contributor-initiated request for a stream, to be later approved and
    /// funded via [`execute_request`](StellarStreamContract::execute_request).
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `receiver` - Address requesting to receive a stream; must authenticate this call
    /// * `token` - Token contract address requested
    /// * `total_amount` - Total amount requested
    /// * `duration` - Requested stream duration, in seconds, starting from now
    /// * `metadata` - Optional metadata hash to attach to the request
    ///
    /// # Returns
    /// The newly created request's ID.
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

    /// Approves and executes a pending contributor request, creating a linear stream
    /// funded by `admin` (not by the original requester) that pays out to the
    /// request's `receiver`. Caller must hold [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller who will fund the resulting stream; must authenticate this
    ///   call and hold [`Role::SuperAdmin`]
    /// * `request_id` - ID of the request to execute
    ///
    /// # Returns
    /// The newly created stream's ID.
    ///
    /// # Errors
    /// * [`Error::Unauthorized`] - `admin` does not hold [`Role::SuperAdmin`]
    /// * [`Error::StreamNotFound`] - No request exists for `request_id`
    /// * [`Error::AlreadyExecuted`] - The request is not [`RequestStatus::Pending`]
    /// * Propagates any error from the underlying stream creation (e.g.
    ///   [`Error::InvalidAmount`]).
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

        // Create the stream first (using the non-authorizing helper, since
        // `admin` is already authenticated above) and only mark the request
        // approved once the stream has been created successfully.
        let milestones: Vec<Milestone> = Vec::new(&env);
        let options = StreamOptions {
            curve_type: CurveType::Linear,
            is_soulbound: false,
            vault_address: None,
        };
        let stream_id = Self::create_stream_internal(
            env.clone(),
            admin.clone(),
            request.receiver.clone(),
            request.token.clone(),
            request.total_amount,
            request.start_time,
            request.start_time, // cliff_time: no cliff
            request.start_time + request.duration,
            milestones,
            options,
        )?;

        request.status = RequestStatus::Approved;
        env.storage()
            .instance()
            .set(&RequestKey::Request(request_id), &request);
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

    /// Fetches a contributor request by ID.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `request_id` - ID of the request to fetch
    ///
    /// # Returns
    /// `None` if no request exists for `request_id`.
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

    /// Fetches a multi-sig stream proposal by ID.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `proposal_id` - ID of the proposal to fetch
    ///
    /// # Returns
    /// `None` if no proposal exists for `proposal_id`.
    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<StreamProposal> {
        env.storage().instance().get(&(PROPOSAL_COUNT, proposal_id))
    }

    /// Fetches a stream's ownership receipt by stream ID.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream whose receipt to fetch
    ///
    /// # Returns
    /// `None` if no stream/receipt exists for `stream_id`.
    pub fn get_receipt(env: Env, stream_id: u64) -> Option<StreamReceipt> {
        env.storage().instance().get(&(RECEIPT, stream_id))
    }

    /// Computes a snapshot of a stream's locked/unlocked balances for display purposes
    /// (e.g. as NFT receipt metadata).
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to snapshot
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
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

    /// Transfers ownership of a stream's receipt (and its associated `receipt_owner`
    /// on the stream) to a new address.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream whose receipt to transfer
    /// * `caller` - Current receipt owner; must authenticate this call
    /// * `new_owner` - Address to become the new receipt owner
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream/receipt exists for `stream_id`
    /// * [`Error::NotReceiptOwner`] - `caller` does not currently own the receipt
    ///
    /// # Panics
    /// Panics with [`Error::AddressRestricted`] if `new_owner` is on the restricted list.
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

    // ========== Dispute Resolution Framework ==========

    /// Adds an address to the authorized arbitrator list. Caller must hold
    /// [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `arbitrator` - Address to add as an arbitrator
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
    pub fn add_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let mut arbitrators: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATORS)
            .unwrap_or(Vec::new(&env));
        if !arbitrators.contains(arbitrator.clone()) {
            arbitrators.push_back(arbitrator);
            env.storage().instance().set(&ARBITRATORS, &arbitrators);
        }
    }

    /// Removes an address from the authorized arbitrator list. Caller must hold
    /// [`Role::SuperAdmin`].
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `admin` - Caller; must authenticate this call and hold [`Role::SuperAdmin`]
    /// * `arbitrator` - Address to remove from the arbitrator list
    ///
    /// # Panics
    /// Panics with [`Error::Unauthorized`] if `admin` does not hold [`Role::SuperAdmin`].
    pub fn remove_arbitrator(env: Env, admin: Address, arbitrator: Address) {
        admin.require_auth();
        if !Self::has_role(&env, &admin, Role::SuperAdmin) {
            soroban_sdk::panic_with_error!(&env, Error::Unauthorized);
        }
        let arbitrators: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATORS)
            .unwrap_or(Vec::new(&env));
        let mut new_list = Vec::new(&env);
        for a in arbitrators.iter() {
            if a != arbitrator {
                new_list.push_back(a.clone());
            }
        }
        env.storage().instance().set(&ARBITRATORS, &new_list);
    }

    /// Returns the list of authorized arbitrators.
    pub fn get_arbitrators(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&ARBITRATORS)
            .unwrap_or(Vec::new(&env))
    }

    /// Checks whether an address is an authorized arbitrator.
    pub fn is_arbitrator(env: Env, address: Address) -> bool {
        let arbitrators: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATORS)
            .unwrap_or(Vec::new(&env));
        arbitrators.contains(address)
    }

    /// Sets an arbiter for a specific stream. Only the stream's `sender` may set
    /// the arbiter.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to set the arbiter for
    /// * `caller` - Address performing the operation; must authenticate this call and
    ///   must be the stream's `sender`
    /// * `arbiter` - Address to set as the stream's arbiter
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `caller` is not the stream's `sender`
    pub fn set_arbiter(
        env: Env,
        stream_id: u64,
        caller: Address,
        arbiter: Address,
    ) -> Result<(), Error> {
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
        stream.arbiter = Some(arbiter);
        env.storage().instance().set(&key, &stream);
        Ok(())
    }

    /// Freezes a stream pending dispute resolution. Only the stream's arbiter may
    /// freeze it.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to freeze
    /// * `arbiter` - Address performing the freeze; must authenticate this call and
    ///   must be the stream's arbiter
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `arbiter` is not the stream's arbiter
    pub fn freeze_stream(env: Env, stream_id: u64, arbiter: Address) -> Result<(), Error> {
        arbiter.require_auth();
        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;
        if stream.arbiter.as_ref() != Some(&arbiter) {
            return Err(Error::Unauthorized);
        }
        stream.is_frozen = true;
        env.storage().instance().set(&key, &stream);
        env.events().publish(
            (symbol_short!("freeze"), stream_id),
            types::StreamFrozenEvent {
                stream_id,
                arbiter,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    /// Unfreezes a stream after dispute resolution. Only the stream's arbiter may
    /// unfreeze it.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to unfreeze
    /// * `arbiter` - Address performing the unfreeze; must authenticate this call and
    ///   must be the stream's arbiter
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `arbiter` is not the stream's arbiter
    pub fn unfreeze_stream(env: Env, stream_id: u64, arbiter: Address) -> Result<(), Error> {
        arbiter.require_auth();
        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;
        if stream.arbiter.as_ref() != Some(&arbiter) {
            return Err(Error::Unauthorized);
        }
        stream.is_frozen = false;
        env.storage().instance().set(&key, &stream);
        Ok(())
    }

    /// Resolves a dispute on a stream by distributing the remaining balance between
    /// sender and receiver. Only the stream's arbiter may resolve a dispute.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to resolve
    /// * `arbiter` - Address performing the resolution; must authenticate this call and
    ///   must be the stream's arbiter
    /// * `receiver_amount` - Amount (in basis points, 0-10000) to allocate to the receiver;
    ///   the remainder goes to the sender
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::Unauthorized`] - `arbiter` is not the stream's arbiter
    pub fn resolve_dispute(
        env: Env,
        stream_id: u64,
        arbiter: Address,
        receiver_amount: i128,
    ) -> Result<(), Error> {
        arbiter.require_auth();
        let key = (STREAM_COUNT, stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;
        if stream.arbiter.as_ref() != Some(&arbiter) {
            return Err(Error::Unauthorized);
        }

        let remaining = stream.total_amount - stream.withdrawn_amount;
        let to_receiver = (remaining * receiver_amount) / 10_000;
        let to_sender = remaining - to_receiver;

        stream.state = StreamState::Closed;
        stream.is_frozen = false;
        stream.withdrawn_amount = stream.total_amount;
        env.storage().instance().set(&key, &stream);

        Self::update_token_tvl(&env, stream.token.clone(), -remaining);

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

        env.events().publish(
            (symbol_short!("resolve"), stream_id),
            types::DisputeResolvedEvent {
                dispute_id: 0,
                stream_id,
                resolution: DisputeResolution::CancelStream,
                timestamp: env.ledger().timestamp(),
            },
        );

        Ok(())
    }

    /// Raises a dispute on a stream. Only the stream's sender or receiver may raise
    /// a dispute.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `stream_id` - ID of the stream to dispute
    /// * `caller` - Address raising the dispute; must authenticate this call and must
    ///   be the stream's `sender` or `receiver`
    /// * `reason` - Human-readable reason for the dispute
    /// * `proposed_resolution` - Proposed resolution for the dispute
    ///
    /// # Returns
    /// The newly created dispute's ID.
    ///
    /// # Errors
    /// * [`Error::StreamNotFound`] - No stream exists for `stream_id`
    /// * [`Error::NotDisputeParty`] - `caller` is neither the sender nor the receiver
    pub fn raise_dispute(
        env: Env,
        stream_id: u64,
        caller: Address,
        reason: String,
        proposed_resolution: DisputeResolution,
    ) -> Result<u64, Error> {
        caller.require_auth();
        let key = (STREAM_COUNT, stream_id);
        let stream: Stream = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::StreamNotFound)?;

        if stream.sender != caller && stream.receiver != caller {
            return Err(Error::NotDisputeParty);
        }

        let dispute_id: u64 = env.storage().instance().get(&DISPUTE_COUNT).unwrap_or(0);
        let next_id = dispute_id + 1;
        let now = env.ledger().timestamp();

        let dispute = Dispute {
            dispute_id,
            stream_id,
            raised_by: caller.clone(),
            reason,
            proposed_resolution,
            arbitrator_votes: Map::new(&env),
            resolved: false,
            raised_at: now,
            deadline: now + 7 * 24 * 60 * 60, // 7 days
            required_votes: 1,
        };

        env.storage()
            .instance()
            .set(&(DISPUTE, dispute_id), &dispute);
        env.storage().instance().set(&DISPUTE_COUNT, &next_id);

        // Freeze the stream while dispute is active
        let mut stream = stream;
        stream.is_frozen = true;
        env.storage().instance().set(&key, &stream);

        env.events().publish(
            (symbol_short!("dispute"), dispute_id),
            DisputeRaisedEvent {
                dispute_id,
                stream_id,
                raised_by: caller,
                reason: dispute.reason.clone(),
                proposed_resolution: dispute.proposed_resolution.clone(),
                timestamp: now,
            },
        );

        Ok(dispute_id)
    }

    /// Votes on a dispute. Only authorized arbitrators may vote.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `dispute_id` - ID of the dispute to vote on
    /// * `arbitrator` - Address casting the vote; must authenticate this call and must
    ///   be an authorized arbitrator
    /// * `approve` - Whether the arbitrator approves the proposed resolution
    ///
    /// # Errors
    /// * [`Error::DisputeNotFound`] - No dispute exists for `dispute_id`
    /// * [`Error::NotArbitrator`] - `arbitrator` is not an authorized arbitrator
    /// * [`Error::DisputeAlreadyResolved`] - The dispute has already been resolved
    /// * [`Error::AlreadyVoted`] - `arbitrator` has already voted on this dispute
    /// * [`Error::DisputeExpired`] - The dispute has passed its deadline
    pub fn vote_on_dispute(
        env: Env,
        dispute_id: u64,
        arbitrator: Address,
        approve: bool,
    ) -> Result<(), Error> {
        arbitrator.require_auth();

        let key = (DISPUTE, dispute_id);
        let mut dispute: Dispute = env
            .storage()
            .instance()
            .get(&key)
            .ok_or(Error::DisputeNotFound)?;

        if dispute.resolved {
            return Err(Error::DisputeAlreadyResolved);
        }

        let now = env.ledger().timestamp();
        if now > dispute.deadline {
            return Err(Error::DisputeExpired);
        }

        // Check arbitrator authorization
        let arbitrators: Vec<Address> = env
            .storage()
            .instance()
            .get(&ARBITRATORS)
            .unwrap_or(Vec::new(&env));
        if !arbitrators.contains(arbitrator.clone()) {
            return Err(Error::NotArbitrator);
        }

        if dispute.arbitrator_votes.contains_key(arbitrator.clone()) {
            return Err(Error::AlreadyVoted);
        }

        dispute.arbitrator_votes.set(arbitrator.clone(), approve);

        // Count approvals
        let mut approval_count: u32 = 0;
        for (_, vote) in dispute.arbitrator_votes.iter() {
            if vote {
                approval_count += 1;
            }
        }

        // Auto-execute when threshold reached
        if approval_count >= dispute.required_votes {
            dispute.resolved = true;
            env.storage().instance().set(&key, &dispute);

            // Execute the resolution
            Self::execute_dispute_resolution(&env, &dispute)?;
        } else {
            env.storage().instance().set(&key, &dispute);
        }

        env.events().publish(
            (symbol_short!("vote"), dispute_id),
            DisputeVotedEvent {
                dispute_id,
                arbitrator,
                approve,
                approval_count,
                required_votes: dispute.required_votes,
                timestamp: now,
            },
        );

        Ok(())
    }

    /// Fetches a dispute by ID.
    ///
    /// # Arguments
    /// * `env` - The contract execution environment
    /// * `dispute_id` - ID of the dispute to fetch
    ///
    /// # Returns
    /// `None` if no dispute exists for `dispute_id`.
    pub fn get_dispute(env: Env, dispute_id: u64) -> Option<Dispute> {
        env.storage().instance().get(&(DISPUTE, dispute_id))
    }

    /// Internal helper: executes a dispute resolution once the vote threshold is met.
    fn execute_dispute_resolution(env: &Env, dispute: &Dispute) -> Result<(), Error> {
        let stream_key = (STREAM_COUNT, dispute.stream_id);
        let mut stream: Stream = env
            .storage()
            .instance()
            .get(&stream_key)
            .ok_or(Error::StreamNotFound)?;

        match &dispute.proposed_resolution {
            DisputeResolution::RefundSender(amount) => {
                let refund = (*amount).min(stream.total_amount - stream.withdrawn_amount);
                stream.withdrawn_amount += refund;
                stream.state = StreamState::Closed;
                stream.is_frozen = false;
                env.storage().instance().set(&stream_key, &stream);
                Self::update_token_tvl(env, stream.token.clone(), -refund);
                let token_client = token::Client::new(env, &stream.token);
                if refund > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &stream.sender,
                        &refund,
                    );
                }
            }
            DisputeResolution::PayReceiver(amount) => {
                let pay = (*amount).min(stream.total_amount - stream.withdrawn_amount);
                stream.withdrawn_amount += pay;
                stream.state = StreamState::Closed;
                stream.is_frozen = false;
                env.storage().instance().set(&stream_key, &stream);
                Self::update_token_tvl(env, stream.token.clone(), -pay);
                let token_client = token::Client::new(env, &stream.token);
                if pay > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &stream.receiver,
                        &pay,
                    );
                }
            }
            DisputeResolution::FreezeStream => {
                stream.is_frozen = true;
                env.storage().instance().set(&stream_key, &stream);
            }
            DisputeResolution::CancelStream => {
                let remaining = stream.total_amount - stream.withdrawn_amount;
                stream.state = StreamState::Closed;
                stream.is_frozen = false;
                stream.withdrawn_amount = stream.total_amount;
                env.storage().instance().set(&stream_key, &stream);
                Self::update_token_tvl(env, stream.token.clone(), -remaining);
                let token_client = token::Client::new(env, &stream.token);
                if remaining > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        &stream.receiver,
                        &remaining,
                    );
                }
            }
        }

        env.events().publish(
            (symbol_short!("resolved"), dispute.dispute_id),
            DisputeResolvedEvent {
                dispute_id: dispute.dispute_id,
                stream_id: dispute.stream_id,
                resolution: dispute.proposed_resolution.clone(),
                timestamp: env.ledger().timestamp(),
            },
        );

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

