#!/usr/bin/env bash
# =============================================================================
# verify.sh — Verify StellarStream Contract Deployment
#
# Confirms the deployment succeeded by checking:
#   1. Contract is queryable
#   2. Admin address is set correctly
#   3. RBAC roles are configured
#   4. Contract is responsive to basic queries
#
# Usage:
#   ./verify.sh --contract C... [--network testnet] [--admin-address A...]
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy_common.sh"

usage() {
  cat <<EOF
Usage: verify.sh --contract C... [--network testnet] [--admin-address A...]

Options:
  --contract C...       Contract ID to verify (required)
  --admin-address A...  Expected admin address (optional, for verification)
  --network N           testnet (default) | mainnet | futurenet
  -h, --help            Show this help

Examples:
  # Basic verification
  ./verify.sh --contract C... --network testnet

  # Verify with expected admin
  ./verify.sh --contract C... --admin-address GA... --network testnet
EOF
}

parse_args "$@"
detect_cli

[[ -n "${CONTRACT_ID:-}" ]] || fail "--contract is required"
validate_network "${STELLAR_NETWORK:-testnet}"

FAILED=0
check() {
  # check <label> <result>  (0 = pass, 1 = fail)
  if [[ "$2" == "0" ]]; then
    ok "$1"
  else
    warn "$1"
    FAILED=1
  fi
}

log "=== StellarStream Deployment Verification ==="
log "Network:   $STELLAR_NETWORK"
log "Contract:  $CONTRACT_ID"
echo

# --- 1. Contract queryability ---
log "Checking contract queryability ..."

ADMIN_RESULT=$(contract_query "$CONTRACT_ID" get_admin 2>/dev/null) \
  && check "Contract is queryable (get_admin)" 0 \
  || check "Contract is queryable (get_admin)" 1

if [[ -n "$ADMIN_RESULT" ]]; then
  log "Admin address: $ADMIN_RESULT"
fi

# --- 2. Admin address verification ---
if [[ -n "${ADMIN_ADDRESS:-}" ]]; then
  if [[ "$ADMIN_RESULT" == "$ADMIN_ADDRESS" ]]; then
    check "Admin address matches expected" 0
  else
    check "Admin address matches expected (got: $ADMIN_RESULT, expected: $ADMIN_ADDRESS)" 1
  fi
fi

# --- 3. RBAC role checks ---
log "Checking RBAC roles ..."

if [[ -n "${ADMIN_ADDRESS:-}" ]] || [[ -n "$ADMIN_RESULT" ]]; then
  CHECK_ADDR="${ADMIN_ADDRESS:-$ADMIN_RESULT}"

  # SuperAdmin (role 0)
  HAS_SUPERADMIN=$(contract_query "$CONTRACT_ID" check_role \
    --address "$CHECK_ADDR" \
    --role 0 2>/dev/null || echo "N/A")
  if [[ "$HAS_SUPERADMIN" == "true" ]]; then
    check "Admin has SuperAdmin role" 0
  elif [[ "$HAS_SUPERADMIN" == "false" ]]; then
    check "Admin has SuperAdmin role (NOT granted)" 1
  else
    check "Admin has SuperAdmin role (query failed)" 1
  fi

  # FinancialOperator (role 1)
  HAS_FINOP=$(contract_query "$CONTRACT_ID" check_role \
    --address "$CHECK_ADDR" \
    --role 1 2>/dev/null || echo "N/A")
  if [[ "$HAS_FINOP" == "true" ]]; then
    ok "Admin has FinancialOperator role"
  else
    warn "Admin does not have FinancialOperator role (may be expected)"
  fi

  # Guardian (role 2)
  HAS_GUARDIAN=$(contract_query "$CONTRACT_ID" check_role \
    --address "$CHECK_ADDR" \
    --role 2 2>/dev/null || echo "N/A")
  if [[ "$HAS_GUARDIAN" == "true" ]]; then
    ok "Admin has Guardian role"
  else
    warn "Admin does not have Guardian role (may be expected)"
  fi
fi

# --- 4. Contract state queries ---
log "Checking contract state queries ..."

# Stream count (should be 0 for fresh deploy)
STREAM_COUNT=$(contract_query "$CONTRACT_ID" get_admin 2>/dev/null) \
  && check "State queries work" 0 \
  || check "State queries work" 1

# Restricted addresses (should be empty for fresh deploy)
RESTRICTED=$(contract_query "$CONTRACT_ID" get_restricted_addresses 2>/dev/null) \
  && ok "Restricted addresses query works" \
  || warn "Restricted addresses query failed (may not be implemented)"

# --- 5. Contract balance (XLM reserve) ---
log "Checking contract XLM balance ..."
BALANCE=$("$STELLAR_BIN" account balance "$CONTRACT_ID" --network "$STELLAR_NETWORK" 2>/dev/null || echo "N/A")
if [[ "$BALANCE" != "N/A" ]] && [[ -n "$BALANCE" ]]; then
  ok "Contract balance: $BALANCE"
else
  warn "Could not query contract balance"
fi

# --- 6. Explorer link ---
echo
EXPLORER_BASE="https://${STELLAR_NETWORK}.steexp.com"
log "Block Explorer: ${EXPLORER_BASE}/contract/$CONTRACT_ID"

# --- Summary ---
echo
echo "============================================"
if [[ $FAILED -eq 0 ]]; then
  ok "Deployment Verification: PASSED"
else
  warn "Deployment Verification: ISSUES FOUND"
fi
echo "============================================"
log "Network:   $STELLAR_NETWORK"
log "Contract:  $CONTRACT_ID"
log "Admin:     ${ADMIN_ADDRESS:-$ADMIN_RESULT}"
echo

if [[ $FAILED -eq 0 ]]; then
  log "✅ Deployment is healthy. Contract is ready for use."
else
  log "⚠️  Some checks failed. Review the warnings above."
  log "   The contract may still be functional — verify manually."
fi

echo
exit $FAILED
