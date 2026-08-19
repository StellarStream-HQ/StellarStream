# StellarStream Contracts 🌊

**Real-time asset streaming smart contracts on Stellar/Soroban**

A comprehensive, production-ready protocol for continuous token streaming with advanced security features, role-based access control, and mathematical precision.

---

## 🚀 Quick Start (15-minute overview)

### What is StellarStream?
StellarStream transforms traditional lump-sum payments into continuous streams. Instead of paying $1000 monthly, you can stream $1000 over 30 days, unlocking ~$33.33 daily as time passes.

### Core Concept
```
Traditional: [----$1000----] (paid once)
Streaming:   [$33][$33][$33]... (unlocks continuously)
```

The contract calculates unlocked amounts using precise mathematical formulas, allowing receivers to withdraw their earned portion at any time.

---

## 📊 Mathematical Engine

### Linear Vesting (Default)
The standard streaming formula provides proportional unlocking:

```
unlocked_amount = total_amount × (elapsed_time / total_duration)
```

**Example**: $1000 stream over 100 days
- Day 25: $250 unlocked (25% complete)
- Day 50: $500 unlocked (50% complete)
- Day 100: $1000 unlocked (100% complete)

### Exponential Curve (Optional)
Accelerated vesting using quadratic growth:

```
unlocked_amount = total_amount × (elapsed_time² / total_duration²)
```

**Example**: Same $1000 stream with exponential curve
- Day 25: $62.50 unlocked (6.25% complete)
- Day 50: $250 unlocked (25% complete)  
- Day 75: $562.50 unlocked (56.25% complete)
- Day 100: $1000 unlocked (100% complete)

### Cliff Support
Nothing unlocks before the cliff time, then normal vesting begins:

```rust
if current_time < cliff_time {
    return 0;  // Nothing unlocked yet
}
// Otherwise, calculate from cliff_time to end_time
```

### Precision & Safety
- **Integer Math**: Uses i128 for all calculations
- **Floor Division**: Always rounds DOWN to favor contract solvency
- **Overflow Protection**: Checked multiplication prevents arithmetic overflow
- **Dust Prevention**: Final withdrawals use exact remaining balance

---

## 🔒 Security Features

### 1. Re-entrancy Protection
```rust
// Mutex pattern prevents re-entrant calls
let lock_key = symbol_short!("LOCK");
env.storage().temporary().set(&lock_key, &true);
// ... perform operations ...
env.storage().temporary().remove(&lock_key);
```

### 2. Role-Based Access Control (RBAC)
Three distinct roles with granular permissions:

| Role | Permissions |
|------|-------------|
| **Admin** | Grant/revoke roles, upgrade contract, all other permissions |
| **Pauser** | Pause/unpause contract operations (emergency stop) |
| **TreasuryManager** | Update protocol fees, change treasury address |

### 3. OFAC Compliance
Maintains a restricted address list to prevent streams to sanctioned addresses:
```rust
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)
```

### 4. Soulbound Streams
Identity-locked streams that cannot be transferred:
```rust
Stream {
    is_soulbound: true,  // Set once at creation, immutable
    receiver: verified_address,  // Cannot be changed
    // ... other fields
}
```

### 5. Pause/Resume Mechanism
Senders can pause and resume streams using the `StreamState` enum (`Active`, `Paused`, `Closed`):
```rust
// Pause a stream - stops vesting
pub fn pause_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// Resume a paused stream - restores vesting with adjusted duration
pub fn resume_stream(env: Env, stream_id: u64, caller: Address) -> Result<(), Error>

// Paused duration is subtracted from calculations
effective_elapsed = current_time - start_time - total_paused_duration;
```

---

## 🏗️ Architecture Overview

### Core Data Structures

#### Stream
```rust
pub struct Stream {
    pub sender: Address,           // Who created the stream
    pub receiver: Address,         // Who receives the tokens
    pub token: Address,            // Token contract address
    pub total_amount: i128,        // Total tokens to stream
    pub start_time: u64,           // When streaming begins
    pub end_time: u64,             // When streaming ends
    pub withdrawn_amount: i128,    // Already withdrawn tokens
    pub state: StreamState,        // Active, Paused, or Closed
    pub curve_type: CurveType,     // Linear or Exponential
    pub is_soulbound: bool,        // Transfer restriction
    // ... additional fields for advanced features
}
```

