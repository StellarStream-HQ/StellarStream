#!/usr/bin/env bash
# =============================================================================
# 07_rollback.sh — WASM-level rollback
#
# Restores a contract to a previous WASM hash. This is the safe rollback path
# when the upgrade happened but NO data migration has run yet (storage is
# untouched, so swapping back the bytecode is clean).
#
# ⚠️ If data migration already ran, this alone does NOT undo migrated streams.
#    See §8.4 of MIGRATION_GUIDE.md for data-level rollback.
#
# Usage:
#   ./07_rollback.sh --contract C... --wasm-hash <OLD_HASH> [--network testnet]
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 07_rollback.sh --contract C... --wasm-hash <OLD_HASH> [--network testnet]

The OLD_HASH is the hash you recorded in 02_snapshot.sh / §7.2 of the guide
before upgrading. If the old WASM is no longer installed on the network,
re-install it first with: stellar contract install --wasm <old.wasm> ...
EOF
}

parse_args "$@"
detect_cli

require_env ADMIN_SECRET
[[ -n "${CONTRACT_ID:-}" ]] || fail "--contract is required"
[[ -n "${WASM_HASH:-}" ]]   || fail "--wasm-hash is required"

log "Rolling back $CONTRACT_ID to WASM hash $WASM_HASH on $STELLAR_NETWORK"

contract_invoke "$CONTRACT_ID" "$ADMIN_SECRET" upgrade \
  --admin "$ADMIN_ADDRESS" \
  --new_wasm_hash "$WASM_HASH"

ok "Rollback transaction submitted. Verifying ..."

# Best-effort verification (function names differ between versions)
if contract_query "$CONTRACT_ID" get_admin >/dev/null 2>&1; then
  ok "Contract is queryable after rollback (get_admin works)"
else
  warn "Could not verify via get_admin — confirm manually on a block explorer."
fi

echo
echo "Rollback complete. Verify data integrity per §8.5 of the guide."
