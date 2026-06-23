#![no_std]
#![allow(clippy::too_many_arguments)]
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{
    contract, contractimpl, symbol_short, Address, Bytes, Env, IntoVal, Symbol, Vec,
};

mod contracterror;
mod math;
mod storage;
pub mod types;
mod v1_interface;

use contracterror::Error;
pub use types::{
    AdminTransferredEvent, BatchStreamsCreatedEvent, BeneficiaryTransferredV2Event, BpsRecipient,
    ClawbackRebalanceEvent, ContractPausedEvent, ContractState, ContractTerminatedEvent,
    ContractUnpausedEvent, DexPoolInfo, DustAccumulatedEvent, FeesWithdrawnEvent, LedgerFootprint,
    MigrationEvent, MultiAssetRecipient, NebulaEvent, Operation, OperationExecutedEvent,
    OperationScheduledEvent, PendingRateUpdate, PermitArgs, PermitPayload,
    PermitStreamCreatedEvent, ProtocolHealthV2, Recipient, SignatureStreamCreatedEvent,
    SimulationCheck, SimulationReport, SimulationResult, SplitExecutedEvent, StreamArgs,
    StreamBatchEntry, StreamCancelledV2Event, StreamClaimV2Event, StreamCreatedV2Event,
    StreamMigratedEvent, StreamParams, StreamRefilledEvent, StreamRequestApprovedEvent,
    StreamRequestExecutedEvent, StreamRequestInitiatedEvent, StreamSplitUpdatedEvent, StreamStatus,
    StreamToppedUpEvent, StreamV2, SwapResult, SwapStreamArgs, SwapStreamCreatedEvent,
    MAX_MEMO_LENGTH,
};
use v1_interface::Client as V1Client;

#[contract]
pub struct Contract;

const CONTRACT_VERSION: u32 = 2;
/// SHA-256 of the contract-metadata.json file, stored as raw bytes.
/// Avoids embedding a long URL string in the WASM binary.
const CONTRACT_METADATA_HASH: [u8; 32] = [
    0x9f, 0x86, 0xd0, 0x81, 0x88, 0x4c, 0x7d, 0x65, 0x9a, 0x2f, 0xea, 0xa0, 0xc5, 0x5a, 0xd0, 0x15,
    0xa3, 0xbf, 0x4f, 0x1b, 0x2b, 0x0b, 0x82, 0x2c, 0xd1, 0x5d, 0x6c, 0x15, 0xb0, 0xf0, 0x0a, 0x08,
];

/// Gas buffer fee per `split_multi_asset` execution (1 XLM = 10_000_000 stroops).
const GAS_FEE_PER_SPLIT_STROOPS: i128 = 10_000_000;

/// Maximum protocol fee (5%) - protects users from admin abuse (Issue #415)
pub const MAX_FEE_BPS: u32 = 500;

/// Maximum stream amount (1 Billion XLM = 1,000,000,000 * 10^7 stroops)
pub const MAX_STREAM_AMOUNT: i128 = 1_000_000_000 * 10_000_000;
/// Maximum stream flow rate (1 Million XLM/s = 1,000,000 * 10^7 stroops/s)
pub const MAX_FLOW_RATE: i128 = 1_000_000 * 10_000_000;

/// Tiered fee configuration for "Whale" discounts.
#[soroban_sdk::contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeTier {
    pub threshold: i128, // Amount in stroops to qualify for this tier
    pub fee_bps: u32,    // The fee percentage in basis points
}

#[soroban_sdk::contractclient(name = "VaultClient")]
pub trait VaultTrait {
    fn deposit(env: Env, amount: i128);
    fn withdraw(env: Env, amount: i128) -> i128; // returns actual amount withdrawn
    /// Returns the accrued interest on `principal` without withdrawing it.
    fn get_accrued_interest(env: Env, principal: i128) -> i128;
}

/// Compliance oracle interface (Issue #412).
/// The oracle must implement `is_allowed(addr) -> bool`.
/// Returning `false` means the address is on the deny-list.
#[soroban_sdk::contractclient(name = "ComplianceClient")]
pub trait ComplianceTrait {
    fn is_allowed(env: Env, addr: Address) -> bool;
}

/// Nebula-DAO governance token interface.
/// Used to query an address's token balance as a proxy for voting power.
#[soroban_sdk::contractclient(name = "DaoTokenClient")]
pub trait DaoTokenTrait {
    fn balance(env: Env, id: Address) -> i128;
}

// ----------------------------------------------------------------
// Issue #378 — Streaming Swap (DEX Integration)
// ----------------------------------------------------------------

/// Standard Soroban AMM (Automated Market Maker) interface for swap operations.
/// This trait follows the common Soroban DEX interface pattern used by StellarSwap
/// and other Soroban AMM protocols.
#[soroban_sdk::contractclient(name = "SwapClient")]
pub trait SwapTrait {
    /// Swap `amount_in` of `token_in` for `token_out`.
    /// Returns the amount of `token_out` received.
    ///
    /// # Arguments
    /// * `token_in` - Address of the token to swap from
    /// * `token_out` - Address of the token to receive
    /// * `amount_in` - Amount of token_in to swap
    /// * `min_amount_out` - Minimum amount of token_out to receive (slippage protection)
    /// * `deadline` - Unix timestamp after which the swap is invalid
    fn swap(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128;

    /// Get the expected output amount for a swap without executing it.
    /// Useful for calculating slippage and price impact.
    ///
    /// # Arguments
    /// * `token_in` - Address of the input token
    /// * `token_out` - Address of the output token
    /// * `amount_in` - Amount of token_in to swap
    ///
    /// # Returns
    /// Expected amount of token_out (before slippage)
    fn get_amount_out(env: Env, token_in: Address, token_out: Address, amount_in: i128) -> i128;

    /// Get the spot price of token_in in terms of token_out.
    ///
    /// # Arguments
    /// * `token_in` - Address of the input token
    /// * `token_out` - Address of the output token
    ///
    /// # Returns
    /// Spot price as a ratio (token_out / token_in) with appropriate decimals
    fn get_spot_price(env: Env, token_in: Address, token_out: Address) -> i128;
}

/// Oracle interface for sanctions screening (#937).
/// The contract calls `is_sanctioned` before any transfer to a recipient.
#[soroban_sdk::contractclient(name = "SanctionsOracleClient")]
pub trait SanctionsOracle {
    /// Returns `true` if `address` is on the sanctions list.
    fn is_sanctioned(env: Env, address: Address) -> bool;
}

#[contractimpl]
impl Contract {
    // ----------------------------------------------------------------
    // Init
    // ----------------------------------------------------------------

    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if storage::has_admin(&env) {
            return Err(Error::AlreadyInitialized);
        }
        storage::set_admin(&env, &admin);
        Ok(())
    }

    pub fn admin(env: Env) -> Address {
        storage::get_admin(&env)
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    pub fn metadata(env: Env) -> Bytes {
        Bytes::from_slice(&env, &CONTRACT_METADATA_HASH)
    }

    // ----------------------------------------------------------------
    // Issue #409 — Pre-Flight Simulation Helper
    // ----------------------------------------------------------------

    /// Simulate stream creation without actually creating the stream.
    ///
    /// This is a read-only dry-run that performs all validation checks
    /// that would be done during actual stream creation, but without
    /// modifying any state.
    ///
    /// Frontends can call this before showing the user a "Create Stream" button
    /// to verify the transaction will succeed.
    ///
    /// # Parameters
    /// - `args`: Stream creation arguments to validate
    ///
    /// # Returns
    /// - `SimulationReport` with detailed check results
    pub fn simulate_stream_creation(env: Env, args: StreamArgs) -> SimulationReport {
        let now = env.ledger().timestamp();

        // Check 1: Parameter validation
        let params_check = Self::simulate_validate_params(&env, &args, now);

        // Check 2: Balance verification
        let balance_check = Self::simulate_check_balance(&env, &args);

        // Check 3: Storage/footprint estimation
        let storage_check = Self::simulate_check_storage(&env);
        let footprint = Self::estimate_ledger_footprint(&env, &args);

        // Overall success is true only if all checks pass
        let would_succeed = params_check.passed && balance_check.passed && storage_check.passed;

        SimulationReport {
            would_succeed,
            balance_check,
            storage_check,
            params_check,
            footprint,
        }
    }

    /// Quick simulation that returns just success/failure.
    /// For simple UI feedback before showing detailed errors.
    ///
    /// # Returns
    /// - `true` if stream creation would succeed
    /// - `false` if it would fail
    pub fn can_create_stream(env: Env, args: StreamArgs) -> bool {
        let report = Self::simulate_stream_creation(env, args);
        report.would_succeed
    }

    /// Validate stream creation parameters without state checks.
    fn simulate_validate_params(env: &Env, args: &StreamArgs, now: u64) -> SimulationCheck {
        use soroban_sdk::String;

        // Check contract is not paused
        if storage::is_paused(env) {
            return SimulationCheck {
                passed: false,
                error_code: 11, // ContractPaused
                error_message: String::from_str(env, "Contract is paused"),
            };
        }

        // Check emergency mode
        if storage::is_emergency(env) {
            return SimulationCheck {
                passed: false,
                error_code: 41, // EmergencyMode
                error_message: String::from_str(env, "Contract in emergency mode"),
            };
        }

        // Validate time range
        if args.start_time >= args.end_time {
            return SimulationCheck {
                passed: false,
                error_code: 14, // InvalidTimeRange
                error_message: String::from_str(env, "Start time must be before end time"),
            };
        }

        if args.cliff_time < args.start_time || args.cliff_time > args.end_time {
            return SimulationCheck {
                passed: false,
                error_code: 14, // InvalidTimeRange
                error_message: String::from_str(env, "Cliff time must be between start and end"),
            };
        }

        // Validate penalty
        if args.penalty_bps > 10_000 {
            return SimulationCheck {
                passed: false,
                error_code: 30, // InvalidPenalty
                error_message: String::from_str(env, "Penalty exceeds 100%"),
            };
        }

        // Validate amount
        if args.total_amount <= 0 {
            return SimulationCheck {
                passed: false,
                error_code: 10, // BelowDustThreshold
                error_message: String::from_str(env, "Amount must be positive"),
            };
        }

        if args.total_amount > MAX_STREAM_AMOUNT {
            return SimulationCheck {
                passed: false,
                error_code: 78, // AmountOverflow
                error_message: String::from_str(env, "Amount exceeds maximum limit"),
            };
        }

        let duration = (args.end_time - args.start_time) as i128;
        if duration > 0 {
            if args.total_amount > MAX_FLOW_RATE.saturating_mul(duration) {
                return SimulationCheck {
                    passed: false,
                    error_code: 78, // AmountOverflow
                    error_message: String::from_str(env, "Flow rate exceeds maximum limit"),
                };
            }
        }

        // All validations passed
        SimulationCheck {
            passed: true,
            error_code: 0,
            error_message: String::from_str(env, ""),
        }
    }

    /// Check if sender has sufficient balance.
    fn simulate_check_balance(env: &Env, args: &StreamArgs) -> SimulationCheck {
        use soroban_sdk::String;

        // Get sender's token balance
        let token_client = soroban_sdk::token::TokenClient::new(env, &args.token);
        let sender_balance = token_client.balance(&args.sender);

        // Calculate required amount (including potential protocol fee)
        let required_amount = args.total_amount;

        // Check if asset is whitelisted (get protocol fee if configured)
        let protocol_fee_bps = storage::get_fee_bps(env) as i128;
        let fee_multiplier = 10_000 - protocol_fee_bps;
        let stream_amount = (args.total_amount * fee_multiplier) / 10_000;
        let estimated_fee = args.total_amount - stream_amount;
        let required_with_fee = args.total_amount;

        if sender_balance < required_with_fee {
            return SimulationCheck {
                passed: false,
                error_code: 64, // SimulationInsufficientBalance
                error_message: String::from_str(env, "Sender has insufficient balance"),
            };
        }

        // Check dust threshold
        let min_value = storage::get_min_value(env, &args.token);
        if stream_amount < min_value {
            return SimulationCheck {
                passed: false,
                error_code: 10, // BelowDustThreshold
                error_message: String::from_str(env, "Amount below dust threshold"),
            };
        }

        SimulationCheck {
            passed: true,
            error_code: 0,
            error_message: String::from_str(env, ""),
        }
    }

    /// Check if storage limits would be exceeded.
    fn simulate_check_storage(env: &Env) -> SimulationCheck {
        use soroban_sdk::String;

        // Estimate current storage usage
        // This is a simplified check - in production, you'd want more precise measurements

        // Soroban instance storage limit is typically around 64KB
        // Each stream entry uses approximately 200-300 bytes
        // We allow up to 10,000 streams per contract
        // At ~250 bytes per stream, that's ~2.5MB of persistent storage

        // For a conservative estimate, check if creating one more stream
        // would push us over reasonable limits
        let estimated_stream_size: u32 = 300;
        let max_streams: u32 = 10_000;

        // Get current stream count (approximation - in production, track this in storage)
        // For simulation, we estimate based on storage reads

        // Simple heuristic: if we've stored many streams, flag a warning
        // but don't fail since Soroban handles this gracefully
        SimulationCheck {
            passed: true,
            error_code: 0,
            error_message: String::from_str(env, ""),
        }
    }

    /// Estimate the ledger footprint for creating a stream.
    fn estimate_ledger_footprint(env: &Env, args: &StreamArgs) -> LedgerFootprint {
        // StreamV2 struct size estimation
        // - Address: 32 bytes each (sender, receiver, beneficiary, token) = 128 bytes
        // - i128 values: 16 bytes each (total_amount, withdrawn_amount, etc.) = ~80 bytes
        // - u64 timestamps: 8 bytes each = ~40 bytes
        // - bool flags: 1 byte each = ~4 bytes
        // - Option<Address>: 33 bytes each (discriminant + address) = ~66 bytes
        // - u32 values: 4 bytes each = ~16 bytes
        // Total estimated: ~350 bytes per stream

        let persistent_bytes: u32 = 350;

        // Instance storage (admin list, fee config, etc.)
        // Approximately 500-1000 bytes depending on configuration
        let instance_bytes: u32 = 800;

        // Estimated operations
        // - 2 reads: get_admin, get_fee_bps (if set)
        // - 3 writes: set_stream, update_stats, bump_instance
        // - 1 event emit
        let estimated_reads: u32 = 5;
        let estimated_writes: u32 = 4;

        // Event size: ~200-300 bytes for the event data
        let event_bytes: u32 = 250;

        LedgerFootprint {
            instance_bytes,
            persistent_bytes,
            estimated_reads,
            estimated_writes,
            event_bytes,
        }
    }

    // ----------------------------------------------------------------
    // Issue #407 — Bridge-In Receiver Hook
    // ----------------------------------------------------------------

    /// Handle incoming tokens from another chain (e.g., Ethereum via Allbridge).
    ///
    /// When assets arrive with "Instruction Metadata", this function parses the
    /// metadata to extract receiver_address and duration, then automatically
    /// creates a stream without requiring a second transaction from the user.
    ///
    /// Metadata format (40 bytes total):
    /// - First 32 bytes: receiver address (as Bytes)
    /// - Next 8 bytes: duration in seconds (u64, big-endian)
    ///
    /// # Parameters
    /// - `from`: The address that sent the tokens (bridge contract)
    /// - `amount`: The amount of tokens received
    /// - `metadata`: Bytes containing receiver address and duration
    ///
    /// # Returns
    /// - `Ok(stream_id)` if stream was created successfully
    /// - `Ok(0)` if no valid metadata was provided (funds still received but no stream created)
    /// - `Err(Error)` if metadata was invalid
    pub fn on_token_receive(
        env: Env,
        from: Address,
        amount: i128,
        metadata: Bytes,
    ) -> Result<u64, Error> {
        // Don't require auth for bridge callbacks - the bridge should be authorized
        // by having sent the tokens to this contract

        // Validate minimum amount
        if amount <= 0 {
            return Err(Error::InvalidBridgeMetadata);
        }

        // If no metadata or too short, just accept funds without creating stream
        // Stellar addresses encoded as strings are typically 56 characters, plus 8 bytes duration = 64 bytes
        if metadata.is_empty() || metadata.len() < 64 {
            // Just accept the funds - no auto-stream created
            return Ok(0);
        }

        // Parse metadata: first 56 bytes = receiver address, next 8 bytes = duration
        let receiver_address_bytes = metadata.slice(0..56);
        let duration_bytes = metadata.slice(56..64);

        // Parse duration from 8 bytes (big-endian u64)
        let mut arr = [0u8; 8];
        for i in 0u32..8 {
            arr[i as usize] = duration_bytes.get(i).unwrap_or(0);
        }
        let duration = u64::from_be_bytes(arr);

        // Validate duration (must be at least 1 second and not exceed 10 years)
        if duration == 0 || duration > 315_360_000 {
            return Err(Error::InvalidBridgeMetadata);
        }

        // Convert receiver address bytes to Address
        // For Stellar addresses, we need to handle them properly
        // Try to parse as a valid address from the bytes
        let receiver_address = Self::parse_address_from_bytes(&receiver_address_bytes)?;

        // Get the token address - this will be the token that was transferred
        // We need to determine which token was sent. In a bridge scenario,
        // the token contract that called this function is the token being received.
        // We'll need to get this from the environment.
        let token_address = Self::get_received_token(&env, &from)?;

        // Validate asset is whitelisted
        Self::require_asset_whitelisted(&env, &token_address)?;

        // Calculate stream times
        let now = env.ledger().timestamp();
        let start_time = now;
        let end_time = now.saturating_add(duration);

        // Create StreamArgs
        let stream_args = StreamArgs {
            sender: from.clone(), // Bridge acts as sender (has the funds)
            receiver: receiver_address.clone(),
            token: token_address,
            total_amount: amount,
            start_time,
            cliff_time: start_time, // No cliff for bridge-in streams
            end_time,
            step_duration: 0,      // Default linear stream
            multiplier_bps: 10000, // 1.0x multiplier (no escalation)
            penalty_bps: 0,        // No penalty for bridge streams
            vault_address: None,   // No yield for bridge streams initially
            yield_enabled: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0, // Unilateral cancellation
            affiliate: None,
            memo: None,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        };

        // Create the stream
        let stream_id = Self::create_stream_internal(env.clone(), stream_args)?;

        // Emit event for bridge-in stream creation
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(from.into_val(&env));
        data.push_back(receiver_address.into_val(&env));
        data.push_back(amount.into_val(&env));
        data.push_back(duration.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("bridge_in")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("bridge_in"),
                data,
            },
        );

        Ok(stream_id)
    }

