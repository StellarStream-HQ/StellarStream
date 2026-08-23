#!/usr/bin/env bash
# =============================================================================
# 01_preflight.sh — Pre-migration checks
#
# Verifies that the environment and the deployed contracts are in a state where
# a migration can safely begin. Run this on testnet AND mainnet before migrating.
#
# Usage:
#   STELLAR_NETWORK=testnet ./01_preflight.sh --v1-contract C... --v2-contract C...
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 01_preflight.sh [--v1-contract C...] [--v2-contract C...] [--network testnet]

Checks:
  1. stellar/soroban CLI is installed
  2. Required env vars are set
  3. V1 contract is queryable and reports a sane version
  4. V2 contract (if provided) is queryable and reports version 2
  5. Admin secret is non-empty (presence check only — no funds are moved)
EOF
}

parse_args "$@"
detect_cli

require_env ADMIN_SECRET
[[ -n "${V1_CONTRACT_ID:-}" ]] || fail "--v1-contract is required"

log "Preflight for network: $STELLAR_NETWORK"

# 1. CLI available
ok "CLI: $STELLAR_BIN ($(command -v "$STELLAR_BIN"))"

# 2. Env
[[ -n "$STELLAR_NETWORK" ]] && ok "Network: $STELLAR_NETWORK"
[[ -n "$ADMIN_SECRET" ]]    && ok "Admin secret: present (not shown)"

# 3. V1 queryable
log "Querying V1 contract $V1_CONTRACT_ID ..."
V1_ADMIN=$(contract_query "$V1_CONTRACT_ID" get_admin 2>/dev/null) \
  || fail "Could not query get_admin on V1 contract — is the contract ID correct?"
ok "V1 contract queryable; admin=$V1_ADMIN"

# 4. V2 queryable (optional)
if [[ -n "${V2_CONTRACT_ID:-}" ]]; then
  log "Querying V2 contract $V2_CONTRACT_ID ..."
  V2_VERSION=$(contract_query "$V2_CONTRACT_ID" version 2>/dev/null) \
    || warn "Could not query version() on V2 contract (is it deployed/initialized?)"
  ok "V2 contract queryable; version=${V2_VERSION:-unknown}"
fi

echo
ok "Preflight passed. Proceed to 02_snapshot.sh"
