# StellarSplit V3 Contract Error Codes

This reference document defines the structural error codes thrown by the `splitter-v3` smart contract on Soroban. Errors are structured using explicit `u32` value mappings returned via standard Soroban contract errors (`panic_with_error`).

---

## Quick Reference Table

| Code (`u32`) | Error Name | Classification | Description |
| :--- | :--- | :--- | :--- |
| `101` | `Unauthorized` | Access Control | The caller lacks valid cryptographic credentials or authority. |
| `102` | `InvalidShareConfiguration` | Validation | The split percentages or vector distributions are structurally malformed. |
| `103` | `ContractPaused` | Operations | Operational state is currently locked by admin or budget controls. |
| `104` | `InsufficientBalance` | Financial | The contract instance lacks required token liquidity to fulfill the split. |
| `105` | `ZeroTransferAmount` | Validation | Attempted to process a split or payment distribution where the payload asset amount resolves to 0. |

---

## Detailed Specifications

### 101: Unauthorized
* **Meaning:** Access Control violation. The cryptographic identity (`Address`) presenting the signature sequence does not match administrative keys or designated project managers.
* **Common Causes:**
    * Calling an administrative setup lifecycle or config modifier function from a standard participant wallet.
    * Mismatch between the signed signature authority payload and the internal state record.
* **Remediation & Fixes:** Confirm that the primary account executing the ledger payload is explicitly recognized within the initialization array. Ensure `auth.require_auth()` is called on the true transaction origin identity.
* **Example scenario:**
    ```rust
    // Will panic with Error(Contract, 101) if caller is not the contract administrator
    let caller = env.current_contract_address();
    if caller != storage.get_admin() {
        panic_with_error!(&env, ContractError::Unauthorized);
    }
    ```

### 102: InvalidShareConfiguration
* **Meaning:** Split geometry validation failed. The share allocations assigned to the payment recipients are mathematically unsound.
* **Common Causes:**
    * Total calculated sum of all percentage basis points in the vector allocation does not equal exactly 100% ($10,000$ basis points).
    * Share distribution vector is entirely empty or contains negative values.
* **Remediation & Fixes:** Normalize the contribution matrix array calculations before submitting transactions to the network. Ensure that total allocation splits sum exactly to the base anchor constraint.
* **Example scenario:**
    ```rust
    // Will panic with Error(Contract, 102) if array basis points sum up to 9,950 instead of 10,000
    let total_shares: u32 = shares.iter().map(|s| s.percentage).sum();
    if total_shares != 10_000 {
        panic_with_error!(&env, ContractError::InvalidShareConfiguration);
    }
    ```

### 103: ContractPaused
* **Meaning:** Operational state lock. The contract is currently executing a security pause lifecycle event.
* **Common Causes:**
    * Contract manually paused by its managing board via `pause()` during a security patch window or operational transition.
    * System budget validation threshold exceeded.
* **Remediation & Fixes:** Query the contract's public state parameters via clean RPC read commands. Wait for a subsequent `resume()` transaction from the team management account before dispatching assets.

### 104: InsufficientBalance
* **Meaning:** Account validation shortfall. The contract instance or the designated payer wallet does not hold sufficient Stellar Asset Contract (SAC) token units to satisfy the execution payload.
* **Common Causes:**
    * Attempting to split a larger volume of tokens than the ledger pool balance supports.
    * Token allowance limits between user tokens and the smart contract are exhausted.
* **Remediation & Fixes:** Fund the destination contract ledger pool with sufficient tokens, or invoke the token interface's `approve` logic to expand transaction gas and token liquidity lines.

### 105: ZeroTransferAmount
* **Meaning:** Operational floor violation. The asset amount requested for division or payout scales below minimum functional constraints.
* **Common Causes:**
    * Passing `0` into the payment initialization pipeline.
    * Processing a token division where a participant's assigned fractional slice rounds down to zero token units.
* **Remediation & Fixes:** Implement pre-flight checks on the frontend engine to reject zero-value inputs. Ensure the token input value is large enough to prevent fractional division loss under high granularity splits.