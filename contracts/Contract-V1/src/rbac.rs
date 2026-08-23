#![allow(unused)]

use soroban_sdk::{contracterror, contracttype, panic_with_error, Address, Env, Vec};

/// Role enumeration for granular RBAC system
///
/// Defines three distinct roles with clearly scoped permissions:
/// - SuperAdmin: Authority to upgrade contract code and manage role assignments
/// - FinancialOperator: Authority to manage fees and financial parameters
/// - Guardian: Authority to pause/freeze contract operations during emergencies
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Authority to upgrade contract code and manage role assignments.
    SuperAdmin,
    /// Authority to manage fees and other financial parameters.
    FinancialOperator,
    /// Authority to pause, unpause, or freeze contract operations during emergencies.
    Guardian,
}

/// Storage key enumeration for role membership data
///
/// Uses deterministic keys derived from Role enum to ensure consistent
/// access patterns across contract invocations
#[derive(Clone)]
#[contracttype]
pub enum StorageKey {
    /// Membership list (`Vec<Address>`) for a given role.
    RoleMembers(Role),
    /// Configured fee amount.
    Fee,
    /// Whether contract operations are currently paused.
    Paused,
    /// Whether the contract is in an emergency-frozen state.
    Frozen,
}

/// Error types for RBAC operations
///
/// Provides descriptive error codes for each distinct failure condition
/// to enable clear debugging and user feedback
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RBACError {
    /// Generic unauthorized access attempt
    Unauthorized = 1,
    /// Operation requires Super Admin privileges
    SuperAdminRequired = 2,
    /// Operation requires Financial Operator privileges
    FinancialOperatorRequired = 3,
    /// Operation requires Guardian privileges
    GuardianRequired = 4,
    /// Address already assigned to the specified role
    AddressAlreadyHasRole = 5,
    /// Cannot remove the last Super Admin (would lock contract)
    CannotRemoveLastSuperAdmin = 6,
    /// Address not found in the specified role
    AddressNotFound = 7,
}
/// Retrieves all addresses assigned to a role from persistent storage
///
/// # Arguments
/// * `env` - The contract environment
/// * `role` - The role to query
///
/// # Returns
/// Vector of addresses assigned to the role. Returns empty vector if role has no members.
///
/// # Requirements
/// Satisfies requirements 1.1, 1.2, 1.3 (Role Storage and Persistence)
fn get_role_members(env: &Env, role: Role) -> Vec<Address> {
    let key = StorageKey::RoleMembers(role);
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env))
}

/// Checks if an address is assigned to a role
///
/// # Arguments
/// * `env` - The contract environment
/// * `role` - The role to check
/// * `address` - The address to verify membership for
///
/// # Returns
/// Boolean indicating whether the address exists in the role's member collection
///
/// # Requirements
/// Satisfies requirements 2.2 (Multiple Address Support Per Role - membership check)
/// and 11.1 (Efficient Membership Lookup - O(n) time complexity)
fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    let members = get_role_members(env, role);
    members.iter().any(|member| &member == address)
}

/// Adds an address to a role's member collection
///
/// # Arguments
/// * `env` - The contract environment
/// * `role` - The role to add the address to
/// * `address` - The address to add to the role
///
/// # Returns
/// Result indicating success or error if address already exists in role
///
/// # Requirements
/// Satisfies requirements 2.1 (Multiple Address Support Per Role - append to collection),
/// 3.1 (Duplicate Prevention - reject if exists), 3.2 (Duplicate Prevention - add if not exists),
/// and 3.3 (Duplicate Prevention - check before modifying storage)
fn add_role_member(env: &Env, role: Role, address: Address) -> Result<(), RBACError> {
    let mut members = get_role_members(env, role);

    // Check for duplicates (Requirement 3.1, 3.3)
    if members.iter().any(|member| member == address) {
        return Err(RBACError::AddressAlreadyHasRole);
    }

    // Append address to vector (Requirement 2.1, 3.2)
    members.push_back(address);

    // Store updated vector in persistent storage (Requirement 2.1)
    let key = StorageKey::RoleMembers(role);
    env.storage().persistent().set(&key, &members);

    Ok(())
}