#### Key Enums
```rust
pub enum CurveType {
    Linear = 0,      // Proportional unlocking
    Exponential = 1, // Quadratic acceleration
}

pub enum StreamState {
    Active = 0,      // Tokens are vesting normally
    Paused = 1,      // Vesting is suspended
    Closed = 2,      // Stream is cancelled/ended
}

pub enum Role {
    Admin,           // Full permissions
    Pauser,          // Emergency controls
    TreasuryManager, // Fee management
}
```

### Storage Architecture
- **Instance Storage**: Contract configuration, admin settings
- **Persistent Storage**: Individual streams, user data
- **Temporary Storage**: Re-entrancy locks, flash loan states

---

## 🛠️ Developer Guide

### Prerequisites
- Rust 1.70+
- Soroban CLI
- Stellar SDK

### Building the Contract
```bash
cd contracts/
cargo build --target wasm32-unknown-unknown --release
```

### Running Tests
```bash
# Run all tests (40+ test cases)
cargo test

# Run specific test modules
cargo test rbac_test
cargo test soulbound_test
cargo test migration_test

# Run with output
cargo test -- --nocapture

# Run benchmarks
cargo test bench_ --release
```

### Test Structure
```
src/
├── test.rs           # Core functionality tests (20+ tests)
├── rbac_test.rs      # Role-based access control (15+ tests)
├── soulbound_test.rs # Soulbound stream tests (8+ tests)
├── migration_test.rs # Schema migration tests (15+ tests)
├── upgrade_test.rs   # Contract upgrade tests (5+ tests)
├── pause_resume_test.rs # Pause/resume tests (8+ tests)
├── bench_test.rs     # Performance benchmarks (9+ tests)
```

### Deploying to Testnet
```bash
# Build optimized WASM
stellar contract build

# Deploy to Futurenet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm \
  --source alice \
  --network futurenet

# Initialize contract
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source alice \
  --network futurenet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

---

## 📚 API Reference

### Core Functions

#### Stream Management
```rust
// Create a new stream
pub fn create_stream(
    env: Env,
    sender: Address,
    receiver: Address,
    token: Address,
    total_amount: i128,
    start_time: u64,
    end_time: u64,
    curve_type: CurveType,
    is_soulbound: bool,
) -> Result<u64, Error>

// Withdraw unlocked tokens
pub fn withdraw(
    env: Env,
    stream_id: u64,
    receiver: Address,
) -> Result<i128, Error>

// Cancel stream early
pub fn cancel_stream(
    env: Env,
    stream_id: u64,
    sender: Address,
) -> Result<(), Error>

// Pause a stream (stops vesting, only sender)
pub fn pause_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>

// Resume a paused stream (restores vesting)
pub fn resume_stream(
    env: Env,
    stream_id: u64,
    caller: Address,
) -> Result<(), Error>
```

#### Multi-Signature Proposals
```rust
// Create proposal for treasury streams
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
) -> Result<u64, Error>

// Approve proposal (auto-executes when threshold met)
pub fn approve_proposal(
    env: Env,
    proposal_id: u64,
    approver: Address,
) -> Result<(), Error>
```

#### Administrative Functions
```rust
// RBAC management
pub fn grant_role(env: Env, admin: Address, account: Address, role: Role)
pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role)

// OFAC compliance
pub fn restrict_address(env: Env, admin: Address, target: Address)
pub fn unrestrict_address(env: Env, admin: Address, target: Address)

// Emergency controls
pub fn pause_contract(env: Env, pauser: Address)
pub fn unpause_contract(env: Env, pauser: Address)
```

### Query Functions
```rust
// Get stream details
pub fn get_stream(env: Env, stream_id: u64) -> Result<Stream, Error>

// Calculate current unlocked amount
pub fn get_unlocked_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Check withdrawable balance
pub fn get_withdrawable_amount(env: Env, stream_id: u64) -> Result<i128, Error>

