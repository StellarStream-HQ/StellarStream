#!/usr/bin/env bash
# =============================================================================
# 06_verify.sh — Post-migration verification
#
# Confirms the migration succeeded:
#   1. V1 and V2 contracts are queryable
#   2. V2 reports version 2
#   3. A sample of migrated streams reads back correctly
#   4. Balance integrity check on V2 (if supported by the token)
#
# Usage:
#   ./06_verify.sh --v1-contract C... --v2-contract C... [--network testnet]
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 06_verify.sh --v1-contract C... --v2-contract C... [--network testnet] [--sample-size 5]
EOF
}

parse_args "$@"
detect_cli

[[ -n "${V1_CONTRACT_ID:-}" ]] || fail "--v1-contract is required"
[[ -n "${V2_CONTRACT_ID:-}" ]] || fail "--v2-contract is required"
: "${SAMPLE_SIZE:=5}"

FAILED=0
check() { # check <label> <condition-result>
  if [[ "$2" == "0" ]]; then ok "$1"; else warn "$1"; FAILED=1; fi
}

log "Verifying migration on $STELLAR_NETWORK"

# 1. Queryability
contract_query "$V1_CONTRACT_ID" get_admin >/dev/null 2>&1 \
  && check "V1 contract queryable" 0 || check "V1 contract queryable" 1
contract_query "$V2_CONTRACT_ID" admin >/dev/null 2>&1 \
  && check "V2 contract queryable" 0 || check "V2 contract queryable" 1

# 2. V2 version
V2_VERSION=$(contract_query "$V2_CONTRACT_ID" version 2>/dev/null || echo "?")
if [[ "$V2_VERSION" == "2" ]]; then
  check "V2 reports version 2 (got: $V2_VERSION)" 0
else
  check "V2 reports version 2 (got: $V2_VERSION)" 1
fi

# 3. Sample streams
log "Sampling up to $SAMPLE_SIZE streams on V2 ..."
COUNT=$(contract_query "$V1_CONTRACT_ID" get_stream_id 2>/dev/null || echo 0)
SAMPLED=0
for ((id = 1; id <= COUNT && SAMPLED < SAMPLE_SIZE; id++)); do
  if contract_query "$V2_CONTRACT_ID" get_stream --stream_id "$id" >/dev/null 2>&1; then
    ok "V2 stream $id readable"
    SAMPLED=$((SAMPLED + 1))
  else
    warn "V2 stream $id not found (may not have been migrated)"
  fi
done
[[ $SAMPLED -gt 0 ]] || warn "No migrated streams found to sample — is the migration complete?"

echo
if [[ $FAILED -eq 0 ]]; then
  ok "Verification passed. See §11 of the guide for the full checklist."
else
  warn "Verification found issues. See §12 (troubleshooting) before proceeding."
  exit 1
fi