/// Removes an address from a role's member collection
///
/// # Arguments
/// * `env` - The contract environment
/// * `role` - The role to remove the address from
/// * `address` - The address to remove from the role
///
/// # Returns
/// Result indicating success or error if address not found or if removing last Super Admin
///
/// # Requirements
/// Satisfies requirements 2.3 (Multiple Address Support Per Role - remove specific address),
/// 4.1 (Super Admin Existence Guarantee - reject if last Super Admin),
/// 4.2 (Super Admin Existence Guarantee - allow if others exist),
/// and 10.3 (Descriptive Error Handling - error for last Super Admin)
fn remove_role_member(env: &Env, role: Role, address: &Address) -> Result<(), RBACError> {
    let mut members = get_role_members(env, role);

    // Find the address position in the vector
    let position = members
        .iter()
        .position(|member| &member == address)
        .ok_or(RBACError::AddressNotFound)?;

    // Check if removing last Super Admin (Requirement 4.1, 10.3)
    if role == Role::SuperAdmin && members.len() == 1 {
        return Err(RBACError::CannotRemoveLastSuperAdmin);
    }

    // Remove address from vector (Requirement 2.3, 4.2)
    members.remove(position as u32);

    // Store updated vector in persistent storage (Requirement 2.3)
    let key = StorageKey::RoleMembers(role);
    env.storage().persistent().set(&key, &members);

    Ok(())
}

/// Validates that the invoker has Super Admin privileges
///
/// # Arguments
/// * `env` - The contract environment
/// * `caller` - The address attempting to perform the operation
///
/// # Panics
/// Panics with RBACError::SuperAdminRequired if the caller is not a Super Admin
///
/// # Requirements
/// Satisfies requirements 5.1 (Guard Function Implementation - provide ensure_super_admin),
/// 5.4 (Guard Function Implementation - retrieve invoker address),
/// 5.5 (Guard Function Implementation - verify invoker in role collection),
/// 5.6 (Guard Function Implementation - panic with descriptive error),
/// and 10.1 (Descriptive Error Handling - error indicating required role)
fn ensure_super_admin(env: &Env, caller: &Address) {
    if !has_role(env, Role::SuperAdmin, caller) {
        panic_with_error!(env, RBACError::SuperAdminRequired);
    }
}

/// Validates that the invoker has Financial Operator privileges
///
/// # Arguments
/// * `env` - The contract environment
/// * `caller` - The address attempting to perform the operation
///
/// # Panics
/// Panics with RBACError::FinancialOperatorRequired if the caller is not a Financial Operator
///
/// # Requirements
/// Satisfies requirements 5.2 (Guard Function Implementation - provide ensure_financial_operator),
/// 5.4 (Guard Function Implementation - retrieve invoker address),
/// 5.5 (Guard Function Implementation - verify invoker in role collection),
/// 5.6 (Guard Function Implementation - panic with descriptive error),
/// and 10.1 (Descriptive Error Handling - error indicating required role)
fn ensure_financial_operator(env: &Env, caller: &Address) {
    if !has_role(env, Role::FinancialOperator, caller) {
        panic_with_error!(env, RBACError::FinancialOperatorRequired);
    }
}

/// Validates that the invoker has Guardian privileges
///
/// # Arguments
/// * `env` - The contract environment
/// * `caller` - The address attempting to perform the operation
///
/// # Panics
/// Panics with RBACError::GuardianRequired if the caller is not a Guardian
///
/// # Requirements
/// Satisfies requirements 5.3 (Guard Function Implementation - provide ensure_guardian),
/// 5.4 (Guard Function Implementation - retrieve invoker address),
/// 5.5 (Guard Function Implementation - verify invoker in role collection),
/// 5.6 (Guard Function Implementation - panic with descriptive error),
/// and 10.1 (Descriptive Error Handling - error indicating required role)
fn ensure_guardian(env: &Env, caller: &Address) {
    if !has_role(env, Role::Guardian, caller) {
        panic_with_error!(env, RBACError::GuardianRequired);
    }
}

