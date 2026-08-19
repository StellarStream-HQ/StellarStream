#!/usr/bin/env bash
# =============================================================================
# 02_snapshot.sh — Pre-migration data snapshot
#
# Dumps a read-only snapshot of all V1 streams to a JSON file so the migration
# can be reconciled and, if necessary, rolled back. The snapshot is a best-effort
# inventory: it reads the stream counter and queries each stream.
#
# Usage:
#   ./02_snapshot.sh --v1-contract C... --network testnet --out snapshots/pre.json
#   ./02_snapshot.sh --v1-contract C... --count 1500   # explicit stream count
# =============================================================================
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

usage() {
  cat <<EOF
Usage: 02_snapshot.sh --v1-contract C... [--network testnet] [--out FILE.json] [--count N]

Outputs a JSON file with:
  {
    "network": "...",
    "snapshot_at": "...",
    "v1_contract": "...",
    "stream_count": N,
    "streams": [ { "stream_id": 1, "data": {...} } ]
  }

--count N: explicit number of streams to snapshot. Use this when the contract
has no public stream-counter getter; obtain N from your backend indexer or by
enumerating known stream IDs.
EOF
}

parse_args "$@"
detect_cli
require_env ADMIN_SECRET
[[ -n "${V1_CONTRACT_ID:-}" ]] || fail "--v1-contract is required"
: "${OUT_FILE:=snapshots/pre-$(date -u +%Y%m%d-%H%M%S).json}"

mkdir -p "$(dirname "$OUT_FILE")"

log "Snapshotting V1 contract $V1_CONTRACT_ID on $STELLAR_NETWORK"

# Read the stream counter if the contract exposes a getter; otherwise fall back
# to an explicit --count provided by the operator.
if [[ -n "${COUNT:-}" ]]; then
  STREAM_COUNT=$COUNT
else
  STREAM_COUNT=$(contract_query "$V1_CONTRACT_ID" get_stream_id 2>/dev/null) \
    || STREAM_COUNT=$(contract_query "$V1_CONTRACT_ID" stream_count 2>/dev/null) \
    || { warn "No public stream counter found; pass --count N explicitly."; STREAM_COUNT=0; }
fi

log "Streams to snapshot: $STREAM_COUNT"

# Build JSON incrementally
SNAPSHOT_FILE="$OUT_FILE"
{
  printf '{\n'
  printf '  "network": "%s",\n' "$STELLAR_NETWORK"
  printf '  "snapshot_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "v1_contract": "%s",\n' "$V1_CONTRACT_ID"
  printf '  "stream_count": %s,\n' "$STREAM_COUNT"
  printf '  "streams": [\n'
} > "$SNAPSHOT_FILE"

FIRST=1
for ((id = 1; id <= STREAM_COUNT; id++)); do
  DATA=$(contract_query "$V1_CONTRACT_ID" get_stream --stream_id "$id" 2>/dev/null) \
    || { warn "Could not read stream $id — skipping"; continue; }
  if [[ $FIRST -eq 0 ]]; then printf ',\n' >> "$SNAPSHOT_FILE"; fi
  FIRST=0
  printf '    { "stream_id": %s, "data": %s }' "$id" "$DATA" >> "$SNAPSHOT_FILE"
done

printf '\n  ]\n}\n' >> "$SNAPSHOT_FILE"

ok "Snapshot written to $SNAPSHOT_FILE ($(wc -l < "$SNAPSHOT_FILE") lines)"
echo "Keep this file in durable storage — it is your reconciliation/rollback reference."