// Get user's streams
pub fn get_user_streams(env: Env, user: Address) -> Vec<u64>
```

---

## 🔧 Advanced Features

### Interest Distribution
Streams can earn yield through vault integration:
```rust
pub struct Stream {
    pub interest_strategy: u32,     // Bitfield for distribution
    pub vault_address: Option<Address>, // Yield-bearing vault
    // ...
}

// Interest distribution strategies
const INTEREST_TO_SENDER: u32 = 0b001;     // All to sender
const INTEREST_TO_RECEIVER: u32 = 0b010;   // All to receiver  
const INTEREST_TO_PROTOCOL: u32 = 0b100;   // All to protocol
const INTEREST_SPLIT_ALL: u32 = 0b111;     // 33/33/33 split
```

### USD Pegging
Oracle-based USD amount conversion:
```rust
pub struct UsdPegConfig {
    pub usd_amount: i128,        // USD amount (7 decimals)
    pub min_price: i128,         // Slippage protection
    pub max_price: i128,         // Slippage protection
    pub oracle: PriceOracle,     // Price feed
}
```

### Milestone Vesting
Custom unlock schedules:
```rust
pub struct Milestone {
    pub timestamp: u64,    // When to unlock
    pub percentage: u32,   // Percentage to unlock (basis points)
}

// Example: 25% at 3 months, 75% at 6 months
let milestones = vec![
    Milestone { timestamp: start + 90_days, percentage: 2500 },
    Milestone { timestamp: start + 180_days, percentage: 7500 },
];
```

### Flash Loans
Temporary liquidity for arbitrage:
```rust
pub fn flash_loan(
    env: Env,
    borrower: Address,
    token: Address,
    amount: i128,
    callback_data: BytesN<32>,
) -> Result<(), Error>
```

---

## 🧪 Testing Guide

### Test Categories

#### 1. Core Functionality Tests (`test.rs`)
- Stream creation and validation
- Withdrawal calculations
- Cancellation logic
- Edge cases and error conditions

#### 2. Security Tests (`rbac_test.rs`, `soulbound_test.rs`)
- Role-based access control
- Soulbound transfer restrictions
- Authorization checks
- Permission boundaries

#### 3. Integration Tests (`migration_test.rs`, `upgrade_test.rs`)
- Contract upgrades
- Data migration
- Backward compatibility
- Version management

#### 4. Performance Tests (`bench_test.rs`)
- Gas optimization verification
- Batch operation efficiency
- Storage access patterns
- Scalability limits

### Running Specific Test Suites
```bash
# Test core streaming logic
cargo test test_create_stream
cargo test test_withdraw
cargo test test_cancel_stream

# Test security features
cargo test test_soulbound
cargo test test_rbac
cargo test test_restricted_address

# Test mathematical precision
cargo test test_precision
cargo test test_rounding
cargo test test_overflow_protection

# Performance benchmarks
cargo test bench_create_stream --release
cargo test bench_withdraw_batch --release
```

### Test Data Patterns
```rust
// Standard test setup
fn setup_test() -> (Env, Address, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let sender = Address::generate(&env);
    let receiver = Address::generate(&env);
    
    // Initialize contract
    initialize(&env, admin.clone());
    
    (env, admin, sender, receiver)
}