/// RBAC Contract implementation
pub struct RBACContract;

impl RBACContract {
    /// Initializes the contract with the first Super Admin
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `super_admin` - The address to be assigned as the initial Super Admin
    ///
    /// # Returns
    /// Result indicating success or error if contract is already initialized
    ///
    /// # Panics
    /// Panics with RBACError::Unauthorized if contract is already initialized
    ///
    /// # Requirements
    /// Satisfies requirements 4.3 (Super Admin Existence Guarantee - require at least one Super Admin during initialization)
    /// and 1.1 (Role Storage and Persistence - store role data in persistent storage)
    pub fn initialize(env: Env, super_admin: Address) -> Result<(), RBACError> {
        // Check if contract is already initialized by checking if SuperAdmin role has members
        let members = get_role_members(&env, Role::SuperAdmin);
        if !members.is_empty() {
            panic_with_error!(&env, RBACError::Unauthorized);
        }

        // Require authentication from the super_admin address
        super_admin.require_auth();

        // Add the super admin to the SuperAdmin role
        add_role_member(&env, Role::SuperAdmin, super_admin)?;

        Ok(())
    }

    /// Adds an address to a role
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Super Admin)
    /// * `role` - The role to add the address to
    /// * `address` - The address to add to the role
    ///
    /// # Returns
    /// Result indicating success or error if address already exists in role
    ///
    /// # Panics
    /// Panics with RBACError::SuperAdminRequired if the caller is not a Super Admin
    ///
    /// # Requirements
    /// Satisfies requirements 7.1 (Role Management Authorization - invoke ensure_super_admin),
    /// 7.3 (Role Management Authorization - reject if not Super Admin),
    /// and 7.4 (Role Management Authorization - allow if Super Admin)
    pub fn add_role(
        env: Env,
        caller: Address,
        role: Role,
        address: Address,
    ) -> Result<(), RBACError> {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Super Admin
        ensure_super_admin(&env, &caller);

        // Require authentication from the address being added (if different from caller)
        if address != caller {
            address.require_auth();
        }

        // Add the address to the role
        add_role_member(&env, role, address)
    }

    /// Removes an address from a role
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Super Admin)
    /// * `role` - The role to remove the address from
    /// * `address` - The address to remove from the role
    ///
    /// # Returns
    /// Result indicating success or error if address not found or if removing last Super Admin
    ///
    /// # Panics
    /// Panics with RBACError::SuperAdminRequired if the caller is not a Super Admin
    ///
    /// # Requirements
    /// Satisfies requirements 7.2 (Role Management Authorization - invoke ensure_super_admin when removing),
    /// 7.3 (Role Management Authorization - reject if not Super Admin),
    /// and 7.4 (Role Management Authorization - allow if Super Admin)
    pub fn remove_role(
        env: Env,
        caller: Address,
        role: Role,
        address: Address,
    ) -> Result<(), RBACError> {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Super Admin
        ensure_super_admin(&env, &caller);

        // Remove the address from the role
        remove_role_member(&env, role, &address)
    }

    /// Upgrades the contract to new WASM code
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Super Admin)
    /// * `new_wasm_hash` - The hash of the new WASM code to upgrade to
    ///
    /// # Panics
    /// Panics with RBACError::SuperAdminRequired if the caller is not a Super Admin
    ///
    /// # Requirements
    /// Satisfies requirements 6.1 (Contract Upgrade Authorization - invoke ensure_super_admin),
    /// 6.2 (Contract Upgrade Authorization - reject if not Super Admin),
    /// and 6.3 (Contract Upgrade Authorization - allow if Super Admin)
    pub fn upgrade_contract(env: Env, caller: Address, new_wasm_hash: soroban_sdk::BytesN<32>) {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Super Admin
        ensure_super_admin(&env, &caller);

        // Upgrade the contract to the new WASM code
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Sets or updates the fee amount
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Financial Operator)
    /// * `fee_amount` - The fee amount to set
    ///
    /// # Panics
    /// Panics with RBACError::FinancialOperatorRequired if the caller is not a Financial Operator
    ///
    /// # Requirements
    /// Satisfies requirements 8.1 (Financial Parameter Authorization - invoke ensure_financial_operator),
    /// 8.2 (Financial Parameter Authorization - reject if not Financial Operator),
    /// and 8.3 (Financial Parameter Authorization - allow if Financial Operator)
    pub fn set_fee(env: Env, caller: Address, fee_amount: i128) {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Financial Operator
        ensure_financial_operator(&env, &caller);

        // Store fee amount in persistent storage
        let key = StorageKey::Fee;
        env.storage().persistent().set(&key, &fee_amount);
    }

    /// Pauses contract operations
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Guardian)
    ///
    /// # Panics
    /// Panics with RBACError::GuardianRequired if the caller is not a Guardian
    ///
    /// # Requirements
    /// Satisfies requirements 9.1 (Emergency Control Authorization - invoke ensure_guardian when pausing),
    /// 9.4 (Emergency Control Authorization - reject if not Guardian),
    /// and 9.5 (Emergency Control Authorization - allow if Guardian)
    pub fn pause_contract(env: Env, caller: Address) {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Guardian
        ensure_guardian(&env, &caller);

        // Store paused state (true) in persistent storage
        let key = StorageKey::Paused;
        env.storage().persistent().set(&key, &true);
    }

    /// Unpauses contract operations
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Guardian)
    ///
    /// # Panics
    /// Panics with RBACError::GuardianRequired if the caller is not a Guardian
    ///
    /// # Requirements
    /// Satisfies requirements 9.2 (Emergency Control Authorization - invoke ensure_guardian when unpausing),
    /// 9.4 (Emergency Control Authorization - reject if not Guardian),
    /// and 9.5 (Emergency Control Authorization - allow if Guardian)
    pub fn unpause_contract(env: Env, caller: Address) {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Guardian
        ensure_guardian(&env, &caller);

        // Store paused state (false) in persistent storage
        let key = StorageKey::Paused;
        env.storage().persistent().set(&key, &false);
    }

    /// Freezes contract operations (emergency state)
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `caller` - The address calling this function (must be a Guardian)
    ///
    /// # Panics
    /// Panics with RBACError::GuardianRequired if the caller is not a Guardian
    ///
    /// # Requirements
    /// Satisfies requirements 9.3 (Emergency Control Authorization - invoke ensure_guardian when freezing),
    /// 9.4 (Emergency Control Authorization - reject if not Guardian),
    /// and 9.5 (Emergency Control Authorization - allow if Guardian)
    pub fn freeze_contract(env: Env, caller: Address) {
        // Require authentication from the caller
        caller.require_auth();

        // Ensure the caller is a Guardian
        ensure_guardian(&env, &caller);

        // Store frozen state (true) in persistent storage
        let key = StorageKey::Frozen;
        env.storage().persistent().set(&key, &true);
    }

    /// Retrieves all addresses assigned to a role (public query function)
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `role` - The role to query
    ///
    /// # Returns
    /// Vector of addresses assigned to the role. Returns empty vector if role has no members.
    ///
    /// # Requirements
    /// Satisfies requirement 2.2 (Multiple Address Support Per Role - check role membership)
    pub fn get_role_members(env: Env, role: Role) -> Vec<Address> {
        get_role_members(&env, role)
    }

    /// Checks if an address has a specific role (public query function)
    ///
    /// # Arguments
    /// * `env` - The contract environment
    /// * `role` - The role to check
    /// * `address` - The address to verify membership for
    ///
    /// # Returns
    /// Boolean indicating whether the address has the specified role
    ///
    /// # Requirements
    /// Satisfies requirements 2.2 (Multiple Address Support Per Role - check role membership)
    /// and 11.1 (Efficient Membership Lookup)
    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        has_role(&env, role, &address)
    }
}