    /// Parse address from bytes slice.
    /// The bytes should contain a valid Stellar address string (e.g., "G...").
    fn parse_address_from_bytes(bytes: &soroban_sdk::Bytes) -> Result<Address, Error> {
        // The metadata should contain a string like "GABC123..."
        // We'll try to extract it as a string

        // Check minimum length for a Stellar address
        if bytes.len() < 56 {
            return Err(Error::InvalidBridgeMetadata);
        }

        // For Stellar addresses encoded as strings, they're typically 56 characters
        // Starting with 'G' and containing base32 characters
        // Since we can't easily convert Bytes to String in Soroban, we need a workaround

        // Try to find a 'G' or 'C' in the bytes to locate the address start
        let mut start_idx: Option<u32> = None;
        for i in 0u32..bytes.len() {
            let b = bytes.get(i).unwrap_or(0);
            if b == b'G' || b == b'C' {
                start_idx = Some(i);
                break;
            }
        }

        let start_idx = start_idx.ok_or(Error::InvalidBridgeMetadata)?;

        // Extract up to 56 characters after 'G'
        let mut addr_str_arr = [0u8; 56];
        let mut found_end = false;
        let mut char_count = 0usize;

        for j in 0usize..56 {
            let idx = start_idx as usize + j;
            if idx >= bytes.len() as usize {
                found_end = true;
                break;
            }
            let b = bytes.get(idx as u32).unwrap_or(0);
            if b == 0 {
                found_end = true;
                break;
            }
            addr_str_arr[j] = b;
            char_count += 1;
        }

        if char_count < 56 {
            return Err(Error::InvalidBridgeMetadata);
        }

        // Create string from the array
        let addr_str = soroban_sdk::String::from_str(
            &bytes.env(),
            core::str::from_utf8(&addr_str_arr[..56]).unwrap_or(""),
        );

        Ok(Address::from_string(&addr_str))
    }

    /// Get the token address that was received.
    /// The bridge should include the token address in the metadata.
    /// For now, we use the 'from' address as the token if it's a valid token contract.
    fn get_received_token(_env: &Env, from: &Address) -> Result<Address, Error> {
        // In many bridge scenarios, the 'from' address is the token contract
        // This is a reasonable default - the bridge can pass the token as the sender
        // and we'll treat the first 32 bytes of metadata as the actual sender
        Ok(from.clone())
    }

    /// Internal create_stream logic without auth check (used by bridge)
    fn create_stream_internal(env: Env, args: StreamArgs) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        Self::require_asset_whitelisted(&env, &args.token)?;

        if args.start_time >= args.end_time
            || args.cliff_time < args.start_time
            || args.cliff_time > args.end_time
        {
            return Err(Error::InvalidTimeRange);
        }

        Self::validate_limits(args.total_amount, args.start_time, args.end_time)?;

        if args.penalty_bps > 10_000 {
            return Err(Error::InvalidPenalty);
        }

        if args.total_amount < storage::get_min_value(&env, &args.token) {
            return Err(Error::BelowDustThreshold);
        }

        // Note: Funds already transferred to contract via token callback
        // No need to do another transfer

        let stream_amount = Self::apply_protocol_fee(&env, &args.token, args.total_amount)?;

        let stream_id = storage::next_stream_id(&env);

        let stream = StreamV2 {
            sender: args.sender.clone(),
            receiver: args.receiver.clone(),
            beneficiary: args.receiver.clone(),
            token: args.token.clone(),
            total_amount: stream_amount,
            start_time: args.start_time,
            end_time: args.end_time,
            cliff_time: args.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: args.step_duration,
            multiplier_bps: args.multiplier_bps,
            penalty_bps: args.penalty_bps,
            vault_address: None,
            yield_enabled: args.yield_enabled,
            is_pending: false,
            is_recurrent: args.is_recurrent,
            cycle_duration: args.cycle_duration,
            cancellation_type: args.cancellation_type,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: args.curve_type,
        };

