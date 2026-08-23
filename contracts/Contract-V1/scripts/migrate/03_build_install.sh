#!/usr/bin/env bash
# =============================================================================
# 03_build_install.sh — Build and install the new contract WASM
#
# Builds the Contract-V2 WASM (or a specified WASM file), installs it on the
# target network, and prints the new WASM hash. The hash is what you pass to
# the upgrade functions (upgrade / propose_upgrade).
#
# Usage:
#   ./03_build_install.sh [--wasm-file path/to/contract.wasm] [--network testnet]
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 03_build_install.sh [--wasm-file FILE.wasm] [--network testnet]

Default WASM: contracts/Contract-V2/target/wasm32-unknown-unknown/release/stellarstream_contracts_v2.wasm
Prints: NEW_WASM_HASH=<hash>
EOF
}

parse_args "$@"
detect_cli
require_env ADMIN_SECRET

: "${WASM_FILE:=contracts/Contract-V2/target/wasm32-unknown-unknown/release/stellarstream_contracts_v2.wasm}"

log "Building Contract-V2 WASM ..."
(
  cd contracts/Contract-V2
  "$STELLAR_BIN" contract build --optimize
)

[[ -f "$WASM_FILE" ]] || fail "WASM not found after build: $WASM_FILE"

log "Installing $WASM_FILE on $STELLAR_NETWORK ..."
NEW_WASM_HASH=$("$STELLAR_BIN" contract install \
  --wasm "$WASM_FILE" \
  --source "$ADMIN_SECRET" \
  --network "$STELLAR_NETWORK")

ok "New WASM hash: $NEW_WASM_HASH"
echo
echo "Record this hash. It is required by 04_migrate_atomic.sh / upgrade calls."
echo "For V1 multi-sig upgrades, pass it to propose_upgrade --new_wasm_hash."
