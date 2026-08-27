#!/usr/bin/env bash
# =============================================================================
# initialize.sh — Initialize Deployed StellarStream Contract
#
# Initializes the deployed contract by setting the admin address and
# optionally granting initial RBAC roles.
#
# Usage:
#   ./initialize.sh --contract C... --admin-secret S... [--network testnet]
#
# Required:
#   --contract C...       Contract ID to initialize
#   --admin-secret S...   Admin account secret key
#
# Optional:
#   --admin-address A...  Admin public address (auto-derived from secret if omitted)
#   --pauser-secret S...  Grant Guardian role to this account
#   --operator-secret S... Grant FinancialOperator role to this account
#   --network N           testnet (default) | mainnet | futurenet
#   --out FILE            Save deployment info to JSON file
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy_common.sh"

usage() {
  cat <<EOF
Usage: initialize.sh --contract C... --admin-secret S... [options]

Options:
  --contract C...       Contract ID to initialize (required)
  --admin-secret S...   Admin account secret key (required)
  --admin-address A...  Admin public address (auto-derived from secret)
  --pauser-secret S...  Grant Guardian role to this account
  --operator-secret S... Grant FinancialOperator role to this account
  --network N           testnet (default) | mainnet | futurenet
  --out FILE            Save deployment info to JSON file
  -h, --help            Show this help

Examples:
  # Initialize with admin only
  ./initialize.sh --contract C... --admin-secret S...

  # Initialize + grant roles
  ./initialize.sh --contract C... --admin-secret S... \
    --pauser-secret S... --operator-secret S...

  # Initialize on mainnet
  ./initialize.sh --contract C... --admin-secret S... --network mainnet
EOF
}

parse_args "$@"
detect_cli

require_env ADMIN_SECRET
[[ -n "${CONTRACT_ID:-}" ]] || fail "--contract is required"

validate_network "${STELLAR_NETWORK:-testnet}"

# Derive admin address if not provided
if [[ -z "${ADMIN_ADDRESS:-}" ]]; then
  log "Deriving admin address from secret ..."
  ADMIN_ADDRESS=$("$STELLAR_BIN" keys address "$ADMIN_SECRET" 2>/dev/null || true)
  if [[ -z "$ADMIN_ADDRESS" ]]; then
    fail "Could not derive admin address. Please provide --admin-address."
  fi
fi

log "=== StellarStream Contract Initialization ==="
log "Network:   $STELLAR_NETWORK"
log "Contract:  $CONTRACT_ID"
log "Admin:     $ADMIN_ADDRESS"

# --- Step 1: Verify contract is deployed ---
log "Verifying contract is deployed ..."
if ! contract_query "$CONTRACT_ID" get_admin >/dev/null 2>&1; then
  warn "Contract may not be initialized yet (get_admin failed). Proceeding with initialization."
fi

# --- Step 2: Initialize contract ---
log "Initializing contract ..."
contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" initialize \
  --admin "$ADMIN_ADDRESS"
ok "Contract initialized successfully!"
ok "Admin address: $ADMIN_ADDRESS"

# --- Step 3: Verify initialization ---
log "Verifying initialization ..."
INITIALIZED_ADMIN=$(contract_query "$CONTRACT_ID" get_admin 2>/dev/null || echo "FAILED")
if [[ "$INITIALIZED_ADMIN" == "$ADMIN_ADDRESS" ]]; then
  ok "Admin address verified: $INITIALIZED_ADMIN"
else
  warn "Admin address mismatch! Expected: $ADMIN_ADDRESS, Got: $INITIALIZED_ADMIN"
fi

# --- Step 4: Grant roles (optional) ---
if [[ -n "${PAUSER_SECRET:-}" ]]; then
  log "Granting Guardian role ..."
  PAUSER_ADDRESS=$("$STELLAR_BIN" keys address "$PAUSER_SECRET" 2>/dev/null || true)
  if [[ -n "$PAUSER_ADDRESS" ]]; then
    contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
      --admin "$ADMIN_ADDRESS" \
      --target "$PAUSER_ADDRESS" \
      --role 2  # Guardian enum variant
    ok "Guardian role granted to: $PAUSER_ADDRESS"
  else
    warn "Could not derive pauser address from secret"
  fi
fi

if [[ -n "${OPERATOR_SECRET:-}" ]]; then
  log "Granting FinancialOperator role ..."
  OPERATOR_ADDRESS=$("$STELLAR_BIN" keys address "$OPERATOR_SECRET" 2>/dev/null || true)
  if [[ -n "$OPERATOR_ADDRESS" ]]; then
    contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
      --admin "$ADMIN_ADDRESS" \
      --target "$OPERATOR_ADDRESS" \
      --role 1  # FinancialOperator enum variant
    ok "FinancialOperator role granted to: $OPERATOR_ADDRESS"
  else
    warn "Could not derive operator address from secret"
  fi
fi

# --- Step 5: Save deployment info ---
if [[ -n "${OUT_FILE:-}" ]]; then
  WASM_HASH_FOR_SAVE="${WASM_HASH:-unknown}"
  save_deployment_info "$OUT_FILE" "${STELLAR_NETWORK:-testnet}" "$CONTRACT_ID" "$ADMIN_ADDRESS" "$WASM_HASH_FOR_SAVE"
fi

# --- Summary ---
echo
echo "============================================"
ok "Initialization Complete!"
echo "============================================"
log "Network:   $STELLAR_NETWORK"
log "Contract:  $CONTRACT_ID"
log "Admin:     $ADMIN_ADDRESS"
log "Explorer:  https://${STELLAR_NETWORK:-testnet}.steexp.com/contract/$CONTRACT_ID"
echo
log "Next steps:"
log "  1. Run verify.sh to confirm everything is working"
log "  2. Run configure.sh to set protocol parameters"
log "  3. Create your first stream!"
echo