        storage::set_stream(&env, stream_id, &stream);
        storage::update_stats(&env, stream_amount, &args.sender, &args.receiver);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(args.sender.clone().into_val(&env));
        data.push_back(args.receiver.clone().into_val(&env));
        data.push_back(args.token.clone().into_val(&env));
        data.push_back(stream_amount.into_val(&env));
        data.push_back(args.start_time.into_val(&env));
        data.push_back(args.cliff_time.into_val(&env));
        data.push_back(args.end_time.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("create_v2")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("create_v2"),
                data,
            },
        );

        Ok(stream_id)
    }

    // ----------------------------------------------------------------
    // Issue #400 — Multi-sig Admin Handover
    // ----------------------------------------------------------------

    /// Replace the admin set and threshold.
    ///
    /// `signers` must contain at least the current threshold of existing
    /// admins so the handover itself is multi-sig protected.
    /// Internal helper for set_admins.
    fn set_admins_internal(
        env: Env,
        new_admins: Vec<Address>,
        new_threshold: u32,
    ) -> Result<(), Error> {
        // Validate new config before touching state.
        if new_threshold == 0 || new_threshold > new_admins.len() {
            return Err(Error::InvalidThreshold);
        }

        storage::set_admin_list_raw(&env, &new_admins, new_threshold);
        Ok(())
    }

    /// Return the current admin list.
    pub fn get_admins(env: Env) -> Vec<Address> {
        storage::get_admin_list(&env)
    }

    /// Return the current approval threshold.
    pub fn get_threshold(env: Env) -> u32 {
        storage::get_threshold(&env)
    }

    /// Transfer admin rights to a new address (e.g. a multisig or DAO contract).
    ///
    /// The current admin must authorise this call. The new admin becomes the
    /// sole admin with threshold = 1, ready to be promoted to a full multisig
    /// via `set_admins` if desired.
    /// Internal helper for transfer_admin.
    fn transfer_admin_internal(env: Env, new_admin: Address) -> Result<(), Error> {
        let previous_admin = storage::try_get_admin(&env)?;
        storage::set_admin(&env, &new_admin);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(previous_admin.into_val(&env));
        data.push_back(new_admin.clone().into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("adm_xfer"), new_admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("adm_xfer"),
                data,
            },
        );
        Ok(())
    }

    pub fn transfer_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        Self::transfer_admin_internal(env, new_admin)
    }

    // ----------------------------------------------------------------
    // Issue #396 — Dust Threshold
    // ----------------------------------------------------------------

    /// Return the minimum stream amount for `asset` (default: 10 XLM).
    pub fn get_min_value(env: Env, asset: Address) -> i128 {
        storage::get_min_value(&env, &asset)
    }

    /// Override the minimum for a specific asset. Admin-only.
    /// Internal helper for set_min_value.
    fn set_min_value_internal(env: Env, asset: Address, min: i128) -> Result<(), Error> {
        storage::set_min_value(&env, &asset, min);
        Ok(())
    }

    pub fn set_min_value(env: Env, asset: Address, min: i128) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        Self::set_min_value_internal(env, asset, min)
    }

    // ----------------------------------------------------------------
    // Issue #378 — DEX Configuration for Streaming Swap
    // ----------------------------------------------------------------

    /// Set the default DEX contract address for swap operations.
    /// Admin-only.
    pub fn set_dex_address(env: Env, dex_address: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_dex_address(&env, &dex_address);
        Ok(())
    }

    /// Get the configured DEX contract address.
    pub fn get_dex_address(env: Env) -> Option<Address> {
        storage::get_dex_address(&env)
    }

    /// Enable or disable swap streaming globally.
    /// Admin-only.
    pub fn set_swap_enabled(env: Env, enabled: bool) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_swap_enabled(&env, enabled);
        Ok(())
    }

    /// Check if swap streaming is enabled globally.
    pub fn is_swap_enabled(env: Env) -> bool {
        storage::is_swap_enabled(&env)
    }

    /// Set a specific DEX pool configuration for an asset pair.
    /// This allows routing through different pools for different asset pairs.
    /// Admin-only.
    pub fn set_dex_pool(
        env: Env,
        token_in: Address,
        token_out: Address,
        pool_info: DexPoolInfo,
    ) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_dex_pool(&env, &token_in, &token_out, &pool_info);
        Ok(())
    }

    /// Get the DEX pool configuration for an asset pair.
    pub fn get_dex_pool(env: Env, token_in: Address, token_out: Address) -> Option<DexPoolInfo> {
        storage::get_dex_pool(&env, &token_in, &token_out)
    }

    // ----------------------------------------------------------------
    // Issue #359 — Migration Bridge
    // ----------------------------------------------------------------

    pub fn migrate_stream(
        env: Env,
        v1_contract: Address,
        v1_stream_id: u64,
        caller: Address,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if storage::is_migration_paused(&env) {
            return Err(Error::MigrationPaused);
        }
        caller.require_auth();

        // Issue #399 — replay-attack prevention
        if storage::is_v1_migrated(&env, v1_stream_id) {
            return Err(Error::AlreadyMigrated);
        }

        let v1_client = V1Client::new(&env, &v1_contract);

        let v1_stream = v1_client
            .try_get_stream(&v1_stream_id)
            .map_err(|_| Error::UnauthorizedSender)?
            .map_err(|_| Error::UnauthorizedSender)?;

        if v1_stream.receiver != caller {
            return Err(Error::UnauthorizedSender);
        }

        if v1_stream.cancelled || v1_stream.is_frozen || v1_stream.is_paused {
            return Err(Error::StreamNotMigratable);
        }

        let now = env.ledger().timestamp();
        if now >= v1_stream.end_time {
            return Err(Error::StreamNotMigratable);
        }

        let elapsed = {
            let effective_now = now.saturating_sub(v1_stream.total_paused_duration);
            if effective_now <= v1_stream.start_time {
                0i128
            } else {
                (effective_now - v1_stream.start_time) as i128
            }
        };
        let duration = (v1_stream.end_time - v1_stream.start_time) as i128;
        let unlocked = (v1_stream.total_amount * elapsed) / duration;
        let remaining = v1_stream.total_amount - unlocked;

        if remaining <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        v1_client
            .try_cancel(&v1_stream_id, &caller)
            .map_err(|_| Error::StreamNotMigratable)?
            .map_err(|_| Error::StreamNotMigratable)?;

        let v2_stream_id = storage::next_stream_id(&env);

        let v2_stream = StreamV2 {
            sender: v1_stream.sender.clone(),
            receiver: caller.clone(),
            beneficiary: caller.clone(), // Initial beneficiary is the receiver
            token: v1_stream.token.clone(),
            total_amount: remaining,
            start_time: now,
            end_time: v1_stream.end_time,
            cliff_time: now, // migrated streams have no cliff in V2
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: true,
            v1_stream_id,
            step_duration: 0,
            multiplier_bps: 0,
            penalty_bps: 0,
            vault_address: None,
            yield_enabled: false,
            is_pending: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        };

        storage::set_stream(&env, v2_stream_id, &v2_stream);
        storage::update_stats(&env, remaining, &v1_stream.sender, &caller);
        // Issue #399 — record migration so the same V1 stream cannot be migrated again
        storage::mark_v1_migrated(&env, v1_stream_id);

        let mut data = Vec::new(&env);
        data.push_back(v2_stream_id.into_val(&env));
        data.push_back(v1_stream_id.into_val(&env));
        data.push_back(caller.clone().into_val(&env));
        data.push_back(remaining.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (v2_stream_id, symbol_short!("migrated")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("migrated"),
                data,
            },
        );

        Ok(v2_stream_id)
    }

    /// Core "Bridge" function for atomic V1->V2 migration. #398
    /// Simultaneously deactivates a V1 stream and activates it in V2.
    /// Auth: receiver.require_auth()
    pub fn migrate_v1_stream(
        env: Env,
        v1_contract: Address,
        v1_id: soroban_sdk::Symbol,
        caller: Address,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if storage::is_migration_paused(&env) {
            return Err(Error::MigrationPaused);
        }

        // 1. Get the caller (receiver)
        caller.require_auth();

        // 2. Convert Symbol to u64 (ID)
        // Note: For hackathon/simplicity, we assume the Symbol matches the numeric ID.
        // In production, this would use a more robust parsing utility.
        let v1_stream_id = Self::parse_symbol_to_u64(&v1_id);

        // Issue #399 — replay-attack prevention
        if storage::is_v1_migrated(&env, v1_stream_id) {
            return Err(Error::AlreadyMigrated);
        }

        let v1_client = V1Client::new(&env, &v1_contract);

        // 3. Fetch V1 stream info for the new V2 record
        let v1_stream = v1_client
            .try_get_stream(&v1_stream_id)
            .map_err(|_| Error::StreamNotFound)?
            .map_err(|_| Error::StreamNotFound)?;

        if v1_stream.receiver != caller {
            return Err(Error::UnauthorizedSender);
        }

        // 4. Action 1: Call V1.cancel_stream(v1_id)
        // This transfers funds to `caller` (receiver) and returns the balance.
        let remaining_balance = v1_client
            .try_cancel_stream(&v1_stream_id, &caller)
            .map_err(|_| Error::StreamNotMigratable)?
            .map_err(|_| Error::StreamNotMigratable)?;

        if remaining_balance <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        // 5. Pull the released funds from the receiver into the V2 contract.
        let token_client = soroban_sdk::token::TokenClient::new(&env, &v1_stream.token);
        token_client.transfer(&caller, &env.current_contract_address(), &remaining_balance);

        // 6. Action 2: Activate it in V2
        let v2_stream_id = storage::next_stream_id(&env);
        let now = env.ledger().timestamp();

        let v2_stream = StreamV2 {
            sender: v1_stream.sender.clone(),
            receiver: caller.clone(),
            beneficiary: caller.clone(),
            token: v1_stream.token.clone(),
            total_amount: remaining_balance,
            start_time: now,
            end_time: v1_stream.end_time,
            cliff_time: now,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: true,
            v1_stream_id,
            step_duration: 0,
            multiplier_bps: 0,
            penalty_bps: 0,
            vault_address: None,
            yield_enabled: false,
            is_pending: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        };

        storage::set_stream(&env, v2_stream_id, &v2_stream);
        storage::update_stats(&env, remaining_balance, &v1_stream.sender, &caller);
        // Issue #399 — record migration so the same V1 stream cannot be migrated again
        storage::mark_v1_migrated(&env, v1_stream_id);

        // Emit standardized Nebula migration event
        let mut data = Vec::new(&env);
        data.push_back(v2_stream_id.into_val(&env));
        data.push_back(v1_stream_id.into_val(&env));
        data.push_back(caller.clone().into_val(&env));
        data.push_back(remaining_balance.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (v2_stream_id, symbol_short!("migrated")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("migrated"),
                data,
            },
        );

        Ok(v2_stream_id)
    }

    fn parse_symbol_to_u64(sym: &soroban_sdk::Symbol) -> u64 {
        // Fallback for demo: use the Symbol's internal value if it's treated as a short ID
        // or just return 0 for now. In a real project, we'd use soroban_sdk::Symbol::to_string()
        // if alloc was enabled, or iterate bytes.
        0
    }

    pub fn get_stream(env: Env, stream_id: u64) -> Option<StreamV2> {
        storage::get_stream(&env, stream_id)
    }

    pub fn get_streams_batch(env: Env, ids: Vec<u64>) -> Result<Vec<StreamBatchEntry>, Error> {
        if ids.len() > 25 {
            return Err(Error::BatchTooLarge);
        }

        let mut results = Vec::new(&env);
        let now_nanos = Self::ledger_timestamp_nanos(&env);
        let now = env.ledger().timestamp();

        for id in ids.iter() {
            if let Some(stream) = storage::get_stream(&env, id) {
                let unlocked = Self::calculate_unlocked_internal(&stream, now_nanos);
                let remaining_unlocked = unlocked.saturating_sub(stream.withdrawn_amount);

                let status = if stream.cancelled {
                    StreamStatus::Cancelled
                } else if now >= stream.end_time {
                    StreamStatus::Completed
                } else {
                    StreamStatus::Active
                };

                results.push_back(StreamBatchEntry {
                    stream_id: id,
                    unlocked_amount: remaining_unlocked,
                    status,
                });
            } else {
                results.push_back(StreamBatchEntry {
                    stream_id: id,
                    unlocked_amount: 0,
                    status: StreamStatus::NotFound,
                });
            }
        }

        Ok(results)
    }

    pub fn get_v2_protocol_health(env: Env) -> types::ProtocolHealthV2 {
        storage::get_health(&env)
    }

    /// Predict the exact balance at a future timestamp for a given stream.
    ///
    /// This function is useful for "Stellar Glass" projection charts that need to
    /// visualize future stream balances. It accounts for cliffs and exponential curves
    /// defined in the stream configuration.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream to predict
    /// - `future_timestamp`: The future timestamp to predict the balance at
    ///
    /// # Returns
    /// - `Ok(i128)`: The predicted unlocked balance at the future timestamp
    /// - `Err(Error::StreamNotFound)`: If the stream does not exist
    ///
    /// # Example
    /// ```ignore
    /// let predicted = contract.predict_balance_at(&env, &stream_id, &future_time)?;
    /// ```
    pub fn predict_balance_at(
        env: Env,
        stream_id: u64,
        future_timestamp: u64,
    ) -> Result<i128, Error> {
        let stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;
        Ok(Self::calculate_unlocked_internal(
            &stream,
            future_timestamp * math::NANOS_PER_SEC,
        ))
    }

    // ----------------------------------------------------------------
    // Stream Operations (Issue #363 — Escalating Rates)
    // ----------------------------------------------------------------

    /// Withdraw unlocked funds from a stream.
    ///
    /// # Token Security Assumptions
    ///
    /// This function assumes the token implements the Soroban Token Interface
    /// (SAC-compliant). The following token behaviors are NOT protected against:
    ///
    /// - **Malicious tokens**: Tokens that violate the standard interface
    /// - **Fee-on-transfer tokens**: Tokens that deduct fees during transfer
    /// - **Rebasing tokens**: Tokens that automatically adjust balances
    /// - **Transfer restrictions**: Tokens that enforce transfer restrictions
    ///
    /// **Only the stream beneficiary can withdraw.** The beneficiary is the
    /// receiver address set during stream creation, unless changed via
    /// `transfer_beneficiary()`.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream to withdraw from
    /// - `beneficiary`: The address receiving the withdrawn funds (must be the stream beneficiary)
    ///
    /// # Returns
    /// - `Ok(amount)`: The amount withdrawn
    /// - `Err(Error)`: If validation fails or stream is not in withdrawable state
    ///
    /// # Errors
    /// - `ContractPaused`: If the contract is paused
    /// - `StreamNotFound`: If the stream does not exist
    /// - `NotBeneficiary`: If the caller is not the stream beneficiary
    /// - `AlreadyCancelled`: If the stream has been cancelled
    /// - `NothingToWithdraw`: If no funds are unlocked
    pub fn withdraw(env: Env, stream_id: u64, beneficiary: Address) -> Result<i128, Error> {
        Self::require_not_paused_only(&env)?;
        beneficiary.require_auth();

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.beneficiary != beneficiary {
            return Err(Error::UnauthorizedSender);
        }

        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        // Compliance oracle check (Issue #412)
        Self::require_compliant(&env, &stream.beneficiary)?;

        let now = env.ledger().timestamp();
        let to_withdraw =
            Self::calculate_unlocked_internal(&stream, Self::ledger_timestamp_nanos(&env))
                .saturating_sub(stream.withdrawn_amount);

        if to_withdraw <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        // If Yield-Bearing, withdraw principal from Vault
        if let Some(vault_addr) = &stream.vault_address {
            let vault_client = VaultClient::new(&env, vault_addr);
            let result = vault_client.try_withdraw(&to_withdraw);
            if result.is_err() {
                // Vault withdrawal failed — mark stream as pending for manual resolution
                stream.is_pending = true;
                storage::set_stream(&env, stream_id, &stream);
                // Return Ok(0) to persist the 'is_pending' state change.
                // Returning Err automatically rolls back state in Soroban.
                return Ok(0);
            }

            // Route accrued interest to the designated yield_recipient (Issue #410)
            let interest = vault_client.get_accrued_interest(&to_withdraw);
            if interest > 0 {
                let interest_dest = match stream.yield_recipient {
                    0 => stream.sender.clone(),
                    2 => storage::get_treasury(&env).unwrap_or(stream.sender.clone()),
                    _ => stream.beneficiary.clone(), // 1 = Receiver (default)
                };
                let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);
                token_client.transfer(&env.current_contract_address(), &interest_dest, &interest);
            }
        }

        // Perform transfer
        // Sanctions check (#937)
        Self::check_not_sanctioned(&env, &stream.beneficiary)?;
        // Claim window check (#934): if terminated, only allow within 90-day window.
        if storage::get_contract_state(&env) == ContractState::Terminated {
            let deadline = storage::get_claim_deadline(&env).unwrap_or(0);
            if env.ledger().timestamp() > deadline {
                return Err(Error::ExpiredDeadline);
            }
        }
        let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);
        let to_beneficiary = if stream.split_bps > 0 {
            if let Some(ref split_addr) = stream.split_address.clone() {
                let calc_numerator = to_withdraw * stream.split_bps as i128;
                let split_amount = calc_numerator / 10_000;
                let dust_amount = calc_numerator % 10_000;
                let remainder = to_withdraw - split_amount;

                if split_amount > 0 {
                    token_client.transfer(
                        &env.current_contract_address(),
                        split_addr,
                        &split_amount,
                    );
                }

                if dust_amount > 0 {
                    let now = env.ledger().timestamp();
                    let mut dust_data: Vec<soroban_sdk::Val> = Vec::new(&env);
                    dust_data.push_back(stream_id.into_val(&env));
                    dust_data.push_back(stream.token.clone().into_val(&env));
                    dust_data.push_back(split_addr.clone().into_val(&env));
                    dust_data.push_back(stream.split_bps.into_val(&env));
                    dust_data.push_back(to_withdraw.into_val(&env));
                    dust_data.push_back(split_amount.into_val(&env));
                    dust_data.push_back(dust_amount.into_val(&env));
                    dust_data.push_back(now.into_val(&env));
                    env.events().publish(
                        (stream_id, symbol_short!("dust")),
                        DustAccumulatedEvent {
                            stream_id,
                            token: stream.token.clone(),
                            split_address: split_addr.clone(),
                            split_bps: stream.split_bps,
                            to_withdraw,
                            split_amount,
                            dust_amount,
                            timestamp: now,
                        },
                    );
                }

                remainder
            } else {
                to_withdraw
            }
        } else {
            to_withdraw
        };

        token_client.transfer(
            &env.current_contract_address(),
            &stream.beneficiary,
            &to_beneficiary,
        );

        // Update state
        stream.withdrawn_amount += to_withdraw;
        stream.is_pending = false; // Successfully withdrawn, any previous pending status cleared
        storage::set_stream(&env, stream_id, &stream);

        // Update analytics (TVL decreased)
        storage::update_stats(&env, -to_withdraw, &stream.sender, &stream.receiver);

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(stream.beneficiary.clone().into_val(&env));
        data.push_back(to_withdraw.into_val(&env));
        data.push_back(stream.withdrawn_amount.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("claim")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("claim"),
                data,
            },
        );

        Ok(to_withdraw)
    }

    // ----------------------------------------------------------------
    // Issue #391 — Meta-Transaction "Gasless" Withdrawals
    // ----------------------------------------------------------------

    /// Withdraw from a stream using a signed message, allowing a relayer to
    /// pay the gas fee in exchange for a small fee in the streamed asset.
    ///
    /// The receiver signs a "Withdrawal Intent" off-chain containing:
    /// - stream_id, withdrawal_amount, relayer_fee, nonce, deadline
    ///
    /// The relayer (env.invoker()) submits the transaction and receives
    /// `relayer_fee` from the withdrawn amount. The receiver gets the rest.
    ///
    /// # Parameters
    /// - `stream_id`: The stream to withdraw from
    /// - `withdrawal_amount`: Total amount to withdraw (must be <= unlocked)
    /// - `relayer_fee`: Fee paid to the relayer (must be < withdrawal_amount)
    /// - `nonce`: Unique nonce to prevent replay attacks
    /// - `deadline`: Unix timestamp after which the signature expires
    /// - `signature`: Ed25519 signature from the receiver's public key
    pub fn withdraw_meta(
        env: Env,
        stream_id: u64,
        withdrawal_amount: i128,
        relayer_fee: i128,
        relayer: Address,
        beneficiary_pubkey: soroban_sdk::BytesN<32>,
        nonce: u64,
        deadline: u64,
        signature: soroban_sdk::BytesN<64>,
    ) -> Result<i128, Error> {
        Self::require_not_paused_only(&env)?;

        // Claim window check (#934): if terminated, only allow within 90-day window.
        if storage::get_contract_state(&env) == ContractState::Terminated {
            let deadline = storage::get_claim_deadline(&env).unwrap_or(0);
            if env.ledger().timestamp() > deadline {
                return Err(Error::ExpiredDeadline);
            }
        }

        let now = env.ledger().timestamp();
        if now > deadline {
            return Err(Error::ExpiredDeadline);
        }

        if relayer_fee < 0 || relayer_fee >= withdrawal_amount {
            return Err(Error::InvalidRelayerFee);
        }

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        // Verify nonce to prevent replay attacks
        let nonce_key = (
            symbol_short!("W_NONCE"),
            stream.beneficiary.clone(),
            stream_id,
        );
        let stored_nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0u64);

        if nonce != stored_nonce {
            return Err(Error::InvalidNonce);
        }

        // Calculate unlocked amount (Issue #403 — nanosecond domain)
        let unlocked =
            Self::calculate_unlocked_internal(&stream, Self::ledger_timestamp_nanos(&env));
        let available = unlocked.saturating_sub(stream.withdrawn_amount);

        if withdrawal_amount > available {
            return Err(Error::NothingToWithdraw);
        }

        if withdrawal_amount <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        // Construct the message that was signed
        let mut msg = soroban_sdk::Bytes::new(&env);
        msg.extend_from_slice(b"STELLARSTREAM_WITHDRAW_META_V2");
        msg.append(&env.current_contract_address().to_xdr(&env));
        msg.extend_from_slice(&stream_id.to_be_bytes());
        msg.extend_from_slice(&withdrawal_amount.to_be_bytes());
        msg.extend_from_slice(&relayer_fee.to_be_bytes());
        msg.extend_from_slice(&nonce.to_be_bytes());
        msg.extend_from_slice(&deadline.to_be_bytes());

        let msg_hash: soroban_sdk::BytesN<32> = env.crypto().sha256(&msg).into();

        // Use the provided beneficiary public key for signature verification
        let beneficiary_pubkey = beneficiary_pubkey.clone();

        // Verify the signature
        env.crypto()
            .ed25519_verify(&beneficiary_pubkey, &msg_hash.into(), &signature);

        // Increment nonce to prevent replay
        env.storage()
            .instance()
            .set(&nonce_key, &(stored_nonce + 1));

        // If Yield-Bearing, withdraw principal from Vault
        if stream.yield_enabled {
            if let Some(vault_addr) = &stream.vault_address {
                let vault_client = VaultClient::new(&env, vault_addr);
                let result = vault_client.try_withdraw(&withdrawal_amount);

                if result.is_err() {
                    stream.is_pending = true;
                    storage::set_stream(&env, stream_id, &stream);
                    return Ok(0);
                }
            }
        }

        // Calculate amounts
        let to_receiver = withdrawal_amount - relayer_fee;

        // Perform transfers
        let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);

        if to_receiver > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.beneficiary,
                &to_receiver,
            );
        }

        if relayer_fee > 0 {
            token_client.transfer(&env.current_contract_address(), &relayer, &relayer_fee);
        }

        // Update state
        stream.withdrawn_amount += withdrawal_amount;
        stream.is_pending = false;
        storage::set_stream(&env, stream_id, &stream);

        // Update analytics (TVL decreased)
        storage::update_stats(&env, -withdrawal_amount, &stream.sender, &stream.receiver);

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(stream.beneficiary.clone().into_val(&env));
        data.push_back(to_receiver.into_val(&env));
        data.push_back(relayer_fee.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("meta_wdrw")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("meta_wdrw"),
                data,
            },
        );

        Ok(withdrawal_amount)
    }

    /// Cancel a stream and distribute funds to sender and receiver.
    ///
    /// # Token Security Assumptions
    ///
    /// This function assumes the token implements the Soroban Token Interface
    /// (SAC-compliant). The following token behaviors are NOT protected against:
    ///
    /// - **Malicious tokens**: Tokens that violate the standard interface
    /// - **Fee-on-transfer tokens**: Tokens that deduct fees during transfer
    /// - **Rebasing tokens**: Tokens that automatically adjust balances
    /// - **Transfer restrictions**: Tokens that enforce transfer restrictions
    ///
    /// **Cancellation type determines who can cancel:**
    /// - Unilateral (type=0): Either sender or receiver can cancel
    /// - Mutual (type=1): Both sender AND receiver must authorize
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream to cancel
    /// - `caller`: The address initiating the cancellation
    ///
    /// # Returns
    /// - `Ok(())`: If cancellation succeeds
    /// - `Err(Error)`: If validation fails or caller is not authorized
    ///
    /// # Errors
    /// - `ContractPaused`: If the contract is paused
    /// - `StreamNotFound`: If the stream does not exist
    /// - `AlreadyCancelled`: If the stream has already been cancelled
    /// - `NotStreamOwner`: If the caller is not authorized to cancel
    pub fn cancel(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        // Authorization: mutual (type=1) requires both sender AND receiver to sign;
        // unilateral (type=0, default) only requires the initiating party.
        if stream.cancellation_type == 1 {
            stream.sender.require_auth();
            stream.receiver.require_auth();
        } else {
            if stream.sender != caller && stream.beneficiary != caller {
                return Err(Error::UnauthorizedSender);
            }
            caller.require_auth();
        }

        let now = env.ledger().timestamp();
        let unlocked =
            Self::calculate_unlocked_internal(&stream, Self::ledger_timestamp_nanos(&env));
        let earned = unlocked.saturating_sub(stream.withdrawn_amount);
        let sender_remaining = stream.total_amount.saturating_sub(unlocked);

        // Apply breakup penalty if the sender is cancelling and penalty_bps > 0.
        let penalty = if caller == stream.sender && stream.penalty_bps > 0 {
            (sender_remaining * stream.penalty_bps as i128) / 10_000
        } else {
            0
        };

        let to_receiver = earned + penalty;
        let to_sender = sender_remaining.saturating_sub(penalty);
        let total_remaining = to_receiver + to_sender;

        // If Yield-Bearing, withdraw total remaining from Vault
        if stream.yield_enabled {
            if let Some(vault_addr) = &stream.vault_address {
                let vault_client = VaultClient::new(&env, vault_addr);
                let result = vault_client.try_withdraw(&total_remaining);

                if result.is_err() {
                    stream.is_pending = true;
                    storage::set_stream(&env, stream_id, &stream);
                    return Err(Error::ContractPaused);
                }
            }
        }

        stream.withdrawn_amount = unlocked;
        stream.cancelled = true;
        storage::set_stream(&env, stream_id, &stream);

        // Sanctions check (#937): query oracle for each recipient before transferring.
        Self::check_not_sanctioned(&env, &stream.beneficiary)?;
        Self::check_not_sanctioned(&env, &stream.sender)?;

        let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);
        if to_receiver > 0 {
            token_client.transfer(
                &env.current_contract_address(),
                &stream.beneficiary,
                &to_receiver,
            );
        }
        if to_sender > 0 {
            token_client.transfer(&env.current_contract_address(), &stream.sender, &to_sender);
        }

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(caller.clone().into_val(&env));
        data.push_back(to_receiver.into_val(&env));
        data.push_back(to_sender.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("cancel")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("cancel"),
                data,
            },
        );

        Ok(())
    }

    /// Archive and recover storage rent for a fully-withdrawn stream (Issue #380).
    /// Only callable by stream sender or beneficiary.
    /// Frees persistent storage bytes, returning rent to the caller.
    pub fn close_and_archive(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.sender != caller && stream.beneficiary != caller {
            return Err(Error::UnauthorizedSender);
        }
        caller.require_auth();

        if stream.withdrawn_amount != stream.total_amount {
            return Err(Error::StreamNotFullyWithdrawn);
        }

        let key = storage::DataKeyV2::Stream(stream_id);
        env.storage().persistent().remove(&key);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(stream.total_amount.into_val(&env));
        data.push_back(stream.withdrawn_amount.into_val(&env));
        data.push_back(caller.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("archived")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("archived"),
                data,
            },
        );

        Ok(())
    }

    pub fn transfer_beneficiary(
        env: Env,
        stream_id: u64,
        new_beneficiary: Address,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        stream.beneficiary.require_auth();

        let previous_beneficiary = stream.beneficiary.clone();
        stream.beneficiary = new_beneficiary.clone();

        storage::set_stream(&env, stream_id, &stream);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(previous_beneficiary.into_val(&env));
        data.push_back(new_beneficiary.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("benefic")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("benefic"),
                data,
            },
        );

        Ok(())
    }

    // ----------------------------------------------------------------
    // Issue #411 — Stream-Splitting
    // ----------------------------------------------------------------

    /// Set or update the split configuration for a stream.
    /// Only the current beneficiary may call this.
    /// Pass `split_address = None` and `split_bps = 0` to remove an existing split.
    pub fn split_stream(
        env: Env,
        stream_id: u64,
        split_address: Option<Address>,
        split_bps: u32,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        if split_bps >= 10_000 {
            return Err(Error::InvalidPenalty);
        }

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        stream.beneficiary.require_auth();

        stream.split_address = split_address.clone();
        stream.split_bps = split_bps;
        storage::set_stream(&env, stream_id, &stream);

        let now = env.ledger().timestamp();
        env.events().publish(
            (stream_id, symbol_short!("split")),
            StreamSplitUpdatedEvent {
                stream_id,
                beneficiary: stream.beneficiary,
                split_address,
                split_bps,
                timestamp: now,
            },
        );

        Ok(())
    }

    /// Calculate the unlocked token amount for a stream at time `now_nanos`.
    ///
    /// `now_nanos` must be in **nanoseconds** (use `ledger_timestamp_nanos`).
    /// Stream times (`start_time`, `end_time`, `cliff_time`) are stored in
    /// seconds and are converted to nanoseconds internally. This ensures the
    /// function is forward-compatible with true sub-second ledger timestamps:
    /// when the SDK exposes `timestamp_nanos()`, only `ledger_timestamp_nanos`
    /// needs updating — the arithmetic here is already in the nanosecond domain.
    fn calculate_unlocked_internal(stream: &StreamV2, now_nanos: u64) -> i128 {
        let nps = math::NANOS_PER_SEC;
        let cliff_nanos = stream.cliff_time * nps;
        let start_nanos = stream.start_time * nps;
        let end_nanos = stream.end_time * nps;

        if now_nanos < cliff_nanos || now_nanos <= start_nanos {
            return 0;
        }
        if now_nanos >= end_nanos {
            return stream.total_amount;
        }
        if stream.cancelled {
            return stream.total_amount;
        }

        let elapsed = (now_nanos - start_nanos) as i128;
        let duration = (end_nanos - start_nanos) as i128;

        if stream.step_duration > 0 {
            // step_duration is in seconds; convert to nanos for consistent units.
            let step_duration_nanos = stream.step_duration * nps as i128;
            let n_steps = (elapsed / step_duration_nanos) as u32;
            let delta_t = elapsed % step_duration_nanos;

            let m_bps = stream.multiplier_bps;
            let q_bps = 10000 + m_bps;

            let total_steps = (duration / step_duration_nanos) as u32;

            let q_pow_total = Self::power_scale(q_bps, total_steps);
            let q_pow_n = Self::power_scale(q_bps, n_steps);

            let scale = 1_000_000_000_i128;

            let term1 = (q_pow_n - scale) * step_duration_nanos;
            let term2 = (q_pow_n * delta_t * m_bps) / 10000;

            let numerator = stream.total_amount * (term1 + term2);
            let denominator = (q_pow_total - scale) * step_duration_nanos;

            if denominator <= 0 {
                // Degenerate escalating config — fall back to smooth linear flow.
                return math::calculate_flow(stream.total_amount, duration, elapsed);
            }

            numerator / denominator
        } else if stream.curve_type == 1 {
            // Exponential (back-loaded): unlocked = total * (elapsed / duration)^2
            math::calculate_exponential_unlocked(stream.total_amount, duration, elapsed)
        } else {
            // Issue #403 — Smooth-Flow: use calculate_flow (backed by mul_div)
            // for overflow-safe, precision-preserving linear unlocking.
            math::calculate_flow(stream.total_amount, duration, elapsed)
        }
    }

    fn power_scale(q_bps: i128, n: u32) -> i128 {
        let mut res = 1_000_000_000_i128;
        let mut base = q_bps;
        let mut exp = n;
        while exp > 0 {
            if exp % 2 == 1 {
                res = (res * base) / 10000;
            }
            base = (base * base) / 10000;
            exp /= 2;
        }
        res
    }

    /// Add additional funds to an existing stream.
    ///
    /// # Token Security Assumptions
    ///
    /// This function assumes the token implements the Soroban Token Interface
    /// (SAC-compliant). The following token behaviors are NOT protected against:
    ///
    /// - **Malicious tokens**: Tokens that violate the standard interface
    /// - **Fee-on-transfer tokens**: Tokens that deduct fees during transfer
    /// - **Rebasing tokens**: Tokens that automatically adjust balances
    /// - **Transfer restrictions**: Tokens that enforce transfer restrictions
    ///
    /// **Only the stream sender can top-up.** The additional funds are
    /// transferred from the sender to the contract, and the stream's
    /// `end_time` is extended proportionally to maintain the same rate.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream to top-up
    /// - `sender`: The address adding funds (must be the stream sender)
    /// - `extra_amount`: The amount to add (must be > 0)
    ///
    /// # Returns
    /// - `Ok(())`: If top-up succeeds
    /// - `Err(Error)`: If validation fails or sender is not authorized
    ///
    /// # Errors
    /// - `ContractPaused`: If the contract is paused
    /// - `StreamNotFound`: If the stream does not exist
    /// - `NotStreamOwner`: If the caller is not the stream sender
    /// - `AlreadyCancelled`: If the stream has been cancelled
    /// - `BelowDustThreshold`: If the extra amount is <= 0
    pub fn top_up(
        env: Env,
        stream_id: u64,
        sender: Address,
        extra_amount: i128,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        Self::require_not_emergency(&env)?;
        sender.require_auth();

        if extra_amount <= 0 {
            return Err(Error::BelowDustThreshold);
        }

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if stream.sender != sender {
            return Err(Error::UnauthorizedSender);
        }

        let new_total_amount = stream
            .total_amount
            .checked_add(extra_amount)
            .ok_or(Error::Overflow)?;
        if new_total_amount > MAX_STREAM_AMOUNT {
            return Err(Error::AmountOverflow);
        }

        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        let now = env.ledger().timestamp();

        // Checkpoint: calculate what's already unlocked so the rate stays consistent.
        let unlocked_at_now =
            Self::calculate_unlocked_internal(&stream, Self::ledger_timestamp_nanos(&env));
        let remaining = stream.total_amount.saturating_sub(unlocked_at_now);

        // Pull the new funds into the contract.
        let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);
        token_client.transfer(&sender, &env.current_contract_address(), &extra_amount);

        // Extend end_time proportionally: keep the same rate over the new remaining balance.
        let duration = (stream.end_time - stream.start_time) as i128;
        let new_remaining = remaining + extra_amount;
        let rate = stream.total_amount; // tokens per `duration` seconds
                                        // new_end_time = now + (new_remaining * duration / rate)
        let extra_seconds = (new_remaining * duration) / rate;
        let new_end_time = now + extra_seconds as u64;

        stream.total_amount += extra_amount;
        stream.end_time = new_end_time;
        storage::set_stream(&env, stream_id, &stream);

        // Update TVL.
        storage::update_stats(&env, extra_amount, &stream.sender, &stream.receiver);

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(sender.clone().into_val(&env));
        data.push_back(extra_amount.into_val(&env));
        data.push_back(stream.total_amount.into_val(&env));
        data.push_back(new_end_time.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("top_up")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("top_up"),
                data,
            },
        );

        Ok(())
    }

    pub fn bump_active_streams_ttl(env: Env, ids: Vec<u64>) -> u32 {
        storage::bump_streams_ttl(&env, &ids)
    }

    // ----------------------------------------------------------------
    // Governance: Stream-Weighted Voting Power
    // ----------------------------------------------------------------

    /// Calculate the total value currently locked in active streams for a user.
    /// This represents the user's "skin in the game" for governance purposes.
    pub fn get_active_volume(env: Env, user: Address) -> i128 {
        let total_streams = storage::get_health(&env).total_v2_streams;
        let mut total_locked: i128 = 0;

        for i in 0..total_streams {
            if let Some(stream) = storage::get_stream(&env, i) {
                if !stream.cancelled {
                    if stream.sender == user || stream.receiver == user {
                        let locked = stream.total_amount.saturating_sub(stream.withdrawn_amount);
                        total_locked = total_locked.saturating_add(locked);
                    }
                }
            }
        }
        total_locked
    }

    pub fn pause(env: Env) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        storage::set_paused(&env, true);
        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(admin.clone().into_val(&env));
        data.push_back(now.into_val(&env));
        env.events().publish(
            (symbol_short!("pause"), admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("pause"),
                data,
            },
        );
        Ok(())
    }

    pub fn unpause(env: Env) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        storage::set_paused(&env, false);
        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(admin.clone().into_val(&env));
        data.push_back(now.into_val(&env));
        env.events().publish(
            (symbol_short!("unpause"), admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("unpause"),
                data,
            },
        );
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    // ----------------------------------------------------------------
    // Issue #934 — Decommission / Self-Destruct Logic
    // ----------------------------------------------------------------

    /// Permanently terminates the contract. After this call:
    /// - All state-mutating operations (create, cancel, migrate, etc.) are blocked.
    /// - `withdraw` remains callable for 90 days so users can pull remaining funds.
    pub fn decommission_contract(env: Env) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();

        storage::set_contract_state(&env, &ContractState::Terminated);
        let claim_deadline = env.ledger().timestamp() + storage::CLAIM_WINDOW_SECS;
        storage::set_claim_deadline(&env, claim_deadline);

        env.events().publish(
            (symbol_short!("decomm"), admin.clone()),
            ContractTerminatedEvent {
                admin,
                claim_deadline,
                timestamp: env.ledger().timestamp(),
            },
        );
        Ok(())
    }

    pub fn get_contract_state(env: Env) -> ContractState {
        storage::get_contract_state(&env)
    }

    pub fn get_claim_deadline(env: Env) -> Option<u64> {
        storage::get_claim_deadline(&env)
    }

    // ----------------------------------------------------------------
    // Issue #937 — Sanctions Oracle Interface
    // ----------------------------------------------------------------

    /// Set the address of the external sanctions oracle. Admin-only.
    pub fn set_oracle_address(env: Env, oracle: Address) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        storage::set_oracle_address(&env, &oracle);
        Ok(())
    }

    pub fn get_oracle_address(env: Env) -> Option<Address> {
        storage::get_oracle_address(&env)
    }

    /// Query the oracle (if configured) and panic if `addr` is sanctioned.
    fn check_not_sanctioned(env: &Env, addr: &Address) -> Result<(), Error> {
        if let Some(oracle_addr) = storage::get_oracle_address(env) {
            let oracle = SanctionsOracleClient::new(env, &oracle_addr);
            if oracle.is_sanctioned(addr) {
                return Err(Error::UnauthorizedSender);
            }
        }
        Ok(())
    }

    // ----------------------------------------------------------------
    // Compliance: Asset "Clawback" Support Logic
    // ----------------------------------------------------------------

    /// Activate emergency mode: blocks create_stream and top_up while
    /// leaving withdraw accessible so beneficiaries can always exit.
    pub fn set_emergency_mode(env: Env, active: bool) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        storage::set_emergency(&env, active);
        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(admin.clone().into_val(&env));
        data.push_back(active.into_val(&env));
        data.push_back(now.into_val(&env));
        env.events().publish(
            (symbol_short!("emergency"), admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("emergency"),
                data,
            },
        );
        Ok(())
    }

    pub fn is_emergency_mode(env: Env) -> bool {
        storage::is_emergency(&env)
    }

    // ----------------------------------------------------------------
    // Issue: Migration Pause — granular security control
    // ----------------------------------------------------------------

    /// Pause or unpause only the migration path, leaving standard V2 streams
    /// fully operational. Admin-only. Emits a `mig_pause` or `mig_unpause`
    /// event so off-chain monitors can react immediately.
    pub fn toggle_migration_pause(env: Env, paused: bool) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();
        storage::set_migration_paused(&env, paused);

        let now = env.ledger().timestamp();
        let action = if paused {
            symbol_short!("mig_paus")
        } else {
            symbol_short!("mig_unps")
        };
        let mut data = Vec::new(&env);
        data.push_back(admin.clone().into_val(&env));
        data.push_back(now.into_val(&env));
        env.events().publish(
            (action.clone(), admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action,
                data,
            },
        );
        Ok(())
    }

    /// Returns true if the migration path is currently paused.
    pub fn is_migration_paused(env: Env) -> bool {
        storage::is_migration_paused(&env)
    }

    // ----------------------------------------------------------------
    // Compliance: Asset "Clawback" Support Logic
    // ----------------------------------------------------------------

    /// Compare the actual token balance in the contract with the sum of all
    /// active stream remaining balances.
    ///
    /// # Token Security Assumptions
    ///
    /// This function assumes the token implements the Soroban Token Interface
    /// (SAC-compliant) and that `balance()` queries return accurate values.
    ///
    /// **This function is critical for detecting:**
    /// - Fee-on-transfer tokens (contract balance < sum of streams)
    /// - Rebasing tokens (contract balance != sum of streams)
    /// - Malicious tokens (unexpected balance discrepancies)
    ///
    /// **Operators should monitor this regularly** to detect token issues
    /// before they cause user funds to be stuck.
    ///
    /// # Parameters
    /// - `token`: The token address to check
    ///
    /// # Returns
    /// - `(contract_balance, sum_remaining)`: Tuple of actual contract balance
    ///   and sum of all active stream remaining balances
    ///
    /// # Usage
    /// ```rust
    /// let (balance, sum) = client.check_balance_integrity(&token_id);
    /// if balance < sum {
    ///     // Token may have fees or rebasing - investigate
    /// }
    /// ```
    pub fn check_balance_integrity(env: Env, token: Address) -> (i128, i128) {
        let total_streams = storage::get_health(&env).total_v2_streams;
        let mut sum_remaining: i128 = 0;

        for i in 0..total_streams {
            if let Some(stream) = storage::get_stream(&env, i) {
                if !stream.cancelled && stream.token == token {
                    let remaining = stream.total_amount.saturating_sub(stream.withdrawn_amount);
                    sum_remaining = sum_remaining.saturating_add(remaining);
                }
            }
        }

        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
        let contract_balance = token_client.balance(&env.current_contract_address());
        (contract_balance, sum_remaining)
    }

    /// Proportionally reduce all active streams for a token if the contract
    /// balance is less than the total committed amount.
    pub fn rebalance_after_clawback(env: Env, token: Address) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();

        let (balance, sum_remaining) = Self::check_balance_integrity(env.clone(), token.clone());
        if balance >= sum_remaining || sum_remaining == 0 {
            return Ok(());
        }

        let reduction_factor_bps = (balance * 10000) / sum_remaining;
        let total_streams = storage::get_health(&env).total_v2_streams;
        for i in 0..total_streams {
            if let Some(mut stream) = storage::get_stream(&env, i) {
                if !stream.cancelled && stream.token == token {
                    let old_remaining = stream.total_amount.saturating_sub(stream.withdrawn_amount);
                    let new_remaining = (old_remaining * reduction_factor_bps) / 10000;
                    stream.total_amount = stream.withdrawn_amount + new_remaining;
                    storage::set_stream(&env, i, &stream);
                }
            }
        }

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(token.clone().into_val(&env));
        data.push_back(sum_remaining.into_val(&env));
        data.push_back(balance.into_val(&env));
        data.push_back(reduction_factor_bps.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("rebalance"), token.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("rebalance"),
                data,
            },
        );

        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if storage::is_paused(env) {
            return Err(Error::ContractPaused);
        }
        if storage::get_contract_state(env) == ContractState::Terminated {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn require_not_paused_only(env: &Env) -> Result<(), Error> {
        if storage::is_paused(env) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn require_not_emergency(env: &Env) -> Result<(), Error> {
        if storage::is_emergency(env) {
            return Err(Error::EmergencyMode);
        }
        Ok(())
    }

    /// Return the current ledger time in nanoseconds.
    ///
    /// When the Soroban SDK exposes `ledger().timestamp_nanos()` this can be
    /// swapped to that call directly. Until then, multiply the second-level
    /// timestamp by `NANOS_PER_SEC` so that `calculate_flow` and
    /// `calculate_unlocked_internal` already operate in the nanosecond domain
    /// and will gain true sub-second precision without further changes.
    #[inline]
    fn ledger_timestamp_nanos(env: &Env) -> u64 {
        env.ledger().timestamp() * math::NANOS_PER_SEC
    }

    /// If a compliance oracle is configured, verify `addr` is not flagged.
    fn require_compliant(env: &Env, addr: &Address) -> Result<(), Error> {
        if let Some(oracle_addr) = storage::get_compliance_oracle(env) {
            let oracle = ComplianceClient::new(env, &oracle_addr);
            if !oracle.is_allowed(addr) {
                return Err(Error::UnauthorizedSender);
            }
        }
        Ok(())
    }

    /// Validate that the stream amount and flow rate do not exceed security limits.
    fn validate_limits(amount: i128, start_time: u64, end_time: u64) -> Result<(), Error> {
        if amount > MAX_STREAM_AMOUNT {
            return Err(Error::AmountOverflow);
        }
        let duration = (end_time - start_time) as i128;
        if duration > 0 {
            if amount > MAX_FLOW_RATE.saturating_mul(duration) {
                return Err(Error::AmountOverflow);
            }
        }
        Ok(())
    }

    /// Verify that an asset is whitelisted for use with the protocol.
    ///
    /// # Token Security Assumptions
    ///
    /// This is the **primary defense** against malicious tokens. Only whitelisted
    /// tokens can be used for stream creation, top-ups, and other operations.
    ///
    /// **Operators must verify token compatibility before whitelisting.**
    /// See TOKEN_SECURITY_ASSUMPTIONS.md for detailed security assumptions
    /// and non-goals.
    ///
    /// # Parameters
    /// - `asset`: The token address to check
    ///
    /// # Returns
    /// - `Ok(())`: If the asset is whitelisted
    /// - `Err(Error::AssetNotWhitelisted)`: If the asset is not whitelisted
    fn require_asset_whitelisted(env: &Env, asset: &Address) -> Result<(), Error> {
        if !storage::is_asset_whitelisted(env, asset) {
            return Err(Error::AssetNotWhitelisted);
        }
        Ok(())
    }

    fn apply_protocol_fee(env: &Env, token: &Address, total_amount: i128) -> Result<i128, Error> {
        let mut fee_bps = storage::get_fee_bps(env);

        // Whale discount: Apply tiered logic if configured
        if let Some(tiers) = storage::get_fee_tiers(env) {
            for tier in tiers.iter() {
                if total_amount >= tier.threshold {
                    fee_bps = tier.fee_bps;
                } else {
                    // Since tiers are sorted ascending, we stop at the first threshold not met
                    break;
                }
            }
        }

        if fee_bps == 0 {
            return Ok(total_amount);
        }

        let treasury = storage::get_treasury(env).ok_or(Error::NoTreasury)?;
        let fee = (total_amount * fee_bps as i128) / 10_000;
        if fee > 0 {
            storage::add_pending_fees(env, &treasury, token, fee);
        }

        Ok(total_amount - fee)
    }

    /// Create a new stream with the specified parameters.
    ///
    /// # Token Security Assumptions
    ///
    /// This function assumes the token implements the Soroban Token Interface
    /// (SAC-compliant). The following token behaviors are NOT protected against:
    ///
    /// - **Malicious tokens**: Tokens that violate the standard interface
    /// - **Fee-on-transfer tokens**: Tokens that deduct fees during transfer
    /// - **Rebasing tokens**: Tokens that automatically adjust balances
    /// - **Transfer restrictions**: Tokens that enforce transfer restrictions
    ///
    /// **Only whitelisted tokens can be used.** Operators must verify token
    /// compatibility before whitelisting. See TOKEN_SECURITY_ASSUMPTIONS.md
    /// for detailed security assumptions and non-goals.
    ///
    /// # Parameters
    /// - `args`: Stream creation arguments including sender, receiver, token, amount, and timing
    ///
    /// # Returns
    /// - `Ok(stream_id)`: The ID of the created stream
    /// - `Err(Error)`: If validation fails or token is not whitelisted
    ///
    /// # Errors
    /// - `ContractPaused`: If the contract is paused
    /// - `AssetNotWhitelisted`: If the token is not in the whitelist
    /// - `BelowDustThreshold`: If the amount is below the minimum
    /// - `InvalidTimeRange`: If timing parameters are invalid
    /// - `InvalidPenalty`: If penalty basis points exceed 10,000
    pub fn create_stream(env: Env, args: StreamArgs) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        Self::require_not_emergency(&env)?;
        args.sender.require_auth();
        Self::require_asset_whitelisted(&env, &args.token)?;

        if args.start_time >= args.end_time
            || args.cliff_time < args.start_time
            || args.cliff_time > args.end_time
        {
            return Err(Error::InvalidTimeRange);
        }

        Self::validate_limits(args.total_amount, args.start_time, args.end_time)?;

        if args.penalty_bps > 10_000 {
            return Err(Error::InvalidPenalty);
        }

        if args.total_amount < storage::get_min_value(&env, &args.token) {
            return Err(Error::BelowDustThreshold);
        }

        if let Some(_) = &args.memo {
            // A Symbol is guaranteed to be <= 32 characters by the Soroban runtime definition.
        }
        // Compliance oracle check (Issue #412)
        Self::require_compliant(&env, &args.sender)?;
        Self::require_compliant(&env, &args.receiver)?;

        let token_client = soroban_sdk::token::TokenClient::new(&env, &args.token);
        token_client.transfer(
            &args.sender,
            &env.current_contract_address(),
            &args.total_amount,
        );

        let stream_amount = Self::apply_protocol_fee(&env, &args.token, args.total_amount)?;

        let stream_id = storage::next_stream_id(&env);

        let mut vault_used = None;
        if args.yield_enabled {
            if let Some(vault_addr) = &args.vault_address {
                let vault_client = VaultClient::new(&env, vault_addr);
                vault_client.deposit(&stream_amount);
                vault_used = Some(vault_addr.clone());
            }
        }

        let stream = StreamV2 {
            sender: args.sender.clone(),
            receiver: args.receiver.clone(),
            beneficiary: args.receiver.clone(),
            token: args.token.clone(),
            total_amount: stream_amount,
            start_time: args.start_time,
            end_time: args.end_time,
            cliff_time: args.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: args.step_duration,
            multiplier_bps: args.multiplier_bps,
            penalty_bps: args.penalty_bps,
            vault_address: vault_used,
            yield_enabled: args.yield_enabled,
            is_pending: false,
            is_recurrent: args.is_recurrent,
            cycle_duration: args.cycle_duration,
            cancellation_type: args.cancellation_type,
            yield_recipient: args.yield_recipient,
            split_address: args.split_address.clone(),
            split_bps: args.split_bps,
            curve_type: args.curve_type,
        };

        storage::set_stream(&env, stream_id, &stream);
        storage::update_stats(&env, stream_amount, &args.sender, &args.receiver);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(args.sender.clone().into_val(&env));
        data.push_back(args.receiver.clone().into_val(&env));
        data.push_back(args.token.clone().into_val(&env));
        data.push_back(stream_amount.into_val(&env));
        data.push_back(args.start_time.into_val(&env));
        data.push_back(args.cliff_time.into_val(&env));
        data.push_back(args.end_time.into_val(&env));
        data.push_back(now.into_val(&env));
        data.push_back(args.memo.clone().into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("create_v2")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("create_v2"),
                data,
            },
        );

        if args.memo.is_some() {
            let mut split_data = Vec::new(&env);
            split_data.push_back(stream_id.into_val(&env));
            split_data.push_back(args.sender.clone().into_val(&env));
            split_data.push_back(args.receiver.clone().into_val(&env));
            split_data.push_back(stream_amount.into_val(&env));
            split_data.push_back(args.memo.clone().into_val(&env));
            split_data.push_back(now.into_val(&env));

            env.events().publish(
                (stream_id, Symbol::new(&env, "split_exec")),
                NebulaEvent {
                    version: 2,
                    timestamp: now,
                    action: Symbol::new(&env, "split_exec"),
                    data: split_data,
                },
            );
        }

        Ok(stream_id)
    }

    pub fn create_stream_with_signature(
        env: Env,
        args: PermitArgs,
        signature: soroban_sdk::BytesN<64>,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        Self::require_asset_whitelisted(&env, &args.token)?;
        let now = env.ledger().timestamp();

        if now > args.deadline {
            return Err(Error::ExpiredDeadline);
        }

        Self::validate_limits(args.total_amount, args.start_time, args.end_time)?;

        if args.total_amount < storage::get_min_value(&env, &args.token) {
            return Err(Error::BelowDustThreshold);
        }

        let nonce_key = (symbol_short!("NONCE"), args.sender_pubkey.clone());
        let stored_nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0u64);

        if args.nonce != stored_nonce {
            return Err(Error::InvalidNonce);
        }

        let mut msg = soroban_sdk::Bytes::new(&env);
        msg.extend_from_slice(b"STELLARSTREAM_PERMIT_V2");
        msg.append(&env.current_contract_address().to_xdr(&env));
        msg.append(&args.sender_pubkey.clone().into());
        msg.append(&args.receiver.clone().to_xdr(&env));
        msg.append(&args.token.clone().to_xdr(&env));

        msg.extend_from_slice(&args.total_amount.to_be_bytes());
        msg.extend_from_slice(&args.start_time.to_be_bytes());
        msg.extend_from_slice(&args.cliff_time.to_be_bytes());
        msg.extend_from_slice(&args.end_time.to_be_bytes());
        msg.extend_from_slice(&args.nonce.to_be_bytes());
        msg.extend_from_slice(&args.deadline.to_be_bytes());

        if args.step_duration > 0 {
            msg.extend_from_slice(&args.step_duration.to_be_bytes());
            msg.extend_from_slice(&args.multiplier_bps.to_be_bytes());
        }

        let msg_hash: soroban_sdk::BytesN<32> = env.crypto().sha256(&msg).into();
        env.crypto()
            .ed25519_verify(&args.sender_pubkey, &msg_hash.into(), &signature);

        env.storage()
            .instance()
            .set(&nonce_key, &(stored_nonce + 1));

        let token_client = soroban_sdk::token::TokenClient::new(&env, &args.token);
        let sender_addr = Address::from_string_bytes(&args.sender_pubkey.clone().into());

        token_client.transfer_from(
            &env.current_contract_address(),
            &sender_addr,
            &env.current_contract_address(),
            &args.total_amount,
        );

        let stream_amount = Self::apply_protocol_fee(&env, &args.token, args.total_amount)?;

        let stream_id = storage::next_stream_id(&env);

        let stream = StreamV2 {
            sender: sender_addr.clone(),
            receiver: args.receiver.clone(),
            beneficiary: args.receiver.clone(),
            token: args.token.clone(),
            total_amount: stream_amount,
            start_time: args.start_time,
            end_time: args.end_time,
            cliff_time: args.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: args.step_duration,
            multiplier_bps: args.multiplier_bps,
            penalty_bps: 0,      // permit streams default to no penalty
            vault_address: None, // No vault support by permit yet
            yield_enabled: false,
            is_pending: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        };

        storage::set_stream(&env, stream_id, &stream);
        storage::update_stats(&env, stream_amount, &sender_addr, &args.receiver);

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(args.receiver.clone().into_val(&env));
        data.push_back(args.token.clone().into_val(&env));
        data.push_back(stream_amount.into_val(&env));
        data.push_back(args.cliff_time.into_val(&env));
        data.push_back(args.nonce.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("permit")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("permit"),
                data,
            },
        );

        Ok(stream_id)
    }

    // ----------------------------------------------------------------
    // Issue #402 — Permit2-Style Signature Streaming
    // ----------------------------------------------------------------

    /// Allow a receiver to claim and start a stream using an off-chain signed
    /// intent from the sender.
    ///
    /// The sender signs `StreamParams` off-chain (e.g. via Freighter) and shares
    /// the signature with the receiver. The receiver calls this function to
    /// atomically verify the signature, pull funds from the sender, and open the
    /// stream — without requiring the sender to be online at claim time.
    ///
    /// # Verification
    /// - `expiration_ledger`: the signed intent expires at this ledger number.
    /// - `nonce`: replay protection; must match the stored nonce for `sender_pubkey`.
    /// - `signature`: Ed25519 signature over the canonical hash of `params`.
    ///
    /// # Authorization
    /// The receiver must authorize this call (they are the one claiming).
    pub fn create_via_signature(
        env: Env,
        params: StreamParams,
        signature: soroban_sdk::BytesN<64>,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        Self::require_asset_whitelisted(&env, &params.token)?;

        // 1. Check expiration_ledger deadline
        if env.ledger().sequence() > params.expiration_ledger {
            return Err(Error::ExpiredDeadline);
        }

        // 2. Dust threshold check
        Self::validate_limits(params.total_amount, params.start_time, params.end_time)?;

        if params.total_amount < storage::get_min_value(&env, &params.token) {
            return Err(Error::BelowDustThreshold);
        }

        // 3. Replay-protection nonce check
        let nonce_key = (symbol_short!("SIG_NONC"), params.sender_pubkey.clone());
        let stored_nonce: u64 = env.storage().instance().get(&nonce_key).unwrap_or(0u64);
        if params.nonce != stored_nonce {
            return Err(Error::InvalidNonce);
        }

        // 4. Build the canonical message and verify the Ed25519 signature.
        //    The message commits to: domain separator, contract address, and all
        //    StreamParams fields so nothing can be altered after signing.
        let mut msg = Bytes::new(&env);
        msg.extend_from_slice(b"STELLARSTREAM_INTENT_V1");
        msg.append(&env.current_contract_address().to_xdr(&env));
        msg.append(&params.sender_pubkey.clone().into());
        msg.append(&params.receiver.clone().to_xdr(&env));
        msg.append(&params.token.clone().to_xdr(&env));
        msg.extend_from_slice(&params.total_amount.to_be_bytes());
        msg.extend_from_slice(&params.start_time.to_be_bytes());
        msg.extend_from_slice(&params.cliff_time.to_be_bytes());
        msg.extend_from_slice(&params.end_time.to_be_bytes());
        msg.extend_from_slice(&params.nonce.to_be_bytes());
        msg.extend_from_slice(&params.expiration_ledger.to_be_bytes());
        if params.step_duration > 0 {
            msg.extend_from_slice(&params.step_duration.to_be_bytes());
            msg.extend_from_slice(&params.multiplier_bps.to_be_bytes());
        }

        let msg_hash: soroban_sdk::BytesN<32> = env.crypto().sha256(&msg).into();
        env.crypto()
            .ed25519_verify(&params.sender_pubkey, &msg_hash.into(), &signature);

        // 5. Consume the nonce to prevent replay
        env.storage()
            .instance()
            .set(&nonce_key, &(stored_nonce + 1));

        // 6. Pull funds from the sender into the contract
        let sender_addr = Address::from_string_bytes(&params.sender_pubkey.clone().into());
        let token_client = soroban_sdk::token::TokenClient::new(&env, &params.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &sender_addr,
            &env.current_contract_address(),
            &params.total_amount,
        );

        // 7. Deduct protocol fee and create the stream
        let stream_amount = Self::apply_protocol_fee(&env, &params.token, params.total_amount)?;
        let stream_id = storage::next_stream_id(&env);

        let stream = StreamV2 {
            sender: sender_addr.clone(),
            receiver: params.receiver.clone(),
            beneficiary: params.receiver.clone(),
            token: params.token.clone(),
            total_amount: stream_amount,
            start_time: params.start_time,
            end_time: params.end_time,
            cliff_time: params.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: params.step_duration,
            multiplier_bps: params.multiplier_bps,
            penalty_bps: 0,
            vault_address: params.vault_address,
            yield_enabled: params.yield_enabled,
            is_pending: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: 0,
            yield_recipient: 0,
            split_address: None,
            split_bps: 0,
            curve_type: 0,
        };

        // 8. Emit event
        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(params.receiver.clone().into_val(&env));
        data.push_back(params.token.clone().into_val(&env));
        data.push_back(stream_amount.into_val(&env));
        data.push_back(params.expiration_ledger.into_val(&env));
        data.push_back(params.nonce.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("sig_claim")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("sig_claim"),
                data,
            },
        );

        Ok(stream_id)
    }

    // ----------------------------------------------------------------
    // Issue #378 — Streaming Swap (DEX Integration)
    // ----------------------------------------------------------------

    /// Create a stream where the sender provides `asset_in`, which is automatically
    /// swapped to `asset_out` via a Soroban AMM before initializing the stream.
    ///
    /// This enables use cases like:
    /// - Stream XLM but receive USDC (swap XLM -> USDC first)
    /// - Stream any asset but receive a stablecoin
    ///
    /// # Parameters
    /// - `args`: SwapStreamArgs containing all swap and stream configuration
    ///
    /// # Returns
    /// - `Ok(stream_id)` if stream was created successfully
    /// - `Err(Error)` if swap fails, slippage exceeded, or stream creation fails
    ///
    /// # Safety Features
    /// 1. `min_amount_out` - Absolute minimum output; swap fails if not met
    /// 2. `slippage_tolerance_bps` - Additional protection (e.g., 50 bps = 0.5%)
    /// 3. `swap_deadline` - Prevents stale price execution
    pub fn create_swap_stream(env: Env, args: SwapStreamArgs) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        Self::require_not_emergency(&env)?;

        // Validate swap streaming is enabled
        if !storage::is_swap_enabled(&env) {
            return Err(Error::DexNotConfigured);
        }

        // Validate sender authorized this call
        args.sender.require_auth();

        // Validate input parameters
        if args.amount_in <= 0 {
            return Err(Error::InvalidSwapParams);
        }

        if args.asset_in == args.asset_out {
            return Err(Error::SameAsset);
        }

        // Validate slippage tolerance (0-100% = 0-10000 bps)
        if args.slippage_tolerance_bps > 10_000 {
            return Err(Error::InvalidPenalty);
        }

        // Check deadline
        let now = env.ledger().timestamp();
        if args.swap_deadline < now {
            return Err(Error::ExpiredDeadline);
        }

        // Validate stream timing
        if args.start_time >= args.end_time {
            return Err(Error::InvalidTimeRange);
        }

        if args.cliff_time < args.start_time || args.cliff_time > args.end_time {
            return Err(Error::InvalidTimeRange);
        }

        // Validate both assets are whitelisted
        Self::require_asset_whitelisted(&env, &args.asset_in)?;
        Self::require_asset_whitelisted(&env, &args.asset_out)?;

        // Compliance oracle check
        Self::require_compliant(&env, &args.sender)?;
        Self::require_compliant(&env, &args.receiver)?;

        // Get DEX address
        let dex_address = storage::get_dex_address(&env).ok_or(Error::DexNotConfigured)?;

        // Transfer asset_in from sender to this contract
        let token_in_client = soroban_sdk::token::TokenClient::new(&env, &args.asset_in);
        token_in_client.transfer(
            &args.sender,
            &env.current_contract_address(),
            &args.amount_in,
        );

        // Approve DEX to spend asset_in from this contract
        let expiration_ledger = env.ledger().sequence().saturating_add(1000);
        token_in_client.approve(
            &env.current_contract_address(),
            &dex_address,
            &args.amount_in,
            &expiration_ledger,
        );

        // Execute swap via DEX
        let swap_client = SwapClient::new(&env, &dex_address);

        // Calculate effective min_amount_out with slippage tolerance
        // Apply slippage tolerance as an additional safety margin
        let effective_min_amount_out = Self::calculate_min_amount_with_slippage(
            args.amount_in,
            args.min_amount_out,
            args.slippage_tolerance_bps,
        );

        // Execute the swap
        let amount_out = swap_client.swap(
            &args.asset_in,
            &args.asset_out,
            &args.amount_in,
            &effective_min_amount_out,
            &args.swap_deadline,
        );

        // Safety check: verify we received at least the user's specified minimum
        if amount_out < args.min_amount_out {
            return Err(Error::SwapSlippageExceeded);
        }

        // Calculate stream amount after protocol fee
        let stream_amount = Self::apply_protocol_fee(&env, &args.asset_out, amount_out)?;

        // Check dust threshold for the output asset
        if stream_amount < storage::get_min_value(&env, &args.asset_out) {
            return Err(Error::BelowDustThreshold);
        }

        // Create the stream with the swapped asset
        let stream_id = storage::next_stream_id(&env);

        // Handle vault deposit if yield is enabled
        let mut vault_used = None;
        if args.yield_enabled {
            if let Some(vault_addr) = &args.vault_address {
                let vault_client = VaultClient::new(&env, vault_addr);
                vault_client.deposit(&stream_amount);
                vault_used = Some(vault_addr.clone());
            }
        }

        let stream = StreamV2 {
            sender: args.sender.clone(),
            receiver: args.receiver.clone(),
            beneficiary: args.receiver.clone(),
            token: args.asset_out.clone(),
            total_amount: stream_amount,
            start_time: args.start_time,
            end_time: args.end_time,
            cliff_time: args.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: 0,      // Default linear stream
            multiplier_bps: 10000, // 1.0x multiplier
            penalty_bps: 0,        // Default no penalty
            vault_address: vault_used,
            yield_enabled: args.yield_enabled,
            is_pending: false,
            is_recurrent: false,
            cycle_duration: 0,
            cancellation_type: args.cancellation_type,
            yield_recipient: args.yield_recipient,
            split_address: args.split_address.clone(),
            split_bps: args.split_bps,
            curve_type: 0,
        };

        storage::set_stream(&env, stream_id, &stream);
        storage::update_stats(&env, stream_amount, &args.sender, &args.receiver);

        // Emit swap stream creation event
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(args.sender.clone().into_val(&env));
        data.push_back(args.receiver.clone().into_val(&env));
        data.push_back(args.asset_in.clone().into_val(&env));
        data.push_back(args.asset_out.clone().into_val(&env));
        data.push_back(args.amount_in.into_val(&env));
        data.push_back(amount_out.into_val(&env));
        data.push_back(args.min_amount_out.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, Symbol::new(&env, "swap_stream")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: Symbol::new(&env, "swap_stream"),
                data,
            },
        );

        Ok(stream_id)
    }

    /// Calculate the minimum amount considering slippage tolerance.
    /// This provides additional safety beyond the user's specified min_amount_out.
    fn calculate_min_amount_with_slippage(
        _amount_in: i128,
        min_amount_out: i128,
        slippage_tolerance_bps: u32,
    ) -> i128 {
        // Apply slippage tolerance to min_amount_out
        // This reduces the acceptable output by the slippage percentage
        let tolerance_multiplier = 10_000 - slippage_tolerance_bps as i128;
        // Use integer math: (min_amount_out * tolerance_multiplier) / 10000
        (min_amount_out * tolerance_multiplier) / 10_000
    }

    /// Get the expected output amount for a swap without executing it.
    /// Useful for UI to show user expected output before confirming.
    pub fn get_swap_quote(
        env: Env,
        amount_in: i128,
        asset_in: Address,
        asset_out: Address,
    ) -> Result<SwapResult, Error> {
        if !storage::is_swap_enabled(&env) {
            return Err(Error::DexNotConfigured);
        }

        if amount_in <= 0 {
            return Err(Error::InvalidSwapParams);
        }

        if asset_in == asset_out {
            return Err(Error::SameAsset);
        }

        let dex_address = storage::get_dex_address(&env).ok_or(Error::DexNotConfigured)?;

        let swap_client = SwapClient::new(&env, &dex_address);

        let amount_out = swap_client.get_amount_out(&asset_in, &asset_out, &amount_in);

        let spot_price = swap_client.get_spot_price(&asset_in, &asset_out);

        // Calculate price impact (simplified - assumes 1:1 for this calculation)
        // Price impact = ((expected_out - theoretical_out) / theoretical_out) * 10000 bps
        let theoretical_out = amount_in; // Simplified - assumes 1:1 for demonstration
        let price_impact = if theoretical_out > 0 {
            ((amount_out - theoretical_out) * 10000) / theoretical_out
        } else {
            0
        };

        Ok(SwapResult {
            amount_in,
            amount_out,
            price_impact_bps: price_impact,
        })
    }

    // ----------------------------------------------------------------
    // Issue #377 — Push-Pull Rate Re-balancing
    // ----------------------------------------------------------------

    /// Propose a new rate for an active stream.
    ///
    /// The sender can propose to change the stream rate (faster or slower).
    /// The receiver must accept the proposal for it to take effect.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream to update
    /// - `new_rate`: The new rate (amount per second)
    ///
    /// # Returns
    /// - `Ok(())` if proposal was created successfully
    /// - `Err(Error)` if validation fails
    ///
    /// # Constraints
    /// - Only the stream sender can propose
    /// - Stream must be active (not cancelled, not fully withdrawn)
    /// - New rate must be > 0
    /// - Sender must have sufficient balance for the change
    pub fn propose_rate(
        env: Env,
        stream_id: u64,
        new_rate: i128,
    ) -> Result<PendingRateUpdate, Error> {
        Self::require_not_paused(&env)?;

        // Get the stream
        let stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        // Only the sender can propose a rate change
        let caller = stream.sender.clone();
        caller.require_auth();

        // Validate stream is active
        if stream.cancelled {
            return Err(Error::StreamNotActive);
        }

        // Check if fully withdrawn
        if stream.withdrawn_amount >= stream.total_amount {
            return Err(Error::StreamNotActive);
        }

        // Validate new rate
        if new_rate <= 0 {
            return Err(Error::InvalidNewRate);
        }

        if new_rate > MAX_FLOW_RATE {
            return Err(Error::AmountOverflow);
        }

        // Calculate remaining balance
        let now = env.ledger().timestamp();
        let remaining_balance = Self::calculate_remaining_balance(&env, &stream, now)?;

        // Calculate current rate (total_amount / duration)
        let duration = (stream.end_time - stream.start_time) as i128;
        let current_rate = if duration > 0 {
            stream.total_amount / duration
        } else {
            0
        };

        // If rate is unchanged, nothing to do
        if current_rate == new_rate {
            return Err(Error::InvalidNewRate);
        }

        // Calculate new end time based on remaining balance and new rate
        // new_end_time = now + (remaining_balance / new_rate)
        let new_end_time = if new_rate > 0 {
            let additional_seconds = remaining_balance / new_rate;
            now.saturating_add(additional_seconds as u64)
        } else {
            return Err(Error::InvalidNewRate);
        };

        // Ensure new end time is in the future
        if new_end_time <= now {
            return Err(Error::InsufficientBalance);
        }

        // Check if a pending update already exists
        if storage::has_pending_rate_update(&env, stream_id) {
            // Check if existing update has expired
            if !storage::is_pending_rate_update_expired(&env, stream_id) {
                return Err(Error::PendingUpdateExists);
            }
            // Remove expired update
            storage::remove_pending_rate_update(&env, stream_id);
        }

        // Create the pending update
        let pending_update = PendingRateUpdate {
            new_rate,
            proposed_at: now,
            proposed_by: caller.clone(),
            original_end_time: stream.end_time,
            original_total_amount: stream.total_amount,
        };

        // Store the pending update
        storage::set_pending_rate_update(&env, stream_id, &pending_update);

        // Emit event
        let expires_at = now.saturating_add(storage::RATE_UPDATE_TTL);
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(caller.into_val(&env));
        data.push_back(current_rate.into_val(&env));
        data.push_back(new_rate.into_val(&env));
        data.push_back(new_end_time.into_val(&env));
        data.push_back(expires_at.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, Symbol::new(&env, "rate_propose")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: Symbol::new(&env, "rate_propose"),
                data,
            },
        );

        Ok(pending_update)
    }

    /// Accept a pending rate update proposal.
    ///
    /// Only the stream receiver can accept a rate update.
    /// This recalculates the end_time based on remaining_balance / new_rate.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream with pending update
    ///
    /// # Returns
    /// - `Ok(new_end_time)` if update was accepted
    /// - `Err(Error)` if validation fails
    pub fn accept_rate(env: Env, stream_id: u64) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;

        // Get the stream
        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        // Only the receiver can accept
        let caller = stream.receiver.clone();
        caller.require_auth();

        // Validate stream is active
        if stream.cancelled {
            return Err(Error::StreamNotActive);
        }

        // Get pending update
        let pending_update =
            storage::get_pending_rate_update(&env, stream_id).ok_or(Error::NoPendingUpdate)?;

        // Check if proposal has expired
        if storage::is_pending_rate_update_expired(&env, stream_id) {
            storage::remove_pending_rate_update(&env, stream_id);
            return Err(Error::ExpiredDeadline);
        }

        let now = env.ledger().timestamp();

        // Calculate remaining balance at current time
        let remaining_balance = Self::calculate_remaining_balance(&env, &stream, now)?;

        // Calculate new end time
        let new_end_time = if pending_update.new_rate > 0 {
            let additional_seconds = remaining_balance / pending_update.new_rate;
            now.saturating_add(additional_seconds as u64)
        } else {
            return Err(Error::InvalidNewRate);
        };

        // Update the stream
        stream.end_time = new_end_time;

        // Update total_amount to reflect the new remaining balance
        // (so that total streamed = original - remaining, and remaining = new_rate * new_duration)
        // Actually, we keep total_amount as-is and only adjust end_time
        // The stream effectively continues with the new rate until the remaining balance is exhausted

        storage::set_stream(&env, stream_id, &stream);

        // Remove the pending update
        storage::remove_pending_rate_update(&env, stream_id);

        // Emit event
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(caller.into_val(&env));
        data.push_back(pending_update.new_rate.into_val(&env));
        data.push_back(new_end_time.into_val(&env));
        data.push_back(remaining_balance.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, Symbol::new(&env, "rate_accept")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: Symbol::new(&env, "rate_accept"),
                data,
            },
        );

        Ok(new_end_time)
    }

    /// Cancel a pending rate update proposal.
    ///
    /// Either party (sender or receiver) can cancel the proposal.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream with pending update
    /// - `caller`: The address cancelling the proposal
    pub fn cancel_rate_proposal(env: Env, stream_id: u64, caller: Address) -> Result<(), Error> {
        // Get the stream to validate caller is involved
        let stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        // Caller must be sender or receiver
        if caller != stream.sender && caller != stream.receiver {
            return Err(Error::UnauthorizedSender);
        }

        // Check if pending update exists
        if !storage::has_pending_rate_update(&env, stream_id) {
            return Err(Error::NoPendingUpdate);
        }

        // Check if expired
        let is_expired = storage::is_pending_rate_update_expired(&env, stream_id);

        // Remove the pending update
        storage::remove_pending_rate_update(&env, stream_id);

        // Emit event
        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(caller.into_val(&env));
        data.push_back(if is_expired { 0u32 } else { 1u32 }.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, Symbol::new(&env, "rate_cancel")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: Symbol::new(&env, "rate_cancel"),
                data,
            },
        );

        Ok(())
    }

    /// Get the pending rate update for a stream.
    ///
    /// # Parameters
    /// - `stream_id`: The ID of the stream
    ///
    /// # Returns
    /// - `Some(PendingRateUpdate)` if a proposal exists and is not expired
    /// - `None` if no proposal exists or if it has expired
    pub fn get_pending_rate_update(
        env: Env,
        stream_id: u64,
    ) -> Result<Option<PendingRateUpdate>, Error> {
        // Check if stream exists
        if storage::get_stream(&env, stream_id).is_none() {
            return Err(Error::StreamNotFound);
        }

        // Check if pending update exists
        if !storage::has_pending_rate_update(&env, stream_id) {
            return Ok(None);
        }

        // Check if expired
        if storage::is_pending_rate_update_expired(&env, stream_id) {
            // Clean up expired update
            storage::remove_pending_rate_update(&env, stream_id);
            return Ok(None);
        }

        Ok(storage::get_pending_rate_update(&env, stream_id))
    }

    /// Calculate the remaining balance in a stream.
    /// This is used internally for rate rebalancing calculations.
    fn calculate_remaining_balance(env: &Env, stream: &StreamV2, now: u64) -> Result<i128, Error> {
        let effective_now = if now < stream.start_time {
            stream.start_time
        } else {
            now
        };

        // If after end time, remaining is what's not yet withdrawn
        if effective_now >= stream.end_time {
            return Ok(stream.total_amount.saturating_sub(stream.withdrawn_amount));
        }

        // Calculate elapsed time since start
        let elapsed = (effective_now - stream.start_time) as i128;
        let total_duration = (stream.end_time - stream.start_time) as i128;

        if total_duration <= 0 {
            return Ok(0);
        }

        // Calculate total unlocked (excluding cliff)
        let cliff_duration = if stream.cliff_time > stream.start_time {
            (stream.cliff_time - stream.start_time) as i128
        } else {
            0
        };

        let effective_elapsed = elapsed.saturating_sub(cliff_duration);
        let effective_duration = total_duration.saturating_sub(cliff_duration);

        if effective_duration <= 0 || effective_elapsed <= 0 {
            return Ok(stream.total_amount.saturating_sub(stream.withdrawn_amount));
        }

        // Calculate unlocked amount
        let unlocked = (stream.total_amount * effective_elapsed) / effective_duration;
        let remaining = stream.total_amount.saturating_sub(unlocked);
        let withdrawable = remaining.saturating_sub(stream.withdrawn_amount);

        Ok(withdrawable.max(0))
    }

    // ----------------------------------------------------------------
    // Issue #367 — Batch Stream Creation
    // ----------------------------------------------------------------

    pub fn create_batch_streams(env: Env, streams: Vec<StreamArgs>) -> Result<Vec<u64>, Error> {
        Self::require_not_paused(&env)?;

        // Validate batch size limit (max 10 streams)
        if streams.len() > 10 {
            return Err(Error::BatchTooLarge);
        }

        if streams.is_empty() {
            return Err(Error::InvalidTimeRange); // Reuse error for empty batch
        }

        // Validate all streams upfront to ensure atomicity
        let mut total_amount: i128 = 0;
        let sender = streams.get(0).unwrap().sender.clone();

        for args in streams.iter() {
            // All streams must have the same sender
            if args.sender != sender {
                return Err(Error::UnauthorizedSender);
            }
            Self::require_asset_whitelisted(&env, &args.token)?;

            // Validate time ranges
            if args.start_time >= args.end_time
                || args.cliff_time < args.start_time
                || args.cliff_time > args.end_time
            {
                return Err(Error::InvalidTimeRange);
            }

            // Validate dust threshold
            if args.total_amount < storage::get_min_value(&env, &args.token) {
                return Err(Error::BelowDustThreshold);
            }

            total_amount = total_amount
                .checked_add(args.total_amount)
                .ok_or(Error::InvalidTimeRange)?; // Overflow protection
        }

        // Require auth from the sender
        sender.require_auth();

        // Calculate total amount needed and transfer all tokens at once
        let token_client =
            soroban_sdk::token::TokenClient::new(&env, &streams.get(0).unwrap().token);
        token_client.transfer(&sender, &env.current_contract_address(), &total_amount);

        // Create all streams
        let mut stream_ids = Vec::new(&env);
        let mut total_created_amount: i128 = 0;

        for args in streams.iter() {
            let stream_id = storage::next_stream_id(&env);
            let stream_amount = Self::apply_protocol_fee(&env, &args.token, args.total_amount)?;

            let stream = StreamV2 {
                sender: args.sender.clone(),
                receiver: args.receiver.clone(),
                beneficiary: args.receiver.clone(),
                token: args.token.clone(),
                total_amount: stream_amount,
                start_time: args.start_time,
                end_time: args.end_time,
                cliff_time: args.cliff_time,
                withdrawn_amount: 0,
                cancelled: false,
                migrated_from_v1: false,
                v1_stream_id: 0,
                step_duration: args.step_duration,
                multiplier_bps: args.multiplier_bps,
                penalty_bps: args.penalty_bps,
                vault_address: None, // Batch creation defaults to no vault
                yield_enabled: false,
                is_pending: false,
                is_recurrent: args.is_recurrent,
                cycle_duration: args.cycle_duration,
                cancellation_type: args.cancellation_type,
                yield_recipient: args.yield_recipient,
                split_address: args.split_address.clone(),
                split_bps: args.split_bps,
                curve_type: args.curve_type,
            };

            storage::set_stream(&env, stream_id, &stream);
            storage::update_stats(&env, stream_amount, &args.sender, &args.receiver);

            let now = env.ledger().timestamp();
            let mut data = Vec::new(&env);
            data.push_back(stream_id.into_val(&env));
            data.push_back(args.sender.clone().into_val(&env));
            data.push_back(args.receiver.clone().into_val(&env));
            data.push_back(args.token.clone().into_val(&env));
            data.push_back(stream_amount.into_val(&env));
            data.push_back(args.start_time.into_val(&env));
            data.push_back(args.cliff_time.into_val(&env));
            data.push_back(args.end_time.into_val(&env));
            data.push_back(now.into_val(&env));

            env.events().publish(
                (stream_id, symbol_short!("create_v2")),
                NebulaEvent {
                    version: 2,
                    timestamp: now,
                    action: symbol_short!("create_v2"),
                    data,
                },
            );

            stream_ids.push_back(stream_id);
            total_created_amount = total_created_amount.checked_add(stream_amount).unwrap();
        }

        // Emit batch creation summary event
        let now = env.ledger().timestamp();
        let mut batch_data = Vec::new(&env);
        batch_data.push_back(sender.clone().into_val(&env));
        batch_data.push_back((stream_ids.len() as u32).into_val(&env));
        batch_data.push_back(total_created_amount.into_val(&env));
        batch_data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("btch_crt"), sender.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("btch_crt"),
                data: batch_data,
            },
        );

        Ok(stream_ids)
    }

    // ----------------------------------------------------------------
    // Issue #408 — Multi-sig Transaction Buffer (Stream Request Approval)
    // ----------------------------------------------------------------

    /// Initiate a stream request that requires multi-sig approval before execution.
    /// This stores the stream parameters and sets approvals = 1 (first approval from initiator).
    ///
    /// The stream will only be created once the approval threshold is met.
    pub fn initiate_stream_request(env: Env, args: StreamArgs) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        args.sender.require_auth();
        Self::require_asset_whitelisted(&env, &args.token)?;

        // Validate time range
        if args.start_time >= args.end_time
            || args.cliff_time < args.start_time
            || args.cliff_time > args.end_time
        {
            return Err(Error::InvalidTimeRange);
        }

        // Validate penalty
        if args.penalty_bps > 10_000 {
            return Err(Error::InvalidPenalty);
        }

        // Validate dust threshold
        if args.total_amount < storage::get_min_value(&env, &args.token) {
            return Err(Error::BelowDustThreshold);
        }

        let request_id = storage::next_stream_request_id(&env);
        let threshold = storage::get_threshold(&env);

        // Create pending request with first approval from the sender
        let mut approved_by = Vec::new(&env);
        approved_by.push_back(args.sender.clone());

        let request = storage::PendingStreamRequest {
            args: args.clone(),
            approvals: 1,
            approved_by,
            created_at: env.ledger().timestamp(),
            executed: false,
        };

        storage::set_pending_stream_request(&env, request_id, &request);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(request_id.into_val(&env));
        data.push_back(args.sender.clone().into_val(&env));
        data.push_back(args.receiver.clone().into_val(&env));
        data.push_back(args.token.clone().into_val(&env));
        data.push_back(args.total_amount.into_val(&env));
        data.push_back(threshold.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("req_init"), request_id),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("req_init"),
                data,
            },
        );

        Ok(request_id)
    }

    /// Approve a pending stream request. When approvals reach the threshold,
    /// the stream is automatically created.
    pub fn approve_stream_request(
        env: Env,
        request_id: u64,
        approver: Address,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;

        // Get the admin list and threshold
        let admin_list = storage::get_admin_list(&env);
        let threshold = storage::get_threshold(&env);

        // Verify the approver is in the admin list and require auth
        if !admin_list.contains(&approver) {
            return Err(Error::NotEnoughSigners);
        }
        approver.require_auth();

        // Get the pending request
        let mut request = storage::get_pending_stream_request(&env, request_id)
            .ok_or(Error::StreamRequestNotFound)?;

        // Check if already executed
        if request.executed {
            return Err(Error::StreamReqAlreadyExecuted);
        }

        // Check if already approved by this admin
        if request.approved_by.contains(&approver) {
            return Err(Error::AlreadyApproved);
        }

        // Add approval
        request.approvals += 1;
        request.approved_by.push_back(approver.clone());

        let now = env.ledger().timestamp();

        // If threshold reached, execute the stream creation
        if request.approvals >= threshold {
            request.executed = true;
            storage::set_pending_stream_request(&env, request_id, &request);

            // Execute the stream creation
            let stream_id = Self::execute_stream_creation_internal(&env, request.args)?;

            // Remove the pending request
            storage::remove_pending_stream_request(&env, request_id);

            let mut data = Vec::new(&env);
            data.push_back(request_id.into_val(&env));
            data.push_back(stream_id.into_val(&env));
            data.push_back(now.into_val(&env));

            env.events().publish(
                (symbol_short!("req_exec"), request_id),
                NebulaEvent {
                    version: 2,
                    timestamp: now,
                    action: symbol_short!("req_exec"),
                    data,
                },
            );

            Ok(stream_id)
        } else {
            // Update the pending request with new approval
            storage::set_pending_stream_request(&env, request_id, &request);

            let mut data = Vec::new(&env);
            data.push_back(request_id.into_val(&env));
            data.push_back(approver.clone().into_val(&env));
            data.push_back(request.approvals.into_val(&env));
            data.push_back(threshold.into_val(&env));
            data.push_back(now.into_val(&env));

            env.events().publish(
                (symbol_short!("req_appr"), request_id),
                NebulaEvent {
                    version: 2,
                    timestamp: now,
                    action: symbol_short!("req_appr"),
                    data,
                },
            );

            Ok(0) // Return 0 to indicate request not yet executed, but approval recorded
        }
    }

    /// Get a pending stream request details
    pub fn get_stream_request(env: Env, request_id: u64) -> Option<storage::PendingStreamRequest> {
        storage::get_pending_stream_request(&env, request_id)
    }

    /// Internal helper to execute stream creation (used by approve_stream_request)
    fn execute_stream_creation_internal(env: &Env, args: StreamArgs) -> Result<u64, Error> {
        // Transfer tokens from sender
        let token_client = soroban_sdk::token::TokenClient::new(env, &args.token);
        token_client.transfer(
            &args.sender,
            &env.current_contract_address(),
            &args.total_amount,
        );

        let stream_amount = Self::apply_protocol_fee(env, &args.token, args.total_amount)?;

        let stream_id = storage::next_stream_id(env);

        let mut vault_used = None;
        if args.yield_enabled {
            if let Some(vault_addr) = &args.vault_address {
                let vault_client = VaultClient::new(env, vault_addr);
                vault_client.deposit(&stream_amount);
                vault_used = Some(vault_addr.clone());
            }
        }

        let stream = StreamV2 {
            sender: args.sender.clone(),
            receiver: args.receiver.clone(),
            beneficiary: args.receiver.clone(),
            token: args.token.clone(),
            total_amount: stream_amount,
            start_time: args.start_time,
            end_time: args.end_time,
            cliff_time: args.cliff_time,
            withdrawn_amount: 0,
            cancelled: false,
            migrated_from_v1: false,
            v1_stream_id: 0,
            step_duration: args.step_duration,
            multiplier_bps: args.multiplier_bps,
            penalty_bps: args.penalty_bps,
            vault_address: vault_used,
            yield_enabled: args.yield_enabled,
            is_pending: false,
            is_recurrent: args.is_recurrent,
            cycle_duration: args.cycle_duration,
            cancellation_type: args.cancellation_type,
            yield_recipient: args.yield_recipient,
            split_address: args.split_address.clone(),
            split_bps: args.split_bps,
            curve_type: args.curve_type,
        };

        storage::set_stream(env, stream_id, &stream);
        storage::update_stats(env, stream_amount, &args.sender, &args.receiver);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(env);
        data.push_back(stream_id.into_val(env));
        data.push_back(args.sender.clone().into_val(env));
        data.push_back(args.receiver.clone().into_val(env));
        data.push_back(args.token.clone().into_val(env));
        data.push_back(stream_amount.into_val(env));
        data.push_back(args.start_time.into_val(env));
        data.push_back(args.cliff_time.into_val(env));
        data.push_back(args.end_time.into_val(env));
        data.push_back(now.into_val(env));

        env.events().publish(
            (stream_id, symbol_short!("create_v2")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("create_v2"),
                data,
            },
        );

        Ok(stream_id)
    }

    // ----------------------------------------------------------------
    // Time-locked Admin Operations
    // ----------------------------------------------------------------

    pub fn schedule_op(env: Env, op: Operation) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();

        let execution_time = env.ledger().timestamp() + storage::ADMIN_DELAY;
        storage::schedule_op(&env, &op, execution_time);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(execution_time.into_val(&env));

        env.events().publish(
            (symbol_short!("schedule"),),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("schedule"),
                data,
            },
        );

        Ok(())
    }

    pub fn execute_op(env: Env, op: Operation) -> Result<(), Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();

        let execution_time =
            storage::get_scheduled_op_time(&env, &op).ok_or(Error::OpNotScheduled)?;

        if env.ledger().timestamp() < execution_time {
            return Err(Error::NotExecutionTime);
        }

        // Execute the actual operation
        match &op {
            Operation::SetAdmins(new_admins, new_threshold) => {
                Self::set_admins_internal(env.clone(), new_admins.clone(), *new_threshold)?;
            }
            Operation::TransferAdmin(new_admin) => {
                Self::transfer_admin_internal(env.clone(), new_admin.clone())?;
            }
            Operation::SetMinValue(asset, min) => {
                Self::set_min_value_internal(env.clone(), asset.clone(), *min)?;
            }
        }

        storage::clear_op(&env, &op);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("executed"),),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("executed"),
                data,
            },
        );

        Ok(())
    }

    // ----------------------------------------------------------------
    // Issue: Recurrent Streams — refill_stream
    // ----------------------------------------------------------------

    /// Attempt to auto-renew a recurrent stream after its cycle has ended.
    ///
    /// The contract uses `transfer_from` to pull `total_amount` tokens from
    /// the sender — the sender must have pre-approved the contract as spender
    /// via the token's `approve` function before calling this.
    ///
    /// - If the transfer succeeds: a new cycle begins immediately.
    /// - If the transfer fails (insufficient allowance / balance):
    ///   `is_recurrent` is set to `false` and the stream stays completed.
    ///
    /// This function is permissionless and can be triggered by keeper bots.
    pub fn refill_stream(env: Env, stream_id: u64) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let mut stream = storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;

        if !stream.is_recurrent {
            return Err(Error::StreamNotMigratable);
        }
        if stream.cancelled {
            return Err(Error::AlreadyCancelled);
        }

        let now = env.ledger().timestamp();
        if now < stream.end_time {
            return Err(Error::NotExecutionTime);
        }

        let original_amount = stream.total_amount;
        let token_client = soroban_sdk::token::TokenClient::new(&env, &stream.token);

        // Contract is the approved spender; sender must have set allowance beforehand.
        let result = token_client.try_transfer_from(
            &env.current_contract_address(),
            &stream.sender,
            &env.current_contract_address(),
            &original_amount,
        );

        if result.is_err() {
            // Allowance exhausted or transfer failed — disable recurrence.
            stream.is_recurrent = false;
            storage::set_stream(&env, stream_id, &stream);
            return Ok(());
        }

        let old_end_time = stream.end_time;
        let new_end_time = old_end_time + stream.cycle_duration;

        stream.start_time = old_end_time;
        stream.end_time = new_end_time;
        stream.withdrawn_amount = 0; // Reset for the new cycle

        storage::set_stream(&env, stream_id, &stream);
        storage::update_stats(&env, original_amount, &stream.sender, &stream.receiver);

        let mut data = Vec::new(&env);
        data.push_back(stream_id.into_val(&env));
        data.push_back(stream.sender.clone().into_val(&env));
        data.push_back(original_amount.into_val(&env));
        data.push_back(old_end_time.into_val(&env));
        data.push_back(new_end_time.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (stream_id, symbol_short!("refill")),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("refill"),
                data,
            },
        );

        Ok(())
    }

    // ----------------------------------------------------------------
    // Issue: Protocol Fees — admin helpers + treasury withdrawal
    // ----------------------------------------------------------------

    /// Set the protocol treasury address. Admin-only.
    pub fn set_treasury(env: Env, treasury: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_treasury(&env, &treasury);
        Ok(())
    }

    /// Get the current treasury address.
    pub fn get_treasury(env: Env) -> Option<Address> {
        storage::get_treasury(&env)
    }

    // ----------------------------------------------------------------
    // Issue #412 — Compliance Oracle
    // ----------------------------------------------------------------

    /// Set the sanctions-list oracle. Admin-only.
    /// Pass the address of a contract implementing `ComplianceTrait`.
    pub fn set_compliance_oracle(env: Env, oracle: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_compliance_oracle(&env, &oracle);
        Ok(())
    }

    pub fn get_compliance_oracle(env: Env) -> Option<Address> {
        storage::get_compliance_oracle(&env)
    }

    // ----------------------------------------------------------------
    // Issue #413 — Circular Event Log
    // ----------------------------------------------------------------

    /// Append a raw event payload to the stream's circular log (max 50 entries).
    /// Any caller may append; the log is informational and not access-controlled.
    pub fn append_event_log(env: Env, stream_id: u64, data: Bytes) -> Result<(), Error> {
        // Verify the stream exists before accepting log entries.
        storage::get_stream(&env, stream_id).ok_or(Error::StreamNotFound)?;
        storage::append_event_log(&env, stream_id, data);
        Ok(())
    }

    /// Return the last ≤50 event payloads for `stream_id` in insertion order.
    pub fn get_stream_event_log(env: Env, stream_id: u64) -> soroban_sdk::Vec<Bytes> {
        storage::get_event_log(&env, stream_id)
    }

    /// Set the protocol fee in basis points (e.g. 100 = 1%). Admin-only.
    /// Cannot exceed MAX_FEE_BPS = 500 (5%).
    pub fn set_fee_bps(env: Env, bps: u32) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();

        if bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }

        storage::set_fee_bps(&env, bps);
        Ok(())
    }

    /// Set tiered fee configuration for "Whale" discounts. Admin-only.
    /// Tiers must be provided in ascending order of threshold for proper calculation.
    pub fn set_fee_tiers(env: Env, tiers: Vec<FeeTier>) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();

        // Validate that no tier exceeds the hard protocol cap.
        for tier in tiers.iter() {
            if tier.fee_bps > MAX_FEE_BPS {
                return Err(Error::FeeTooHigh);
            }
        }

        storage::set_fee_tiers(&env, tiers);
        Ok(())
    }

    /// Get the current tiered fee configuration.
    pub fn get_fee_tiers(env: Env) -> Vec<FeeTier> {
        match storage::get_fee_tiers(&env) {
            Some(tiers) => tiers,
            None => Vec::new(&env),
        }
    }

    pub fn add_to_whitelist(env: Env, asset: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::add_to_whitelist(&env, &asset);
        Ok(())
    }

    pub fn remove_from_whitelist(env: Env, asset: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::remove_from_whitelist(&env, &asset);
        Ok(())
    }

    pub fn is_asset_whitelisted(env: Env, asset: Address) -> bool {
        storage::is_asset_whitelisted(&env, &asset)
    }

    /// Get the current protocol fee in basis points.
    pub fn get_fee_bps(env: Env) -> u32 {
        storage::get_fee_bps(&env)
    }

    /// Withdraw accumulated protocol fees to the configured treasury. Admin-only.
    pub fn withdraw_treasury(env: Env, token: Address) -> Result<i128, Error> {
        storage::try_get_admin(&env)?.require_auth();

        let treasury = storage::get_treasury(&env).ok_or(Error::NoTreasury)?;
        let amount = storage::get_pending_fees(&env, &treasury, &token);
        if amount <= 0 {
            return Err(Error::NothingToWithdraw);
        }

        storage::clear_pending_fees(&env, &treasury, &token);

        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
        token_client.transfer(&env.current_contract_address(), &treasury, &amount);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(treasury.clone().into_val(&env));
        data.push_back(token.clone().into_val(&env));
        data.push_back(amount.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("fee_out"), treasury.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("fee_out"),
                data,
            },
        );

        Ok(amount)
    }

    /// Query pending fee balance for a `(recipient, token)` pair.
    pub fn get_pending_fees(env: Env, recipient: Address, token: Address) -> i128 {
        storage::get_pending_fees(&env, &recipient, &token)
    }

    /// Get the current withdrawal nonce for a beneficiary on a specific stream.
    /// Used for meta-transaction withdrawals to prevent replay attacks.
    pub fn get_withdrawal_nonce(env: Env, beneficiary: Address, stream_id: u64) -> u64 {
        let nonce_key = (symbol_short!("W_NONCE"), beneficiary, stream_id);
        env.storage().instance().get(&nonce_key).unwrap_or(0u64)
    }

    // ----------------------------------------------------------------
    // Nebula-DAO Vote-Weight Integration (Issue: Governance)
    // ----------------------------------------------------------------

    /// Set the DAO governance token contract address. Admin-only.
    pub fn set_dao_token(env: Env, token: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_dao_token(&env, &token);
        Ok(())
    }

    /// Set the minimum voting power threshold for treasury splits. Admin-only.
    pub fn set_voting_threshold(env: Env, threshold: i128) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_voting_threshold(&env, threshold);
        Ok(())
    }

    /// Query the DAO token balance of `addr` as a proxy for voting power.
    /// Returns `Err(DaoTokenNotSet)` if no DAO token has been configured.
    pub fn check_voting_power(env: Env, addr: Address) -> Result<i128, Error> {
        let dao_token = storage::get_dao_token(&env).ok_or(Error::UnauthorizedSender)?;
        let client = DaoTokenClient::new(&env, &dao_token);
        Ok(client.balance(&addr))
    }

    /// Execute an admin-only split from the Treasury account.
    ///
    /// The caller must hold DAO token balance >= the configured voting threshold.
    /// Funds are transferred from the treasury address to each recipient.
    ///
    /// # Parameters
    /// - `caller`: The address initiating the split (must have sufficient voting power).
    /// - `token`: The token to distribute.
    /// - `recipients`: List of recipient addresses.
    /// - `amounts`: Corresponding amounts for each recipient.
    pub fn treasury_split_by_vote(
        env: Env,
        caller: Address,
        token: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<(), Error> {
        caller.require_auth();

        // Check voting power
        let voting_power = Self::check_voting_power(env.clone(), caller.clone())?;
        let threshold = storage::get_voting_threshold(&env);
        if voting_power < threshold {
            return Err(Error::UnauthorizedSender);
        }

        let treasury = storage::get_treasury(&env).ok_or(Error::NoTreasury)?;
        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);

        for i in 0..recipients.len() {
            let recipient = recipients.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            token_client.transfer(&treasury, &recipient, &amount);
        }

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(caller.into_val(&env));
        data.push_back(token.clone().into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("dao_split"), token),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("dao_split"),
                data,
            },
        );

        Ok(())
    }

    // ----------------------------------------------------------------
    // Timelocked Treasury Splits (Issue: Governance Security)
    // ----------------------------------------------------------------

    /// Initiate a treasury split. Starts the 48-hour community veto window.
    ///
    /// Returns the `split_id` that must be passed to `execute_treasury_split`
    /// after the timelock expires.
    pub fn initiate_treasury_split(
        env: Env,
        initiator: Address,
        token: Address,
        recipients: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<u64, Error> {
        initiator.require_auth();
        storage::try_get_admin(&env)?.require_auth();

        let unlock_time = env.ledger().timestamp() + storage::ADMIN_DELAY;
        let split_id = storage::next_treasury_split_id(&env);

        storage::set_pending_treasury_split(
            &env,
            split_id,
            &storage::PendingTreasurySplit {
                initiator: initiator.clone(),
                token: token.clone(),
                recipients,
                amounts,
                unlock_time,
                executed: false,
            },
        );

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(split_id.into_val(&env));
        data.push_back(initiator.into_val(&env));
        data.push_back(token.into_val(&env));
        data.push_back(unlock_time.into_val(&env));

        env.events().publish(
            (symbol_short!("ts_init"), split_id),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("ts_init"),
                data,
            },
        );

        Ok(split_id)
    }

    /// Execute a pending treasury split after the 48-hour timelock has elapsed.
    ///
    /// Reverts with `TreasurySplitTimelocked` if called too early, or
    /// `TreasurySplitAlreadyExecuted` if already executed.
    pub fn execute_treasury_split(env: Env, caller: Address, split_id: u64) -> Result<(), Error> {
        caller.require_auth();
        storage::try_get_admin(&env)?.require_auth();

        let mut split = storage::get_pending_treasury_split(&env, split_id)
            .ok_or(Error::PendingSplitNotFound)?;

        if split.executed {
            return Err(Error::StreamReqAlreadyExecuted);
        }

        if env.ledger().timestamp() < split.unlock_time {
            return Err(Error::NotExecutionTime);
        }

        let treasury = storage::get_treasury(&env).ok_or(Error::NoTreasury)?;
        let token_client = soroban_sdk::token::TokenClient::new(&env, &split.token);

        for i in 0..split.recipients.len() {
            let recipient = split.recipients.get(i).unwrap();
            let amount = split.amounts.get(i).unwrap();
            token_client.transfer(&treasury, &recipient, &amount);
        }

        split.executed = true;
        storage::set_pending_treasury_split(&env, split_id, &split);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(split_id.into_val(&env));
        data.push_back(caller.into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("ts_exec"), split_id),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("ts_exec"),
                data,
            },
        );

        Ok(())
    }

    // ----------------------------------------------------------------
    // Issue #601 - Multi-Asset Batch Disbursement
    // Issue #604 - Gas-Efficient Loop Iteration
    // ----------------------------------------------------------------

    fn ensure_asset_interface(env: &Env, asset: &Address, from: &Address) -> Result<(), Error> {
        let token_client = soroban_sdk::token::TokenClient::new(env, asset);

        // Ensure the target asset can respond to balance query without trapping.
        if token_client.try_balance(from).is_err() {
            return Err(Error::AssetInterfaceNotSupported);
        }

        // Ensure transfer endpoint exists and can be invoked (no-op with 0 amount).
        let check_transfer_target = env.current_contract_address();
        if token_client
            .try_transfer(from, &check_transfer_target, &0)
            .is_err()
        {
            return Err(Error::AssetInterfaceNotSupported);
        }

        Ok(())
    }

    /// Disburse one asset to many recipients in a single atomic call.
    ///
    /// The caller must have pre-approved this contract (via `token.approve`) for
    /// the total amount to be transferred before invoking this function.
    pub fn split_funds(
        env: Env,
        sender: Address,
        asset: Address,
        recipients: Vec<Recipient>,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let n = recipients.len();
        // Issue #639 - batch recipient cap raised to 120 to avoid OOM.
        if n == 0 || n > 120 {
            return Err(Error::BatchTooLarge);
        }

        sender.require_auth();

        // Issue #603 - reentrancy guard
        storage::acquire_lock(&env)?;

        // Issue #632 - gas buffer check.
        let current_gas = storage::get_gas_buffer(&env, &sender);
        if current_gas < GAS_FEE_PER_SPLIT_STROOPS {
            storage::release_lock(&env);
            return Err(Error::InsufficientGasBuffer);
        }
        storage::set_gas_buffer(&env, &sender, current_gas - GAS_FEE_PER_SPLIT_STROOPS);

        // Issue #604 - validate all amounts before any external call
        for entry in recipients.iter() {
            if entry.amount <= 0 {
                storage::release_lock(&env);
                return Err(Error::BelowDustThreshold);
            }
        }

        // Issue #637 - Asset interface compatibility guard
        Self::ensure_asset_interface(&env, &asset, &sender)?;

        let token_client = soroban_sdk::token::TokenClient::new(&env, &asset);
        for entry in recipients.iter() {
            token_client.transfer(&sender, &entry.address, &entry.amount);
        }

        // Issue #603 - release lock
        storage::release_lock(&env);

        Ok(())
    }

    /// Disburse multiple assets to multiple recipients in a single atomic call.
    ///
    /// The caller must have pre-approved this contract (via `token.approve`) for
    /// each distinct asset/amount combination before invoking this function.
    /// Each `MultiAssetRecipient` row may specify a different asset, so USDC can
    /// go to some recipients while XLM (or any SAC-compliant token) goes to others.
    ///
    /// If a `fee_collector`, `fee_token`, and `fee_per_recipient` are configured
    /// by the admin, a flat fee of `fee_per_recipient * recipients.len()` is
    /// transferred from `from` to the `fee_collector` in the `fee_token` before
    /// the disbursements are executed (Issue #602).
    ///
    /// Gas optimizations (Issue #604):
    /// - Batch cap raised to 100.
    /// - All storage reads hoisted before the loop.
    /// - All amounts validated before any transfer (fail-fast, no partial state).
    /// - When all recipients share the same asset, a single TokenClient is
    ///   constructed once and reused, avoiding repeated cross-contract client
    ///   instantiation overhead per iteration.
    ///
    /// Panics (via `require_auth`) if the caller has not authorised the transaction.
    pub fn split_multi_asset(
        env: Env,
        from: Address,
        recipients: Vec<MultiAssetRecipient>,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let n = recipients.len();
        // Issue #639 — batch recipient cap raised to 120 to avoid OOM.
        if n == 0 || n > 120 {
            return Err(Error::BatchTooLarge);
        }

        from.require_auth();

        // Issue #603 — reentrancy guard
        storage::acquire_lock(&env)?;

        // Issue #632 — gas buffer check.
        let current_gas = storage::get_gas_buffer(&env, &from);
        if current_gas < GAS_FEE_PER_SPLIT_STROOPS {
            storage::release_lock(&env);
            return Err(Error::InsufficientGasBuffer);
        }
        storage::set_gas_buffer(&env, &from, current_gas - GAS_FEE_PER_SPLIT_STROOPS);

        // Issue #604 — hoist all storage reads before the loop
        let fee_per_recipient = storage::get_fee_per_recipient(&env);
        let fee_collector = if fee_per_recipient > 0 {
            Some(storage::get_fee_collector(&env).ok_or(Error::NoTreasury)?)
        } else {
            None
        };
        let fee_token_addr = if fee_per_recipient > 0 {
            Some(storage::get_fee_token(&env).ok_or(Error::NoTreasury)?)
        } else {
            None
        };

        // Issue #604 — validate all amounts before any external call
        let first_asset = recipients.get(0).unwrap().asset.clone();
        let mut homogeneous = true;

        for entry in recipients.iter() {
            if entry.amount <= 0 {
                storage::release_lock(&env);
                return Err(Error::BelowDustThreshold);
            }

            // Issue #637 — Asset interface compatibility guard
            Self::ensure_asset_interface(&env, &entry.asset, &from)?;

            if entry.asset != first_asset {
                homogeneous = false;
            }
        }

        // Issue #602 — collect protocol fee
        if fee_per_recipient > 0 {
            // Validate fee token interface before collecting.
            let fee_token = fee_token_addr.as_ref().unwrap();
            Self::ensure_asset_interface(&env, fee_token, &from)?;

            let total_fee = fee_per_recipient
                .checked_mul(n as i128)
                .ok_or(Error::Overflow)?;
            soroban_sdk::token::TokenClient::new(&env, fee_token).transfer(
                &from,
                fee_collector.as_ref().unwrap(),
                &total_fee,
            );
        }

        // Issue #604 — detect homogeneous batch: if all entries share the same
        // asset, construct one TokenClient and reuse it across all iterations,
        // avoiding repeated client instantiation overhead.
        if homogeneous {
            let token_client = soroban_sdk::token::TokenClient::new(&env, &first_asset);
            for entry in recipients.iter() {
                token_client.transfer(&from, &entry.address, &entry.amount);
            }
        } else {
            for entry in recipients.iter() {
                soroban_sdk::token::TokenClient::new(&env, &entry.asset).transfer(
                    &from,
                    &entry.address,
                    &entry.amount,
                );
            }
        }

        // Issue #603 — release lock
        storage::release_lock(&env);

        Ok(())
    }

    // ----------------------------------------------------------------
    // Issue #602 — Protocol Fee Capture: admin helpers
    // ----------------------------------------------------------------

    /// Set the address that collects disbursement fees. Admin-only.
    pub fn set_fee_collector(env: Env, collector: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_fee_collector(&env, &collector);
        Ok(())
    }

    /// Get the current fee collector address.
    pub fn get_fee_collector(env: Env) -> Option<Address> {
        storage::get_fee_collector(&env)
    }

    /// Sweep rounding dust accumulated in the contract.
    /// Rounding errors in integer math can result in fractional "dust" accumulating
    /// in the contract over thousands of transactions. This function allows the
    /// admin to sweep these unallocated orphan balances.
    ///
    /// Logic: Verify that the amount requested is indeed unallocated (calculated by:
    /// Contract_Balance - Total_Pending_Claims).
    ///
    /// Auth: Gated by the Multi-Admin Quorum (Admin).
    pub fn reclaim_dust(env: Env, asset: Address, amount: i128) -> Result<i128, Error> {
        let admin = storage::try_get_admin(&env)?;
        admin.require_auth();

        if amount <= 0 {
            return Err(Error::BelowDustThreshold);
        }

        let (contract_balance, sum_remaining) =
            Self::check_balance_integrity(env.clone(), asset.clone());
        let unallocated = contract_balance.saturating_sub(sum_remaining);

        if amount > unallocated {
            return Err(Error::NothingToWithdraw);
        }

        let token_client = soroban_sdk::token::TokenClient::new(&env, &asset);
        token_client.transfer(&env.current_contract_address(), &admin, &amount);

        let now = env.ledger().timestamp();
        let mut data = Vec::new(&env);
        data.push_back(asset.clone().into_val(&env));
        data.push_back(amount.into_val(&env));
        data.push_back(admin.clone().into_val(&env));
        data.push_back(now.into_val(&env));

        env.events().publish(
            (symbol_short!("dust_out"), admin.clone()),
            NebulaEvent {
                version: 2,
                timestamp: now,
                action: symbol_short!("dust_out"),
                data,
            },
        );

        Ok(amount)
    }

    /// Set the token used to pay disbursement fees. Admin-only.
    pub fn set_fee_token(env: Env, token: Address) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        storage::set_fee_token(&env, &token);
        Ok(())
    }

    /// Set the per-recipient fee amount (in fee_token base units). Admin-only.
    /// Pass 0 to disable fee collection.
    pub fn set_fee_per_recipient(env: Env, amount: i128) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();
        if amount < 0 {
            return Err(Error::BelowDustThreshold);
        }
        storage::set_fee_per_recipient(&env, amount);
        Ok(())
    }

    /// Get the current per-recipient fee amount.
    pub fn get_fee_per_recipient(env: Env) -> i128 {
        storage::get_fee_per_recipient(&env)
    }

    // ----------------------------------------------------------------
    // Issue #632 — Gas-Tank Internal XLM Buffer
    // ----------------------------------------------------------------

    pub fn deposit_gas_buffer(env: Env, sender: Address, amount: i128) -> Result<(), Error> {
        sender.require_auth();
        if amount <= 0 {
            return Err(Error::BelowDustThreshold);
        }

        let fee_token = storage::get_fee_token(&env).ok_or(Error::NoTreasury)?;
        let token_client = soroban_sdk::token::TokenClient::new(&env, &fee_token);

        token_client.transfer(&sender, &env.current_contract_address(), &amount);

        let current = storage::get_gas_buffer(&env, &sender);
        storage::set_gas_buffer(
            &env,
            &sender,
            current.checked_add(amount).ok_or(Error::Overflow)?,
        );

        Ok(())
    }

    pub fn withdraw_gas_buffer(
        env: Env,
        admin: Address,
        amount: i128,
        to: Address,
    ) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();

        if amount <= 0 {
            return Err(Error::BelowDustThreshold);
        }

        let current = storage::get_gas_buffer(&env, &admin);
        if current < amount {
            return Err(Error::InsufficientGasBuffer);
        }

        storage::set_gas_buffer(&env, &admin, current - amount);

        let fee_token = storage::get_fee_token(&env).ok_or(Error::NoTreasury)?;
        let token_client = soroban_sdk::token::TokenClient::new(&env, &fee_token);
        token_client.transfer(&env.current_contract_address(), &to, &amount);

        Ok(())
    }

    pub fn get_gas_buffer_balance(env: Env, user: Address) -> i128 {
        storage::get_gas_buffer(&env, &user)
    }

    // ----------------------------------------------------------------
    // Emergency Recovery Multi-Sig (Issue: Security Critical)
    // ----------------------------------------------------------------

    /// Configure the recovery council and required signature threshold.
    ///
    /// Can only be called by the current admin. The council addresses are
    /// stored on-chain and cannot be changed without another admin call,
    /// preventing a compromised admin from silently swapping council members
    /// after the fact.
    ///
    /// # Parameters
    /// - `admin`: Current contract admin (must sign).
    /// - `council`: Vec of council member addresses (hardcoded or set here at init).
    /// - `threshold`: Minimum signatures required to execute recovery.
    pub fn set_recovery_council(
        env: Env,
        admin: Address,
        council: Vec<Address>,
        threshold: u32,
    ) -> Result<(), Error> {
        storage::try_get_admin(&env)?.require_auth();

        if threshold == 0 || threshold > council.len() {
            return Err(Error::InvalidThreshold);
        }

        storage::set_recovery_council(&env, &council, threshold);
        Ok(())
    }

    /// Return the configured recovery council.
    pub fn get_recovery_council(env: Env) -> Option<Vec<Address>> {
        storage::get_recovery_council(&env)
    }

    /// Initiate the 7-day recovery grace period.
    ///
    /// Any single council member can call this to start the clock. Once
    /// initiated, the council has 7 days to gather enough signatures before
    /// calling `recovery_split`.
    ///
    /// # Parameters
    /// - `initiator`: A council member address (must sign).
    pub fn init_recovery(env: Env, initiator: Address) -> Result<(), Error> {
        let council = storage::get_recovery_council(&env).ok_or(Error::NotCouncilMember)?;

        if !council.contains(&initiator) {
            return Err(Error::NotCouncilMember);
        }
        initiator.require_auth();

        if storage::get_recovery_initiated_at(&env).is_some() {
            return Err(Error::RecoveryAlreadyInitiated);
        }

        let now = env.ledger().timestamp();
        storage::set_recovery_initiated_at(&env, now);

        env.events()
            .publish((soroban_sdk::symbol_short!("rec_init"), initiator), now);

        Ok(())
    }

    /// Execute an emergency recovery split after the 7-day grace period.
    ///
    /// Requires at least `recovery_threshold` council signatures. Transfers
    /// the full contract token balance to `destination`.
    ///
    /// # Parameters
    /// - `council_signatures`: Vec of council member addresses signing this call.
    /// - `token`: The token to recover.
    /// - `destination`: Address that receives the recovered funds.
    pub fn recovery_split(
        env: Env,
        council_signatures: Vec<Address>,
        token: Address,
        destination: Address,
    ) -> Result<i128, Error> {
        let council = storage::get_recovery_council(&env).ok_or(Error::NotCouncilMember)?;

        let initiated_at =
            storage::get_recovery_initiated_at(&env).ok_or(Error::RecoveryNotInitiated)?;

        // Enforce 7-day grace period.
        let now = env.ledger().timestamp();
        if now < initiated_at.saturating_add(storage::RECOVERY_GRACE_PERIOD) {
            return Err(Error::NotExecutionTime);
        }

        let threshold = storage::get_recovery_threshold(&env);
        let mut approvals = storage::get_recovery_approvals(&env);

        // Validate and auth each signer; deduplicate.
        for signer in council_signatures.iter() {
            if !council.contains(&signer) {
                return Err(Error::NotCouncilMember);
            }
            if approvals.contains(&signer) {
                return Err(Error::AlreadyApproved);
            }
            signer.require_auth();
            approvals.push_back(signer.clone());
        }

        if approvals.len() < threshold {
            // Persist partial approvals so subsequent calls can accumulate.
            env.storage()
                .instance()
                .set(&crate::storage::DataKeyV2::RecoveryApprovals, &approvals);
            storage::bump_instance(&env);
            return Err(Error::NotEnoughSigners);
        }

        // Transfer the full balance of `token` to `destination`.
        let token_client = soroban_sdk::token::TokenClient::new(&env, &token);
        let balance = token_client.balance(&env.current_contract_address());

        if balance > 0 {
            token_client.transfer(&env.current_contract_address(), &destination, &balance);
        }

        // Clear recovery state to prevent replay.
        storage::clear_recovery(&env);

        env.events().publish(
            (soroban_sdk::symbol_short!("rec_exec"), destination.clone()),
            balance,
        );

        Ok(balance)
    }

    // ----------------------------------------------------------------
    // Issue #912 - Variable Basis Point (BPS) Math Engine
    // ----------------------------------------------------------------

    /// Disburse funds to multiple recipients using Basis Points (BPS) for
    /// pro-rata distribution. Implements the "Residual Allocation Strategy"
    /// to handle integer rounding dust.
    pub fn split_by_bps(
        env: Env,
        sender: Address,
        asset: Address,
        recipients: Vec<BpsRecipient>,
        total_amount: i128,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;

        let n = recipients.len();
        if n == 0 || n > 120 {
            return Err(Error::BatchTooLarge);
        }

        if total_amount <= 0 {
            return Err(Error::BelowDustThreshold);
        }

        sender.require_auth();

        // 1. Pre-flight check: validate BPS sum equals 10,000 (100%)
        let mut total_bps: u32 = 0;
        for entry in recipients.iter() {
            total_bps = total_bps.checked_add(entry.bps).ok_or(Error::Overflow)?;
        }
        if total_bps != 10_000 {
            return Err(Error::InvalidPenalty);
        }

        // 2. Reentrancy guard
        storage::acquire_lock(&env)?;

        // 3. Execution: Distribute shares
        let token_client = soroban_sdk::token::TokenClient::new(&env, &asset);
        let mut sum_distributed: i128 = 0;

        for i in 0..n {
            let entry = recipients.get(i).unwrap();

            let amount = if i == n - 1 {
                // Final recipient: apply rounding strategy to assign remainder
                math::calculate_residual_share(total_amount, sum_distributed)
            } else {
                let share = math::calculate_share(total_amount, entry.bps);
                sum_distributed = sum_distributed.checked_add(share).ok_or(Error::Overflow)?;
                share
            };

            if amount > 0 {
                // transfer traps and reverts the transaction on failure, ensuring atomicity
                token_client.transfer(&sender, &entry.address, &amount);
            }
        }

        storage::release_lock(&env);
        Ok(())
    }
}

mod test;
// mod token_security_test;
mod v1_to_v2_integration_test;