// Error testing pattern
#[test]
#[should_panic(expected = "StreamNotFound")]
fn test_withdraw_nonexistent_stream() {
    let (env, _, _, receiver) = setup_test();
    withdraw(&env, 999, receiver); // Should panic
}
```

---

## 📈 Gas Optimization

### Optimization Strategies
1. **Batch Operations**: Create multiple streams in single transaction
2. **Storage Efficiency**: Packed data structures, minimal storage reads
3. **Mathematical Precision**: Integer-only arithmetic, no floating point
4. **Event Optimization**: Selective event emission
5. **Memory Management**: Reuse allocations, minimize clones

### Benchmark Results
```
Operation              | Gas Cost | Optimized Cost | Savings
-----------------------|----------|----------------|--------
create_stream          | 45,000   | 42,000        | 6.7%
withdraw               | 35,000   | 32,000        | 8.6%
cancel_stream          | 40,000   | 37,000        | 7.5%
batch_create (10x)     | 420,000  | 380,000       | 9.5%
```

---

## 🚨 Error Handling

### Error Types
```rust
pub enum Error {
    AlreadyInitialized = 1,      // Contract already set up
    InvalidTimeRange = 2,        // start_time >= end_time
    InvalidAmount = 3,           // amount <= 0
    StreamNotFound = 4,          // Invalid stream_id
    Unauthorized = 5,            // Missing permissions
    AlreadyCancelled = 6,        // Stream already cancelled
    InsufficientBalance = 7,     // Not enough tokens
    StreamPaused = 14,           // Cannot withdraw while paused
    StreamIsSoulbound = 21,      // Transfer not allowed
    AddressRestricted = 22,      // OFAC compliance violation
    StreamNotPaused = 26,        // Cannot resume an active stream
    // ... 26 total error types
}
```

### Error Handling Patterns
```rust
// Result-based error handling
match create_stream(&env, sender, receiver, token, amount, start, end, curve, false) {
    Ok(stream_id) => {
        // Stream created successfully
        log!(&env, "Stream {} created", stream_id);
    },
    Err(Error::InvalidAmount) => {
        // Handle invalid amount
        panic_with_error!(&env, Error::InvalidAmount);
    },
    Err(e) => {
        // Handle other errors
        panic_with_error!(&env, e);
    }
}
```

---

## 🔄 Migration & Upgrades

### Contract Upgradability
The contract supports WASM upgrades through admin functions:
```rust
pub fn upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>)
```

### Data Migration Framework
Automatic migration system for storage schema changes:
```rust
pub fn migrate(env: Env, admin: Address, target_version: u32)
pub fn migrate_single_stream(env: Env, admin: Address, stream_id: u64)
```

### Version Management
```rust
// Check current version
pub fn get_version(env: Env) -> u32

// Migration preserves all data
// - Stream balances remain accurate
// - Withdrawn amounts preserved
// - User permissions maintained
```

---

## 📋 Production Checklist

### Pre-Deployment
- [ ] All tests passing (`cargo test`)
- [ ] Security audit completed
- [ ] Gas optimization verified
- [ ] Documentation updated
- [ ] Admin keys secured

### Post-Deployment
- [ ] Contract initialized with correct admin
- [ ] Role assignments configured
- [ ] Fee parameters set
- [ ] Treasury address configured
- [ ] Monitoring systems active

### Ongoing Maintenance
- [ ] Regular security reviews
- [ ] Performance monitoring
- [ ] User feedback integration
- [ ] Feature enhancement planning
- [ ] Compliance updates

---

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch: `git checkout -b feature/your-feature`
3. Write tests first (TDD approach)
4. Implement functionality
5. Ensure all tests pass: `cargo test`
6. Submit pull request

### Code Standards
- Follow Rust naming conventions
- Add comprehensive tests for new features
- Document public functions with rustdoc
- Use `#[allow(dead_code)]` sparingly
- Prefer explicit error handling over panics

### Testing Requirements
- Unit tests for all public functions
- Integration tests for complex workflows
- Error case coverage with `#[should_panic]`
- Performance benchmarks for gas-sensitive operations

---

## 📞 Support & Resources

### Documentation
- [RBAC Implementation](./RBAC.md)
- [Soulbound Streams](./SOULBOUND.md)
- [OFAC Compliance](./OFAC_COMPLIANCE.md)
- [Interest Distribution](./INTEREST_DISTRIBUTION.md)
- [Migration Framework](./MIGRATION_FRAMEWORK.md)
- [Contract Migration Guide (V1 → V2)](./docs/MIGRATION_GUIDE.md)
- [Migration Scripts](./scripts/migrate/README.md)

### Community
- GitHub Issues: Bug reports and feature requests
- Discussions: Architecture and design questions
- Discord: Real-time developer support

### Security
- Security issues: security@stellarstream.io
- Bug bounty program: Available for critical vulnerabilities
- Audit reports: Available in `/contracts/audit.md`

---

*Built with ❤️ for the Stellar ecosystem*