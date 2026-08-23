#!/usr/bin/env bash
# =============================================================================
# 05_migrate_gradual.sh — Gradual / on-demand migration of specific streams
#
# Migrates a specific list of V1 stream IDs to V2 on behalf of one receiver.
# This is the building block for the gradual strategy: integrators and
# frontends call this (or invoke migrate_stream directly) when a user first
# interacts with a V1 stream after cutover.
#
# Usage:
#   ./05_migrate_gradual.sh --v1-contract C... --v2-contract C... \
#     --receiver-secret S... --receiver-address C... \
#     --stream-ids 101,102,103 --network testnet
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 05_migrate_gradual.sh --v1-contract C... --v2-contract C... \
  --receiver-secret S... --receiver-address C... \
  --stream-ids 1,2,3 [--network testnet]
EOF
}

parse_args "$@"
detect_cli

require_env RECEIVER_SECRET
[[ -n "${V1_CONTRACT_ID:-}" ]]  || fail "--v1-contract is required"
[[ -n "${V2_CONTRACT_ID:-}" ]]  || fail "--v2-contract is required"
[[ -n "${STREAM_IDS:-}" ]]      || fail "--stream-ids is required"
[[ -n "${RECEIVER_ADDRESS:-}" ]] || fail "--receiver-address is required"

IFS=',' read -r -a IDS <<< "$STREAM_IDS"
log "Migrating ${#IDS[@]} stream(s) for receiver $RECEIVER_ADDRESS"

for id in "${IDS[@]}"; do
  log "migrate_stream(v1_id=$id)"
  if contract_invoke "$V2_CONTRACT_ID" "$RECEIVER_SECRET" migrate_stream \
      --v1_contract "$V1_CONTRACT_ID" \
      --v1_stream_id "$id" \
      --caller "$RECEIVER_ADDRESS"; then
    ok "Stream $id migrated"
  else
    warn "Stream $id failed (AlreadyMigrated? StreamNotMigratable? See §12 of the guide)"
  fi
done
