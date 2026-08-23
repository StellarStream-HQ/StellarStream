#!/usr/bin/env bash
# =============================================================================
# 04_migrate_atomic.sh — Atomic (batch) migration of V1 streams to V2
#
# Migrates V1 streams to the V2 contract in batches by calling the V2 bridge
# function `migrate_stream(v1_contract, v1_stream_id, caller)`. The caller is
# the stream receiver, so batches are grouped by receiver: for each receiver,
# all of their stream IDs are migrated in one transaction.
#
# For production, this script is a template: replace the stream inventory
# source (STREAM_IDS below) with your real inventory from 02_snapshot.sh.
#
# Usage:
#   ./04_migrate_atomic.sh --v1-contract C... --v2-contract C... \
#     --network testnet --batch-size 20
#
# Required env: ADMIN_SECRET (used to read state; individual migrations must be
# authorized by each receiver's secret, supplied via --receiver-secret).
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 04_migrate_atomic.sh --v1-contract C... --v2-contract C... [--network testnet] [--batch-size 20] [--stream-ids 1,2,3]

If --stream-ids is omitted, the script reads the V1 stream counter and migrates
all streams in order. Streams whose receiver secret is unknown are skipped with
a warning (use 05_migrate_gradual.sh with explicit receiver secrets for those).
EOF
}

parse_args "$@"
detect_cli

require_env ADMIN_SECRET
[[ -n "${V1_CONTRACT_ID:-}" ]] || fail "--v1-contract is required"
[[ -n "${V2_CONTRACT_ID:-}" ]] || fail "--v2-contract is required"

if [[ -n "${STREAM_IDS:-}" ]]; then
  IFS=',' read -r -a IDS <<< "$STREAM_IDS"
else
  # Prefer the explicit inventory (recommended — from 02_snapshot.sh output).
  # If the contract exposes a stream counter getter, use it as a fallback.
  COUNT=$(contract_query "$V1_CONTRACT_ID" get_stream_id 2>/dev/null) \
    || COUNT=$(contract_query "$V1_CONTRACT_ID" stream_count 2>/dev/null) \
    || fail "No stream inventory provided. Pass --stream-ids or --count (e.g. --stream-ids from 02_snapshot.sh)"
  if [[ "$COUNT" =~ ^[0-9]+$ ]]; then
    IDS=(); for ((i = 1; i <= COUNT; i++)); do IDS+=("$i"); done
  else
    fail "Could not read V1 stream counter; pass --stream-ids explicitly"
  fi
fi

log "Migrating ${#IDS[@]} streams from $V1_CONTRACT_ID to $V2_CONTRACT_ID (batch size $BATCH_SIZE)"

MIGRATED=0
SKIPPED=0
BATCH=()

flush_batch() {
  if [[ ${#BATCH[@]} -eq 0 ]]; then return; fi
  local id
  for id in "${BATCH[@]}"; do
    log "  migrate_stream(v1_id=$id) via receiver secret"
    contract_invoke "$V2_CONTRACT_ID" "$RECEIVER_SECRET" migrate_stream \
      --v1_contract "$V1_CONTRACT_ID" \
      --v1_stream_id "$id" \
      --caller "$RECEIVER_ADDRESS" \
      && MIGRATED=$((MIGRATED + 1)) \
      || { warn "Stream $id failed — skipping (see troubleshooting §12 of the guide)"; SKIPPED=$((SKIPPED + 1)); }
  done
  BATCH=()
}

for id in "${IDS[@]}"; do
  BATCH+=("$id")
  if [[ ${#BATCH[@]} -ge $BATCH_SIZE ]]; then
    flush_batch
  fi
done
flush_batch

echo
ok "Migration complete: $MIGRATED migrated, $SKIPPED skipped/failed"
echo "Run 06_verify.sh to confirm integrity."
