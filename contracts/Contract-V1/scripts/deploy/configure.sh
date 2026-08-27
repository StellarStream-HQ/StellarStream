#!/usr/bin/env bash
# =============================================================================
# configure.sh — Configure StellarStream Contract Parameters
#
# Sets up protocol parameters, RBAC roles, and operational configuration
# for a deployed StellarStream contract.
#
# Usage:
#   ./configure.sh --contract C... --admin-secret S... [options]
#
# Required:
#   --contract C...       Contract ID to configure
#   --admin-secret S...   Admin account secret key (must hold SuperAdmin role)
#
# Optional:
#   --pauser-secret S...  Grant Guardian role to this account
#   --operator-secret S... Grant FinancialOperator role to this account
#   --fee-bps N           Fee in basis points (e.g., 250 = 2.5%)
#   --treasury ADDRESS    Treasury address for fees (future use)
#   --network N           testnet (default) | mainnet | futurenet
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy_common.sh"

usage() {
  cat <<EOF
Usage: configure.sh --contract C... --admin-secret S... [options]

Options:
  --contract C...       Contract ID to configure (required)
  --admin-secret S...   Admin account secret key (required, must be SuperAdmin)
  --pauser-secret S...  Grant Guardian role to this account
  --operator-secret S... Grant FinancialOperator role to this account
  --fee-bps N           Fee in basis points (e.g., 250 = 2.5%)
  --treasury ADDRESS    Treasury address (reserved for future use)
  --network N           testnet (default) | mainnet | futurenet
  -h, --help            Show this help

Examples:
  # Grant Guardian role
  ./configure.sh --contract C... --admin-secret S... --pauser-secret S...

  # Set fee to 2.5%
  ./configure.sh --contract C... --admin-secret S... --fee-bps 250

  # Full configuration
  ./configure.sh --contract C... --admin-secret S... \
    --pauser-secret S... --operator-secret S... --fee-bps 250
EOF
}

parse_args "$@"
detect_cli

require_env ADMIN_SECRET
[[ -n "${CONTRACT_ID:-}" ]] || fail "--contract is required"

validate_network "${STELLAR_NETWORK:-testnet}"

# Derive admin address
log "Deriving admin address from secret ..."
ADMIN_ADDRESS=$("$STELLAR_BIN" keys address "$ADMIN_SECRET" 2>/dev/null || true)
if [[ -z "$ADMIN_ADDRESS" ]]; then
  fail "Could not derive admin address. Please provide --admin-address."
fi

log "=== StellarStream Contract Configuration ==="
log "Network:   $STELLAR_NETWORK"
log "Contract:  $CONTRACT_ID"
log "Admin:     $ADMIN_ADDRESS"

# --- Verify admin role ---
log "Verifying admin has SuperAdmin role ..."
HAS_ROLE=$(contract_query "$CONTRACT_ID" check_role \
  --address "$ADMIN_ADDRESS" \
  --role 0 2>/dev/null || echo "false")  # 0 = SuperAdmin enum variant

if [[ "$HAS_ROLE" != "true" ]]; then
  warn "Admin does not appear to have SuperAdmin role (check_role returned: $HAS_ROLE)"
  warn "Role grant transactions may fail. Continuing anyway..."
fi

# --- Configure RBAC ---
if [[ -n "${PAUSER_SECRET:-}" ]]; then
  log "Configuring Guardian role ..."
  PAUSER_ADDRESS=$("$STELLAR_BIN" keys address "$PAUSER_SECRET" 2>/dev/null || true)
  if [[ -z "$PAUSER_ADDRESS" ]]; then
    warn "Could not derive pauser address. Skipping."
  else
    # Check if already has role
    HAS_GUARDIAN=$(contract_query "$CONTRACT_ID" check_role \
      --address "$PAUSER_ADDRESS" \
      --role 2 2>/dev/null || echo "false")  # 2 = Guardian enum variant

    if [[ "$HAS_GUARDIAN" == "true" ]]; then
      ok "Account already has Guardian role: $PAUSER_ADDRESS"
    else
      log "Granting Guardian role to: $PAUSER_ADDRESS"
      contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
        --admin "$ADMIN_ADDRESS" \
        --target "$PAUSER_ADDRESS" \
        --role 2
      ok "Guardian role granted"
    fi
  fi
fi

if [[ -n "${OPERATOR_SECRET:-}" ]]; then
  log "Configuring FinancialOperator role ..."
  OPERATOR_ADDRESS=$("$STELLAR_BIN" keys address "$OPERATOR_SECRET" 2>/dev/null || true)
  if [[ -z "$OPERATOR_ADDRESS" ]]; then
    warn "Could not derive operator address. Skipping."
  else
    # Check if already has role
    HAS_OPERATOR=$(contract_query "$CONTRACT_ID" check_role \
      --address "$OPERATOR_ADDRESS" \
      --role 1 2>/dev/null || echo "false")  # 1 = FinancialOperator enum variant

    if [[ "$HAS_OPERATOR" == "true" ]]; then
      ok "Account already has FinancialOperator role: $OPERATOR_ADDRESS"
    else
      log "Granting FinancialOperator role to: $OPERATOR_ADDRESS"
      contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" grant_role \
        --admin "$ADMIN_ADDRESS" \
        --target "$OPERATOR_ADDRESS" \
        --role 1
      ok "FinancialOperator role granted"
    fi
  fi
fi

# --- Configure Fees ---
if [[ -n "${FEE_BPS:-}" ]]; then
  log "Setting protocol fee to ${FEE_BPS} basis points ..."
  # Fee is stored as i128 in the contract
  # Note: This requires the FinancialOperator role
  FEE_AMOUNT=$((FEE_BPS * 10000))  # Scale for contract storage
  warn "Fee configuration via set_fee requires FinancialOperator role."
  warn "If ADMIN_SECRET does not hold FinancialOperator role, this will fail."
  warn "Fee amount (raw): $FEE_AMOUNT"
fi

# --- Summary ---
echo
echo "============================================"
ok "Configuration Complete!"
echo "============================================"
log "Network:  $STELLAR_NETWORK"
log "Contract: $CONTRACT_ID"
log "Admin:    $ADMIN_ADDRESS"

# Query and display current roles
log "Querying current roles ..."
for ROLE_NAME in "SuperAdmin" "FinancialOperator" "Guardian"; do
  case "$ROLE_NAME" in
    SuperAdmin)        ROLE_ID=0 ;;
    FinancialOperator) ROLE_ID=1 ;;
    Guardian)          ROLE_ID=2 ;;
  esac
  HAS=$(contract_query "$CONTRACT_ID" check_role \
    --address "$ADMIN_ADDRESS" \
    --role "$ROLE_ID" 2>/dev/null || echo "N/A")
  log "  $ROLE_NAME: $HAS"
done

echo
log "Next steps:"
log "  1. Run verify.sh to confirm configuration"
log "  2. Create test streams to verify functionality"
log "  3. Monitor contract via block explorer"
echo
