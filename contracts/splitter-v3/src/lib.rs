#![no_std]
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, Vec,
};

mod errors;
mod events;
mod storage;
use errors::Error;
use events::{emit_individual_payment, emit_split_executed};
use storage::DataKey;

#[cfg(test)]
mod test;

// ── #918: Identity Validator cross-contract interface ─────────────────────────

/// Trait interface for an external identity validator contract.
/// The validator must expose `is_verified(address: Address) -> bool`.
/// If the validator returns false for any recipient, the transaction reverts.
#[soroban_sdk::contractclient(name = "IdentityValidatorClient")]
pub trait IdentityValidator {
    fn is_verified(env: Env, address: Address) -> bool;
}

/// Minimum payment per recipient: 1 XLM equivalent in stroops (10^7).
const MINIMUM_PAYMENT_AMOUNT: i128 = 10_000_000;

// ── Public types ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Recipient {
    pub address: Address,
    pub share_bps: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct PercentRecipient {
    pub address: Address,
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum AdminAction {
    UpdateFee(u32),
    UpdateCollector(Address),
}

// ── #914: Multi-asset split types ────────────────────────────────────────────

/// A single asset group for `split_multi_asset`: one SAC token address paired
/// with its recipient list. Each group is processed atomically within the call.
#[contracttype]
#[derive(Clone)]
pub struct AssetGroup {
    /// The Stellar Asset Contract (SAC) token address for this group.
    pub asset_address: Address,
    /// Recipients and their share in basis points (must sum to 10_000 per group).
    pub recipients: Vec<Recipient>,
    /// Total amount of `asset_address` to disburse across `recipients`.
    pub total_amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct Proposal {
    pub action: AdminAction,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

// ── #916: Sensitive admin change proposal types ───────────────────────────────

/// Actions that require multi-sig quorum approval before execution.
/// Covers fee-wallet changes, contract upgrades, and pause/unpause.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum AdminChangeAction {
    /// Update the protocol fee-wallet address.
    UpdateFeeWallet(Address),
    /// Upgrade the contract WASM to a new hash (with migration version guard).
    UpgradeWasm(soroban_sdk::BytesN<32>, u32),
    /// Set the circuit-breaker state (Active or Paused).
    SetContractState(ContractState),
}

/// Pending multi-sig proposal for a sensitive admin action.
#[contracttype]
#[derive(Clone)]
pub struct AdminProposal {
    pub action: AdminChangeAction,
    pub approvals: Vec<Address>,
    pub threshold: u32,
    pub executed: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SplitStatus {
    Pending,
    Executed,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct SplitConfig {
    pub sender: Address,
    pub recipients: Vec<Recipient>,
    pub total_amount: i128,
    /// Ledger timestamp after which the split can be executed (#915).
    pub release_ledger: u64,
    pub status: SplitStatus,
}

/// #922: Protocol-wide circuit-breaker state.
#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum ContractState {
    Active,
    Paused,
}

// ── #917: Push/Pull transfer mode ─────────────────────────────────────────────

/// Controls whether `split_funds` pushes tokens directly to recipients (PUSH)
/// or credits claimable balances they must claim themselves (PULL).
/// PULL mode bypasses trustline issues for recipients.
// ── #911: V3 base contract types ──────────────────────────────────────────────

/// Disbursement status for a V3 split config entry.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DisbursementStatus {
    Pending,
    Completed,
    Cancelled,
}

/// #917: Transfer mode — PUSH sends directly; PULL credits claimable balances.
#[contracttype]
#[derive(Clone, PartialEq)]
pub enum SplitMode {
    Push,
    Pull,
}

/// #911: Stores the full configuration for a single disbursement.
#[contracttype]
#[derive(Clone)]
pub struct SplitConfigV3 {
    pub owner: Address,
    pub asset_address: Address,
    pub total_amount: i128,
    pub recipients_list: Vec<Recipient>,
    pub status: DisbursementStatus,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct SplitterV3;

#[contractimpl]
impl SplitterV3 {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        owner: Address,
        token: Address,
        fee_bps: u32,
        treasury: Address,
        quorum_admins: Vec<Address>,
        council_keys: Vec<Address>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        owner.require_auth();
        env.storage().instance().set(&DataKey::Admin, &owner);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::FeeBps, &fee_bps);
        env.storage().instance().set(&DataKey::Treasury, &treasury);
        env.storage().instance().set(&DataKey::StrictMode, &false);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::QuorumAdmins, &quorum_admins);
        env.storage().instance().set(&DataKey::NextSplitId, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::CouncilKeys, &council_keys);
        // #922: start Active
        env.storage()
            .instance()
            .set(&DataKey::ContractState, &ContractState::Active);
        // #916: default admin threshold = majority of quorum_admins (at least 2)
        let threshold: u32 = if quorum_admins.len() >= 2 {
            (quorum_admins.len() / 2 + 1) as u32
        } else {
            1
        };
        env.storage()
            .instance()
            .set(&DataKey::AdminThreshold, &threshold);
        env.storage()
            .instance()
            .set(&DataKey::NextAdminProposalId, &0u64);
        Self::_set_verified(&env, &owner, true);
        for addr in quorum_admins.iter() {
            Self::_set_verified(&env, &addr, true);
        }
        Ok(())
    }

    // ── #911: Protocol-level init (fee wallet + version constants) ────────────

    /// Update the fee wallet address. Requires a passed admin proposal (#916).
    /// Use `propose_admin_change` + `approve_admin_change` to create and approve
    /// an `UpdateFeeWallet` proposal, then call this with the proposal_id.
    pub fn init(env: Env, caller: Address, proposal_id: u64, version: u32) -> Result<(), Error> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::NotAdmin);
        }
        caller.require_auth();
        let action = Self::_consume_admin_proposal(&env, &caller, proposal_id,
            |action| matches!(action, AdminChangeAction::UpdateFeeWallet(_)))?;
        if let AdminChangeAction::UpdateFeeWallet(fee_wallet) = action {
            env.storage()
                .instance()
                .set(&DataKey::FeeWallet, &fee_wallet);
            env.storage()
                .instance()
                .set(&DataKey::ProtocolVersion, &version);
            Self::_bump_instance_ttl(&env);
            Ok(())
        } else {
            Err(Error::NotAuthorizedAdmin)
        }
    }

    /// View the stored protocol version.
    pub fn protocol_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::ProtocolVersion)
            .unwrap_or(0)
    }

    /// View the stored fee wallet address.
    pub fn fee_wallet(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::FeeWallet)
    }

    // ── #916: Multi-sig admin change proposals ────────────────────────────────

    /// Propose a sensitive admin action (fee wallet change, upgrade, or pause).
    /// The caller must be a quorum admin. The proposal is created with the
    /// caller's approval already counted. Returns the new proposal ID.
    pub fn propose_admin_change(
        env: Env,
        caller: Address,
        action: AdminChangeAction,
    ) -> Result<u64, Error> {
        caller.require_auth();
        Self::_require_quorum_admin(&env, &caller)?;

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextAdminProposalId)
            .unwrap_or(0);
        let threshold: u32 = env
            .storage()
            .instance()
            .get(&DataKey::AdminThreshold)
            .unwrap_or(2);
        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(caller.clone());

        let proposal = AdminProposal {
            action,
            approvals,
            threshold,
            executed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::AdminProposal(id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextAdminProposalId, &(id + 1));
        Self::_bump_persistent_ttl(&env, &DataKey::AdminProposal(id));
        Self::_bump_instance_ttl(&env);

        env.events()
            .publish((symbol_short!("admprop"), caller), id);
        Ok(id)
    }

    /// Approve a pending admin change proposal. Once approvals reach the
    /// threshold the proposal is ready to be executed via the gated function.
    pub fn approve_admin_change(
        env: Env,
        caller: Address,
        proposal_id: u64,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::_require_quorum_admin(&env, &caller)?;

        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&DataKey::AdminProposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;

        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        for existing in proposal.approvals.iter() {
            if existing == caller {
                return Err(Error::AlreadyApproved);
            }
        }
        proposal.approvals.push_back(caller.clone());
        env.storage()
            .persistent()
            .set(&DataKey::AdminProposal(proposal_id), &proposal);
        Self::_bump_persistent_ttl(&env, &DataKey::AdminProposal(proposal_id));

        env.events()
            .publish((symbol_short!("admapprv"), caller), proposal_id);
        Ok(())
    }

    /// View a pending admin change proposal.
    pub fn get_admin_proposal(env: Env, proposal_id: u64) -> Option<AdminProposal> {
        env.storage()
            .persistent()
            .get(&DataKey::AdminProposal(proposal_id))
    }

    /// View the current admin threshold.
    pub fn admin_threshold(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::AdminThreshold)
            .unwrap_or(2)
    }

    // ── #922: Circuit-breaker ─────────────────────────────────────────────────

    /// Pause or unpause the contract. Requires a passed admin proposal (#916).
    /// Use `propose_admin_change` + `approve_admin_change` to create and approve
    /// a `SetContractState` proposal, then call this with the proposal_id.
    pub fn set_contract_state(env: Env, caller: Address, proposal_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let new_state = Self::_consume_admin_proposal(&env, &caller, proposal_id,
            |action| matches!(action, AdminChangeAction::SetContractState(_)))?;
        if let AdminChangeAction::SetContractState(state) = new_state {
            env.storage()
                .instance()
                .set(&DataKey::ContractState, &state);
            Self::_bump_instance_ttl(&env);
            env.events()
                .publish((symbol_short!("setstate"), proposal_id), ());
            Ok(())
        } else {
            Err(Error::NotAuthorizedAdmin)
        }
    }

    // ── #924: WASM upgrade with migration version guard ───────────────────────

    /// Upgrade the contract WASM. Requires a passed admin proposal (#916).
    /// Use `propose_admin_change` + `approve_admin_change` to create and approve
    /// an `UpgradeWasm` proposal, then call this with the proposal_id.
    pub fn upgrade(env: Env, caller: Address, proposal_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let action = Self::_consume_admin_proposal(&env, &caller, proposal_id,
            |action| matches!(action, AdminChangeAction::UpgradeWasm(_, _)))?;
        if let AdminChangeAction::UpgradeWasm(new_wasm_hash, migration_version) = action {
            let current_version: u32 = env
                .storage()
                .instance()
                .get(&DataKey::MigrationVersion)
                .unwrap_or(0);
            if migration_version <= current_version {
                return Err(Error::MigrationAlreadyApplied);
            }
            env.storage()
                .instance()
                .set(&DataKey::MigrationVersion, &migration_version);
            env.deployer().update_current_contract_wasm(new_wasm_hash);
            Ok(())
        } else {
            Err(Error::NotAuthorizedAdmin)
        }
    }

    // ── #927: Whitelist management ────────────────────────────────────────────

    /// Add `address` to the recipient whitelist. Admin only.
    pub fn add_to_whitelist(env: Env, address: Address) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .persistent()
            .set(&DataKey::Whitelisted(address.clone()), &true);
        Self::_bump_persistent_ttl(&env, &DataKey::Whitelisted(address));
        Ok(())
    }

    /// Remove `address` from the recipient whitelist. Admin only.
    pub fn remove_from_whitelist(env: Env, address: Address) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .persistent()
            .remove(&DataKey::Whitelisted(address));
        Ok(())
    }

    /// Enable or disable whitelist-only mode for `split_funds`. Admin only.
    pub fn set_whitelist_only(env: Env, enabled: bool) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::WhitelistOnly, &enabled);
        Self::_bump_instance_ttl(&env);
        Ok(())
    }

    /// View whether an address is whitelisted.
    pub fn is_whitelisted(env: Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Whitelisted(address))
            .unwrap_or(false)
    }

    // ── #918: Identity Validator ──────────────────────────────────────────────

    /// Set the external identity validator contract address. Admin only.
    /// When set, `split_funds` and `split` will cross-call `is_verified` on
    /// every recipient before processing. Any unverified recipient reverts the tx.
    pub fn set_identity_validator(env: Env, validator: Address) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::IdentityValidator, &validator);
        Self::_bump_instance_ttl(&env);
        Ok(())
    }

    /// Remove the identity validator (disables external compliance checks).
    pub fn remove_identity_validator(env: Env) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .instance()
            .remove(&DataKey::IdentityValidator);
        Ok(())
    }

    /// View the currently configured identity validator address.
    pub fn identity_validator(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::IdentityValidator)
    }

    // ── #633: Verification management (single-admin) ──────────────────────────

    // ── #919: Affiliate config ────────────────────────────────────────────────

    /// Set the protocol-level affiliate address and their fee in basis points.
    pub fn set_affiliate(env: Env, affiliate: Address, bps: u32) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::AffiliateAddress, &affiliate);
        env.storage().instance().set(&DataKey::AffiliateBps, &bps);
        Ok(())
    }

    /// Affiliate (or anyone) calls this to pull their pending balance.
    pub fn withdraw_affiliate(env: Env, caller: Address) -> Result<(), Error> {
        caller.require_auth();
        let amount: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::PendingWithdrawal(caller.clone()))
            .unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        env.storage()
            .persistent()
            .set(&DataKey::PendingWithdrawal(caller.clone()), &0i128);
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&env.current_contract_address(), &caller, &amount);
        env.events()
            .publish((symbol_short!("aff_out"), caller), amount);
        Ok(())
    }

    // ── #633: Verification management ────────────────────────────────────────

    pub fn set_verification_status(env: Env, user: Address, status: bool) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        Self::_set_verified(&env, &user, status);
        env.events()
            .publish((symbol_short!("verified"), user.clone()), status);
        Ok(())
    }

    pub fn set_strict_mode(env: Env, strict: bool) -> Result<(), Error> {
        Self::_require_admin(&env)?;
        env.storage().instance().set(&DataKey::StrictMode, &strict);
        Ok(())
    }

    // ── #634: Quorum — propose ────────────────────────────────────────────────

    pub fn propose_change(env: Env, caller: Address, action: AdminAction) -> Result<u64, Error> {
        caller.require_auth();
        Self::_require_quorum_admin(&env, &caller)?;
        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextProposalId)
            .unwrap_or(0);
        let mut approvals: Vec<Address> = Vec::new(&env);
        approvals.push_back(caller);
        let proposal = Proposal {
            action,
            approvals,
            executed: false,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(id), &proposal);
        env.storage()
            .instance()
            .set(&DataKey::NextProposalId, &(id + 1));
        Self::_bump_persistent_ttl(&env, &DataKey::Proposal(id));
        Self::_bump_instance_ttl(&env);

        Ok(id)
    }

    pub fn approve_proposal(env: Env, caller: Address, proposal_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::_require_quorum_admin(&env, &caller)?;
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        for existing in proposal.approvals.iter() {
            if existing == caller {
                return Err(Error::AlreadyApproved);
            }
        }
        proposal.approvals.push_back(caller);
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        Ok(())
    }

    pub fn execute_proposal(env: Env, caller: Address, proposal_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::_require_quorum_admin(&env, &caller)?;
        let mut proposal: Proposal = env
            .storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        if proposal.approvals.len() < 2 {
            return Err(Error::QuorumNotReached);
        }
        match proposal.action.clone() {
            AdminAction::UpdateFee(new_bps) => {
                env.storage().instance().set(&DataKey::FeeBps, &new_bps);
            }
            AdminAction::UpdateCollector(new_treasury) => {
                env.storage()
                    .instance()
                    .set(&DataKey::Treasury, &new_treasury);
            }
        }
        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::Proposal(proposal_id), &proposal);
        env.events()
            .publish((symbol_short!("settings"), proposal_id), proposal.action);
        Ok(())
    }

    // ── Core: split ───────────────────────────────────────────────────────────

    /// `affiliate` — optional partner address that receives 0.1% of `total_amount`
    /// before the recipient list is processed.
    ///
    /// `salt` — caller-supplied nonce used to build the idempotency hash.
    /// Pass a unique value per disbursement to prevent double-spend on retries.
    pub fn split(
        env: Env,
        sender: Address,
        recipients: Vec<Recipient>,
        total_amount: i128,
        affiliate: Option<Address>,
        salt: BytesN<32>,
    ) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        sender.require_auth();

        // ── Idempotency: reject replayed disbursements ────────────────────────
        let hash = Self::_compute_split_hash(&env, &sender, &recipients, total_amount, &salt)?;
        if env
            .storage()
            .temporary()
            .has(&DataKey::ProcessedHash(hash.clone()))
        {
            return Err(Error::AlreadyProcessed);
        }

        let strict: bool = env
            .storage()
            .instance()
            .get(&DataKey::StrictMode)
            .unwrap_or(false);
        let mut bps_sum: u32 = 0;
        for r in recipients.iter() {
            bps_sum = bps_sum.checked_add(r.share_bps).ok_or(Error::Overflow)?;
        }
        if bps_sum != 10_000 {
            return Err(Error::InvalidSplit);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_addr = env.current_contract_address();

        // ── Pre-flight: read-only balance check before any cross-contract call ─
        Self::check_balances_bulk(&env, &token_client, &sender, total_amount)?;

        token_client.transfer(&sender, &contract_addr, &total_amount);
        let affiliate_amount = if let Some(ref affiliate_addr) = affiliate {
            let a = total_amount.checked_mul(10).ok_or(Error::Overflow)? / 10_000;
            if a > 0 {
                token_client.transfer(&contract_addr, affiliate_addr, &a);
                env.events().publish((symbol_short!("affiliate"),), a);
            }
            a
        } else {
            0
        };
        let after_affiliate = total_amount
            .checked_sub(affiliate_amount)
            .ok_or(Error::Overflow)?;
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = if fee_bps > 0 {
            let f = after_affiliate
                .checked_mul(fee_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
            if f > 0 {
                token_client.transfer(&contract_addr, &treasury, &f);
            }
            f
        } else {
            0
        };
        let distributable = after_affiliate
            .checked_sub(fee_amount)
            .ok_or(Error::Overflow)?;
        if strict {
            for r in recipients.iter() {
                if !Self::is_verified(&env, r.address.clone()) {
                    return Err(Error::RecipientNotVerified);
                }
            }
            Self::_distribute(
                &env,
                &token_client,
                &token_addr,
                &contract_addr,
                &recipients,
                distributable,
            )?;
        } else {
            let mut verified: Vec<Recipient> = Vec::new(&env);
            let mut verified_bps: u32 = 0;
            for r in recipients.iter() {
                if Self::is_verified(&env, r.address.clone()) {
                    verified_bps = verified_bps
                        .checked_add(r.share_bps)
                        .ok_or(Error::Overflow)?;
                    verified.push_back(r);
                }
            }
            if verified.is_empty() {
                return Err(Error::NoVerifiedRecipients);
            }
            let mut scaled: Vec<Recipient> = Vec::new(&env);
            for r in verified.iter() {
                let new_bps = (r.share_bps as u64)
                    .checked_mul(10_000)
                    .ok_or(Error::Overflow)? as u32
                    / verified_bps;
                scaled.push_back(Recipient {
                    address: r.address.clone(),
                    share_bps: new_bps,
                });
            }
            Self::_distribute(&env, &token_client, &token_addr, &contract_addr, &scaled, distributable)?;
        }

        // ── Mark hash as processed (temporary storage, TTL ~1 day) ───────────
        env.storage()
            .temporary()
            .set(&DataKey::ProcessedHash(hash), &true);

        Ok(())
    }

    // ── Scheduled splits ──────────────────────────────────────────────────────

    pub fn schedule_split(
        env: Env,
        sender: Address,
        recipients: Vec<Recipient>,
        total_amount: i128,
        release_ledger: u64,
    ) -> Result<u64, Error> {
        Self::_require_not_paused(&env)?;
        sender.require_auth();
        let mut bps_sum: u32 = 0;
        for r in recipients.iter() {
            bps_sum = bps_sum.checked_add(r.share_bps).ok_or(Error::Overflow)?;
        }
        if bps_sum != 10_000 {
            return Err(Error::InvalidSplit);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        // Assign and increment the split id counter.
        let split_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextSplitId)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::NextSplitId, &(split_id + 1));

        let config = SplitConfig {
            sender,
            recipients,
            total_amount,
            release_ledger,
            status: SplitStatus::Pending,
        };
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledSplit(split_id), &config);
        Self::_bump_persistent_ttl(&env, &DataKey::ScheduledSplit(split_id));

        env.events()
            .publish((symbol_short!("sched"), split_id), release_ledger);

        Ok(split_id)
    }

    pub fn execute_split(env: Env, split_id: u64) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        let mut config: SplitConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ScheduledSplit(split_id))
            .ok_or(Error::SplitNotFound)?;
        match config.status {
            SplitStatus::Cancelled => return Err(Error::SplitAlreadyCancelled),
            SplitStatus::Executed => return Err(Error::SplitAlreadyExecuted),
            SplitStatus::Pending => {}
        }
        // #915: funds cannot be released until release_ledger timestamp is reached.
        if env.ledger().timestamp() < config.release_ledger {
            return Err(Error::NotYetReleased);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_addr = env.current_contract_address();
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = if fee_bps > 0 {
            let f = config
                .total_amount
                .checked_mul(fee_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
            if f > 0 {
                token_client.transfer(&contract_addr, &treasury, &f);
            }
            f
        } else {
            0
        };
        let distributable = config
            .total_amount
            .checked_sub(fee_amount)
            .ok_or(Error::Overflow)?;
        Self::_distribute(
            &env,
            &token_client,
            &token_addr,
            &contract_addr,
            &config.recipients,
            distributable,
        )?;
        config.status = SplitStatus::Executed;
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledSplit(split_id), &config);
        Ok(())
    }

    /// #915: Cancel a time-locked split. Only the owner (sender) can cancel,
    /// and only before the release_ledger timestamp is reached.
    pub fn cancel_split(env: Env, caller: Address, split_id: u64) -> Result<(), Error> {
        caller.require_auth();
        let mut config: SplitConfig = env
            .storage()
            .persistent()
            .get(&DataKey::ScheduledSplit(split_id))
            .ok_or(Error::SplitNotFound)?;
        if config.sender != caller {
            return Err(Error::NotSplitSender);
        }
        match config.status {
            SplitStatus::Cancelled => return Err(Error::SplitAlreadyCancelled),
            SplitStatus::Executed => return Err(Error::SplitAlreadyExecuted),
            SplitStatus::Pending => {}
        }
        // #915: cancellation is only allowed before the release_ledger timestamp.
        if env.ledger().timestamp() >= config.release_ledger {
            return Err(Error::SplitNotYetDue);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(
            &env.current_contract_address(),
            &config.sender,
            &config.total_amount,
        );
        config.status = SplitStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::ScheduledSplit(split_id), &config);
        env.events()
            .publish((symbol_short!("cancel"), split_id), config.sender);
        Ok(())
    }

    pub fn get_split(env: Env, split_id: u64) -> Option<SplitConfig> {
        env.storage()
            .persistent()
            .get(&DataKey::ScheduledSplit(split_id))
    }

    // ── Pull-based (claimable) splits ─────────────────────────────────────────

    pub fn split_pull(
        env: Env,
        sender: Address,
        recipients: Vec<Recipient>,
        total_amount: i128,
        affiliate: Option<Address>,
    ) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        sender.require_auth();
        let mut bps_sum: u32 = 0;
        for r in recipients.iter() {
            bps_sum = bps_sum.checked_add(r.share_bps).ok_or(Error::Overflow)?;
        }
        if bps_sum != 10_000 {
            return Err(Error::InvalidSplit);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_addr = env.current_contract_address();
        token_client.transfer(&sender, &contract_addr, &total_amount);
        let affiliate_amount = if let Some(ref affiliate_addr) = affiliate {
            let a = total_amount.checked_mul(10).ok_or(Error::Overflow)? / 10_000;
            if a > 0 {
                token_client.transfer(&contract_addr, affiliate_addr, &a);
                env.events().publish((symbol_short!("affiliate"),), a);
            }
            a
        } else {
            0
        };
        let after_affiliate = total_amount
            .checked_sub(affiliate_amount)
            .ok_or(Error::Overflow)?;
        let fee_bps: u32 = env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0);
        let fee_amount = if fee_bps > 0 {
            let f = after_affiliate
                .checked_mul(fee_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            let treasury: Address = env.storage().instance().get(&DataKey::Treasury).unwrap();
            if f > 0 {
                token_client.transfer(&contract_addr, &treasury, &f);
            }
            f
        } else {
            0
        };
        let distributable = after_affiliate
            .checked_sub(fee_amount)
            .ok_or(Error::Overflow)?;
        for r in recipients.iter() {
            let share = distributable
                .checked_mul(r.share_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if share > 0 && share < MINIMUM_PAYMENT_AMOUNT {
                return Err(Error::ShareBelowMinimum);
            }
        }
        for r in recipients.iter() {
            let share = distributable
                .checked_mul(r.share_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if share > 0 {
                Self::_credit_claimable(&env, &r.address, &token_addr, share)?;
            }
        }
        env.events()
            .publish((symbol_short!("pullsplit"),), distributable);
        Ok(())
    }

    pub fn claim_share(env: Env, caller: Address, asset: Address) -> Result<(), Error> {
        caller.require_auth();
        let key = DataKey::ClaimableBalance(caller.clone(), asset.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        env.storage().persistent().set(&key, &0i128);
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &caller, &amount);
        env.events()
            .publish((symbol_short!("claimed"), caller), amount);
        Ok(())
    }

    pub fn claimable_balance(env: Env, recipient: Address, asset: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::ClaimableBalance(recipient, asset))
            .unwrap_or(0)
    }

    // ── split_funds: #919 affiliate + #920 chunked + #922 pause guard ─────────
    //
    // #920: If recipients.len() > 50 the call processes one chunk of 50 per
    // invocation, persisting `SplitFundsNextIndex` in instance storage and
    // bumping the instance TTL so state survives across ledgers.
    // The caller must re-invoke until the function returns Ok(()) with the
    // index reset to 0 (all chunks done).
    //
    // #919: Before distributing to recipients the contract-level affiliate
    // (set via `set_affiliate`) receives their bps share, credited to their
    // `PendingWithdrawal` map entry (pull pattern).

    /// Authenticated batch transfer: sender authorizes the entire batch,
    /// asset is validated as a live token contract, and recipients must be non-empty.
    /// #926: uses try_transfer — if any transfer fails the whole tx panics (atomic rollback).
    /// #927: if whitelist-only mode is on, every recipient must be whitelisted.
    /// #917: mode=Push sends directly; mode=Pull credits claimable balances.
    pub fn split_funds(
        env: Env,
        sender: Address,
        asset: Address,
        recipients: Vec<Recipient>,
        total_amount: i128,
        mode: SplitMode,
    ) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        // #913: acquire reentrancy lock before any external token calls.
        Self::_check_and_lock(&env)?;
        sender.require_auth();
        if recipients.is_empty() {
            Self::_unlock(&env);
            return Err(Error::EmptyRecipients);
        }

        // #927: whitelist-only guard.
        let whitelist_only: bool = env
            .storage()
            .instance()
            .get(&DataKey::WhitelistOnly)
            .unwrap_or(false);
        if whitelist_only {
            for r in recipients.iter() {
                let is_wl: bool = env
                    .storage()
                    .persistent()
                    .get(&DataKey::Whitelisted(r.address.clone()))
                    .unwrap_or(false);
                if !is_wl {
                    Self::_unlock(&env);
                    return Err(Error::RecipientNotWhitelisted);
                }
            }
        }

        // #918: Cross-contract identity validation (default-strict: any failure reverts).
        if let Err(e) = Self::_check_identity_validator(&env, &recipients) {
            Self::_unlock(&env);
            return Err(e);
        }

        // #930: Verify asset is a valid SAC token.
        if let Err(e) = Self::_validate_sac_asset(&env, &asset) {
            Self::_unlock(&env);
            return Err(e);
        }
        let token_client = token::Client::new(&env, &asset);

        // ── Pre-flight: read-only balance check before any cross-contract call ─
        if let Err(e) = Self::check_balances_bulk(&env, &token_client, &sender, total_amount) {
            Self::_unlock(&env);
            return Err(e);
        }

        let contract_addr = env.current_contract_address();

        // #939: Pre-check all shares meet minimum
        for r in recipients.iter() {
            let amount = match total_amount.checked_mul(r.share_bps as i128) {
                Some(v) => v / 10_000,
                None => { Self::_unlock(&env); return Err(Error::Overflow); }
            };
            if amount > 0 && amount < MINIMUM_PAYMENT_AMOUNT {
                Self::_unlock(&env);
                return Err(Error::ShareBelowMinimum);
            }
        }

        // Pull funds from sender into contract first.
        let _ = token_client
            .try_transfer(&sender, &contract_addr, &total_amount)
            .map_err(|_| { Self::_unlock(&env); Error::TransferFailed })?;

        match mode {
            SplitMode::Push => {
                // #926: use try_transfer — panic on any failure to trigger atomic rollback.
                for r in recipients.iter() {
                    let amount = match total_amount.checked_mul(r.share_bps as i128) {
                        Some(v) => v / 10_000,
                        None => { Self::_unlock(&env); return Err(Error::Overflow); }
                    };
                    if amount > 0 {
                        let _ = token_client
                            .try_transfer(&contract_addr, &r.address, &amount)
                            .map_err(|_| { Self::_unlock(&env); Error::TransferFailed })?;
                        // #921: emit per-recipient payment event
                        emit_individual_payment(&env, &r.address, &asset, amount, r.share_bps);
                    }
                }
            }
            SplitMode::Pull => {
                // #917: credit claimable balances — recipients must call claim().
                for r in recipients.iter() {
                    let amount = match total_amount.checked_mul(r.share_bps as i128) {
                        Some(v) => v / 10_000,
                        None => { Self::_unlock(&env); return Err(Error::Overflow); }
                    };
                    if amount > 0 {
                        if let Err(e) = Self::_credit_claimable(&env, &r.address, &asset, amount) {
                            Self::_unlock(&env);
                            return Err(e);
                        }
                    }
                }
            }
        }

        // #913: release reentrancy lock after all external calls complete.
        Self::_unlock(&env);

        // #921: emit top-level split executed event after successful transfer loop
        emit_split_executed(&env, &sender, total_amount);

        Ok(())
    }

    // ── #914: Multi-asset split ───────────────────────────────────────────────

    /// Disburse multiple SAC tokens to their respective recipient lists in a
    /// single transaction. Each `AssetGroup` is validated independently:
    /// - `asset_address` must implement the Stellar token interface (pre-flight check)
    /// - `recipients` bps must sum to 10_000
    /// - `total_amount` must be positive
    ///
    /// All groups are processed atomically; if any transfer fails the whole tx reverts.
    pub fn split_multi_asset(
        env: Env,
        sender: Address,
        groups: Vec<AssetGroup>,
    ) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        sender.require_auth();

        if groups.is_empty() {
            return Err(Error::EmptyRecipients);
        }

        // ── Pre-flight: validate every group before any state change ──────────
        for group in groups.iter() {
            if group.total_amount <= 0 {
                return Err(Error::InsufficientFunds);
            }
            // Verify asset_address implements TokenInterface (symbol() call).
            Self::_validate_sac_asset(&env, &group.asset_address)?;

            let mut bps_sum: u32 = 0;
            for r in group.recipients.iter() {
                bps_sum = bps_sum.checked_add(r.share_bps).ok_or(Error::Overflow)?;
            }
            if bps_sum != 10_000 {
                return Err(Error::InvalidSplit);
            }
            if group.recipients.is_empty() {
                return Err(Error::EmptyRecipients);
            }
        }

        let contract_addr = env.current_contract_address();

        // ── Execute each group atomically ─────────────────────────────────────
        for group in groups.iter() {
            let token_client = token::Client::new(&env, &group.asset_address);

            // Pull total_amount from sender into contract.
            let _ = token_client
                .try_transfer(&sender, &contract_addr, &group.total_amount)
                .map_err(|_| Error::TransferFailed)?;

            // Distribute to recipients.
            for r in group.recipients.iter() {
                let amount = group
                    .total_amount
                    .checked_mul(r.share_bps as i128)
                    .ok_or(Error::Overflow)?
                    / 10_000;
                if amount > 0 {
                    let _ = token_client
                        .try_transfer(&contract_addr, &r.address, &amount)
                        .map_err(|_| Error::TransferFailed)?;
                }
            }

            env.events().publish(
                (symbol_short!("masset"), group.asset_address.clone()),
                group.total_amount,
            );
        }

        Ok(())
    }

    /// #917: Recipient claims their claimable balance for a given asset.
    pub fn claim(env: Env, recipient: Address, asset: Address) -> Result<(), Error> {
        recipient.require_auth();
        let key = DataKey::ClaimableBalance(recipient.clone(), asset.clone());
        let amount: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        if amount <= 0 {
            return Err(Error::NothingToClaim);
        }
        env.storage().persistent().set(&key, &0i128);
        let token_client = token::Client::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &recipient, &amount);
        env.events()
            .publish((symbol_short!("claimed"), recipient), amount);
        Ok(())
    }

    // ── split_percentage ──────────────────────────────────────────────────────

    pub fn split_percentage(
        env: Env,
        sender: Address,
        asset: Address,
        total_amount: i128,
        recipients: Vec<PercentRecipient>,
    ) -> Result<(), Error> {
        Self::_require_not_paused(&env)?;
        sender.require_auth();
        if recipients.is_empty() {
            return Err(Error::EmptyRecipients);
        }
        // #930: Verify asset is a valid SAC token.
        Self::_validate_sac_asset(&env, &asset)?;
        let mut bps_sum: u32 = 0;
        for r in recipients.iter() {
            bps_sum = bps_sum.checked_add(r.bps).ok_or(Error::Overflow)?;
        }
        if bps_sum != 10_000 {
            return Err(Error::InvalidBpsSum);
        }
        let token_client = token::Client::new(&env, &asset);
        let contract_addr = env.current_contract_address();
        for i in 0..recipients.len() {
            let r = recipients.get(i).unwrap();
            let amount = total_amount
                .checked_mul(r.bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if amount > 0 && amount < MINIMUM_PAYMENT_AMOUNT {
                return Err(Error::ShareBelowMinimum);
            }
        }
        token_client.transfer(&sender, &contract_addr, &total_amount);
        env.events().publish(
            (symbol_short!("splitstrt"), sender.clone()),
            recipients.len(),
        );
        let mut total_disbursed: i128 = 0;
        let first = recipients.get(0).unwrap();
        for i in 1..recipients.len() {
            let r = recipients.get(i).unwrap();
            let amount = total_amount
                .checked_mul(r.bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if amount > 0 {
                token_client.transfer(&contract_addr, &r.address, &amount);
                env.events()
                    .publish((symbol_short!("paysent"), r.address.clone()), amount);
            }
            total_disbursed = total_disbursed.checked_add(amount).ok_or(Error::Overflow)?;
        }
        let first_base = total_amount
            .checked_mul(first.bps as i128)
            .ok_or(Error::Overflow)?
            / 10_000;
        let dust = total_amount
            .checked_sub(total_disbursed)
            .ok_or(Error::Overflow)?
            .checked_sub(first_base)
            .ok_or(Error::Overflow)?;
        let first_amount = first_base.checked_add(dust).ok_or(Error::Overflow)?;
        if first_amount > 0 {
            token_client.transfer(&contract_addr, &first.address, &first_amount);
            env.events().publish(
                (symbol_short!("paysent"), first.address.clone()),
                first_amount,
            );
        }
        Ok(())
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    pub fn is_verified(env: &Env, address: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::VerifiedUsers(address))
            .unwrap_or(false)
    }

    pub fn get_proposal(env: Env, proposal_id: u64) -> Option<Proposal> {
        env.storage()
            .persistent()
            .get(&DataKey::Proposal(proposal_id))
    }

    pub fn fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::FeeBps).unwrap_or(0)
    }

    pub fn treasury(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Treasury).unwrap()
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn council_keys(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::CouncilKeys)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn contract_state(env: Env) -> ContractState {
        env.storage()
            .instance()
            .get(&DataKey::ContractState)
            .unwrap_or(ContractState::Active)
    }

    pub fn pending_withdrawal(env: Env, addr: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::PendingWithdrawal(addr))
            .unwrap_or(0)
    }

    // ── Recovery: 5-of-7 Council ──────────────────────────────────────────────

    pub fn recovery_split(
        env: Env,
        council_signatures: Vec<Address>,
        recipients: Vec<Recipient>,
        total_amount: i128,
    ) -> Result<(), Error> {
        let council_keys: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::CouncilKeys)
            .ok_or(Error::CouncilNotSet)?;
        for signer in council_signatures.iter() {
            signer.require_auth();
        }
        if council_signatures.len() < 5 {
            return Err(Error::InsufficientCouncilSignatures);
        }
        let mut validated: u32 = 0;
        for signer in council_signatures.iter() {
            let mut count: u32 = 0;
            for other in council_signatures.iter() {
                if other == signer {
                    count += 1;
                }
            }
            if count > 1 {
                return Err(Error::DuplicateCouncilSigner);
            }
            let mut found = false;
            for key in council_keys.iter() {
                if key == signer {
                    found = true;
                    break;
                }
            }
            if !found {
                return Err(Error::InvalidCouncilSigner);
            }
            validated += 1;
        }
        if validated < 5 {
            return Err(Error::InsufficientCouncilSignatures);
        }
        let mut bps_sum: u32 = 0;
        for r in recipients.iter() {
            bps_sum = bps_sum.checked_add(r.share_bps).ok_or(Error::Overflow)?;
        }
        if bps_sum != 10_000 {
            return Err(Error::InvalidSplit);
        }
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_addr);
        let contract_addr = env.current_contract_address();
        Self::_distribute(
            &env,
            &token_client,
            &token_addr,
            &contract_addr,
            &recipients,
            total_amount,
        )?;
        env.events()
            .publish((symbol_short!("recovery"),), total_amount);
        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// #922: Revert if the contract is paused.
    fn _require_not_paused(env: &Env) -> Result<(), Error> {
        let state: ContractState = env
            .storage()
            .instance()
            .get(&DataKey::ContractState)
            .unwrap_or(ContractState::Active);
        if state == ContractState::Paused {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    // ── #913: Reentrancy guard ────────────────────────────────────────────────

    /// Acquire the reentrancy lock. Returns `Err(Reentrant)` if already locked.
    /// Must be paired with `_unlock` in every code path (including error paths).
    fn _check_and_lock(env: &Env) -> Result<(), Error> {
        let is_active: bool = env
            .storage()
            .instance()
            .get(&DataKey::Locked)
            .unwrap_or(false);
        if is_active {
            return Err(Error::Reentrant);
        }
        env.storage().instance().set(&DataKey::Locked, &true);
        Ok(())
    }

    /// Release the reentrancy lock.
    fn _unlock(env: &Env) {
        env.storage().instance().set(&DataKey::Locked, &false);
    }

    /// #930: Validate that `asset` is a live SAC-compatible token contract.
    /// Attempts a `symbol()` call; if the contract at that address doesn't
    /// implement the Stellar token interface the call will fail.
    fn _validate_sac_asset(env: &Env, asset: &Address) -> Result<(), Error> {
        let client = token::Client::new(env, asset);
        let _ = client.try_symbol().map_err(|_| Error::InvalidAsset)?;
        Ok(())
    }

    fn _require_admin(env: &Env) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAdmin)?;
        admin.require_auth();
        Ok(())
    }

    /// #918: If an identity validator is configured, cross-call it for every
    /// recipient. Returns Err(RecipientNotVerified) on the first failure,
    /// reverting the entire transaction (default-strict mode).
    fn _check_identity_validator(env: &Env, recipients: &Vec<Recipient>) -> Result<(), Error> {
        let validator_opt: Option<Address> =
            env.storage().instance().get(&DataKey::IdentityValidator);
        if let Some(validator_addr) = validator_opt {
            let client = IdentityValidatorClient::new(env, &validator_addr);
            for r in recipients.iter() {
                if !client.is_verified(&r.address) {
                    return Err(Error::RecipientNotVerified);
                }
            }
        }
        Ok(())
    }

    fn _require_quorum_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        let admins: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::QuorumAdmins)
            .ok_or(Error::NotAuthorizedAdmin)?;
        for a in admins.iter() {
            if a == *caller {
                return Ok(());
            }
        }
        Err(Error::NotAuthorizedAdmin)
    }

    /// #916: Validate that a proposal has reached quorum, mark it executed,
    /// and return its action. The `predicate` ensures the caller is using the
    /// right execution function for the proposal's action type.
    fn _consume_admin_proposal(
        env: &Env,
        caller: &Address,
        proposal_id: u64,
        predicate: impl Fn(&AdminChangeAction) -> bool,
    ) -> Result<AdminChangeAction, Error> {
        Self::_require_quorum_admin(env, caller)?;
        let mut proposal: AdminProposal = env
            .storage()
            .persistent()
            .get(&DataKey::AdminProposal(proposal_id))
            .ok_or(Error::ProposalNotFound)?;
        if proposal.executed {
            return Err(Error::AlreadyExecuted);
        }
        if !predicate(&proposal.action) {
            return Err(Error::NotAuthorizedAdmin);
        }
        if proposal.approvals.len() < proposal.threshold {
            return Err(Error::QuorumNotReached);
        }
        proposal.executed = true;
        env.storage()
            .persistent()
            .set(&DataKey::AdminProposal(proposal_id), &proposal);
        Ok(proposal.action)
    }

    fn _set_verified(env: &Env, user: &Address, status: bool) {
        env.storage()
            .persistent()
            .set(&DataKey::VerifiedUsers(user.clone()), &status);
    }

    fn _credit_claimable(
        env: &Env,
        recipient: &Address,
        asset: &Address,
        amount: i128,
    ) -> Result<(), Error> {
        let key = DataKey::ClaimableBalance(recipient.clone(), asset.clone());
        let current: i128 = env.storage().persistent().get(&key).unwrap_or(0);
        let updated = current.checked_add(amount).ok_or(Error::Overflow)?;
        env.storage().persistent().set(&key, &updated);
        Self::_bump_persistent_ttl(env, &key);
        Ok(())
    }

    fn check_balances_bulk(
        _env: &Env,
        token_client: &token::Client,
        sender: &Address,
        total_amount: i128,
    ) -> Result<(), Error> {
        let balance = token_client.balance(sender);
        if balance < total_amount {
            return Err(Error::InsufficientBalance);
        }
        Ok(())
    }

    fn _compute_split_hash(
        env: &Env,
        sender: &Address,
        recipients: &Vec<Recipient>,
        total_amount: i128,
        salt: &BytesN<32>,
    ) -> Result<BytesN<32>, Error> {
        let mut payload = soroban_sdk::Bytes::new(env);
        payload.append(&sender.to_xdr(env));
        for r in recipients.iter() {
            payload.append(&r.address.to_xdr(env));
        }
        payload.append(&soroban_sdk::Bytes::from_slice(
            env,
            &total_amount.to_be_bytes(),
        ));
        payload.append(&salt.to_xdr(env));
        Ok(env.crypto().sha256(&payload).into())
    }

    fn _distribute(
        env: &Env,
        token_client: &token::Client,
        asset: &Address,
        from: &Address,
        recipients: &Vec<Recipient>,
        distributable: i128,
    ) -> Result<(), Error> {
        for r in recipients.iter() {
            let amount = distributable
                .checked_mul(r.share_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if amount > 0 && amount < MINIMUM_PAYMENT_AMOUNT {
                return Err(Error::ShareBelowMinimum);
            }
        }
        for r in recipients.iter() {
            let amount = distributable
                .checked_mul(r.share_bps as i128)
                .ok_or(Error::Overflow)?
                / 10_000;
            if amount > 0 {
                token_client.transfer(from, &r.address, &amount);
                // #921: emit per-recipient payment event
                emit_individual_payment(env, &r.address, asset, amount, r.share_bps);
            }
        }
        env.events()
            .publish((symbol_short!("split"),), distributable);
        Ok(())
    }

    // ── #925: TTL helpers ─────────────────────────────────────────────────────

    /// Bump instance storage TTL (~1 year in ledgers at ~5s/ledger).
    fn _bump_instance_ttl(env: &Env) {
        // 6_312_000 ledgers ≈ 1 year; threshold at half that.
        env.storage().instance().extend_ttl(3_110_400, 6_220_800);
    }

    /// Bump a single persistent storage entry TTL.
    fn _bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage()
            .persistent()
            .extend_ttl(key, 3_110_400, 6_220_800);
    }
}
