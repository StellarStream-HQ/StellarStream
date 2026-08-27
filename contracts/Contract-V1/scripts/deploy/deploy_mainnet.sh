#!/usr/bin/env bash
# =============================================================================
# deploy_mainnet.sh — Deploy StellarStream Contract to Mainnet
#
# Builds the contract WASM, installs it on Stellar mainnet, deploys it,
# and optionally initializes and configures it.
#
# ⚠️  WARNING: This deploys to MAINNET. Ensure all tests pass on testnet first.
#
# Usage:
#   ./deploy_mainnet.sh --admin-secret S... [--init] [--config]
#
# Required env: ADMIN_SECRET (admin account secret key)
#
# Optional:
#   --wasm-file PATH     Use a pre-built WASM (skips build)
#   --init               Initialize after deploy
#   --config             Configure after initialize (requires --init)
#   --fee-bps N          Fee in basis points (e.g., 250 = 2.5%)
#   --treasury ADDRESS   Treasury address for fees
#   --pauser-secret KEY  Pauser account secret
#   --operator-secret KEY Financial operator account secret
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy_common.sh"

usage() {
  cat <<EOF
Usage: deploy_mainnet.sh --admin-secret S... [options]

⚠️  WARNING: This deploys to Stellar MAINNET.
    Ensure your contract is thoroughly tested on testnet before using this.

Options:
  --admin-secret KEY     Admin account secret key (required)
  --wasm-file PATH       Pre-built WASM file (skips build)
  --init                 Initialize contract after deploy
  --config               Configure parameters (requires --init)
  --fee-bps N            Fee in basis points (default: 0)
  --treasury ADDRESS     Treasury address
  --pauser-secret KEY    Pauser account secret
  --operator-secret KEY  Financial operator account secret
  --out FILE             Output deployment info to JSON file
  -h, --help             Show this help

Environment:
  STELLAR_NETWORK=mainnet

Examples:
  # Simple deploy
  ./deploy_mainnet.sh --admin-secret S...

  # Deploy + initialize
  ./deploy_mainnet.sh --admin-secret S... --init

  # Full deploy + initialize + configure
  ./deploy_mainnet.sh --admin-secret S... --init --config \
    --fee-bps 250 --treasury GA...
EOF
}

parse_args "$@"
detect_cli
require_env ADMIN_SECRET

# Set network to mainnet explicitly
STELLAR_NETWORK="mainnet"
validate_network "$STELLAR_NETWORK"

# --- Safety confirmation ---
echo
echo "⚠️  MAINNET DEPLOYMENT ⚠️"
echo "=========================================="
echo "Network:  $STELLAR_NETWORK"
echo "RPC URL:  $(network_rpc_url)"
echo ""
echo "This will deploy the StellarStream contract to MAINNET."
echo "Ensure you have:"
echo "  ✓ Tested on testnet first"
echo "  ✓ Verified WASM integrity"
echo "  ✓ Secured admin keys"
echo "  ✓ Sufficient XLM for contract reserves"
echo ""
read -r -p "Type 'DEPLOY MAINNET' to confirm: " CONFIRM
if [[ "$CONFIRM" != "DEPLOY MAINNET" ]]; then
  fail "Deployment cancelled."
fi
echo

log "=== StellarStream Mainnet Deployment ==="
log "Network: $STELLAR_NETWORK"
log "Admin: (secret provided)"

# --- Step 1: Build or locate WASM ---
if [[ -n "${WASM_FILE:-}" ]]; then
  if [[ ! -f "$WASM_FILE" ]]; then
    fail "WASM file not found: $WASM_FILE"
  fi
  ok "Using pre-built WASM: $WASM_FILE"
else
  WASM_FILE=$(build_contract_v1)
fi

# --- Step 2: Install WASM on network ---
log "Installing WASM on mainnet ..."
WASM_HASH=$(contract_install "$WASM_FILE" "$ADMIN_SECRET")
ok "WASM installed. Hash: $WASM_HASH"

# --- Step 3: Deploy contract ---
log "Deploying contract to mainnet ..."
CONTRACT_ID=$(contract_deploy "$WASM_FILE" "$ADMIN_SECRET")
ok "Contract deployed!"
ok "Contract ID: $CONTRACT_ID"

# --- Step 4: Initialize (optional) ---
if [[ "${INIT:-false}" == "true" ]] || [[ "${1:-}" == "--init" ]]; then
  log "Initializing contract ..."
  ADMIN_ADDRESS=$("$STELLAR_BIN" keys address "$ADMIN_SECRET" 2>/dev/null || true)
  if [[ -z "$ADMIN_ADDRESS" ]]; then
    fail "Could not derive admin address from secret. Please provide --admin-address."
  fi

  contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" initialize \
    --admin "$ADMIN_ADDRESS"
  ok "Contract initialized with admin: $ADMIN_ADDRESS"

  # --- Step 5: Configure (optional) ---
  if [[ "${CONFIG:-false}" == "true" ]] || [[ "${1:-}" == "--config" ]]; then
    log "Configuring contract parameters ..."

    # Grant Guardian role to pauser
    if [[ -n "${PAUSER_SECRET:-}" ]]; then
      PAUSER_ADDRESS=$("$STELLAR_BIN" keys address "$PAUSER_SECRET" 2>/dev/null || true)
      if [[ -n "$PAUSER_ADDRESS" ]]; then
        log "Granting Guardian role to: $PAUSER_ADDRESS"
        contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
          --admin "$ADMIN_ADDRESS" \
          --target "$PAUSER_ADDRESS" \
          --role 2  # Guardian enum variant
        ok "Guardian role granted"
      fi
    fi

    # Grant FinancialOperator role
    if [[ -n "${OPERATOR_SECRET:-}" ]]; then
      OPERATOR_ADDRESS=$("$STELLAR_BIN" keys address "$OPERATOR_SECRET" 2>/dev/null || true)
      if [[ -n "$OPERATOR_ADDRESS" ]]; then
        log "Granting FinancialOperator role to: $OPERATOR_ADDRESS"
        contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
          --admin "$ADMIN_ADDRESS" \
          --target "$OPERATOR_ADDRESS" \
          --role 1  # FinancialOperator enum variant
        ok "FinancialOperator role granted"
      fi
    fi

    ok "Configuration complete"
  fi
else
  log "Skipping initialization (use --init to enable)"
fi

# --- Step 6: Save deployment info ---
: "${OUT_FILE:=deployment_mainnet.json}"
WASM_HASH_FOR_SAVE="${WASM_HASH:-unknown}"
ADMIN_FOR_SAVE="${ADMIN_ADDRESS:-unknown}"

save_deployment_info "$OUT_FILE" "$STELLAR_NETWORK" "$CONTRACT_ID" "$ADMIN_FOR_SAVE" "$WASM_HASH_FOR_SAVE"

# --- Summary ---
echo
echo "============================================"
ok "Mainnet Deployment Complete!"
echo "============================================"
log "Network:      $STELLAR_NETWORK"
log "Contract ID:  $CONTRACT_ID"
log "WASM Hash:    ${WASM_HASH:-N/A}"
log "Admin:        ${ADMIN_ADDRESS:-N/A}"
log "RPC URL:      $(network_rpc_url)"
log "Explorer:     https://steexp.com/contract/$CONTRACT_ID"
log "Deploy Info:  $OUT_FILE"
echo
log "Next steps:"
log "  1. Run verify.sh --network mainnet to confirm deployment"
log "  2. Run initialize.sh if not already initialized"
log "  3. Run configure.sh to set parameters"
log "  4. Monitor contract via block explorer"
echo
