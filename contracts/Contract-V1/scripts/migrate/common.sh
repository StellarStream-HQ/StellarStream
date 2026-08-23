#!/usr/bin/env bash
# =============================================================================
# StellarStream Contract Migration — shared helpers
#
# Source this file from the migration scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#
# Required environment variables (or pass via --env-file):
#   STELLAR_NETWORK   testnet | mainnet
#   STELLAR_RPC_URL   optional; defaults to the CLI's configured network
#   ADMIN_SECRET      admin account secret key (for admin-gated calls)
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Logging helpers
# -----------------------------------------------------------------------------
log()  { printf '\033[0;36m[%s]\033[0m %s\n' "$(date -u +%H:%M:%S)" "$*"; }
warn() { printf '\033[0;33m[WARN]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[0;32m[OK]\033[0m %s\n' "$*"; }

# -----------------------------------------------------------------------------
# Environment / CLI validation
# -----------------------------------------------------------------------------
require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: $cmd"
}

require_env() {
  local var="$1"
  [[ -n "${!var:-}" ]] || fail "Missing required environment variable: $var"
}

detect_cli() {
  # Prefer the `stellar` CLI; fall back to `soroban`.
  if command -v stellar >/dev/null 2>&1; then
    STELLAR_BIN="stellar"
  elif command -v soroban >/dev/null 2>&1; then
    STELLAR_BIN="soroban"
  else
    fail "Neither 'stellar' nor 'soroban' CLI found. Install one first."
  fi
  export STELLAR_BIN
}

# -----------------------------------------------------------------------------
# Stellar CLI wrappers
# -----------------------------------------------------------------------------
contract_invoke() {
  # usage: contract_invoke <contract_id> <source_secret> <fn> [args...]
  local contract_id="$1" source_secret="$2" fn="$3"
  shift 3
  "$STELLAR_BIN" contract invoke \
    --id "$contract_id" \
    --source "$source_secret" \
    --network "$STELLAR_NETWORK" \
    -- "$fn" "$@"
}

contract_query() {
  # Read-only invoke (no source needed).
  # usage: contract_query <contract_id> <fn> [args...]
  local contract_id="$1" fn="$2"
  shift 2
  "$STELLAR_BIN" contract invoke \
    --id "$contract_id" \
    --network "$STELLAR_NETWORK" \
    -- "$fn" "$@"
}

# -----------------------------------------------------------------------------
# Parsing helpers
# -----------------------------------------------------------------------------
parse_args() {
  # Minimal, predictable flag parsing shared by the numbered scripts.
  # Accepts --flag value pairs; unknown flags are collected in EXTRA_ARGS.
  EXTRA_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --v1-contract)     V1_CONTRACT_ID="$2"; shift 2 ;;
      --v2-contract)     V2_CONTRACT_ID="$2"; shift 2 ;;
      --contract)        CONTRACT_ID="$2"; shift 2 ;;
      --admin-secret)    ADMIN_SECRET="$2"; shift 2 ;;
      --receiver-secret) RECEIVER_SECRET="$2"; shift 2 ;;
      --network)         STELLAR_NETWORK="$2"; shift 2 ;;
      --batch-size)      BATCH_SIZE="$2"; shift 2 ;;
      --stream-ids)      STREAM_IDS="$2"; shift 2 ;;
      --count)           COUNT="$2"; shift 2 ;;
      --receiver-address) RECEIVER_ADDRESS="$2"; shift 2 ;;
      --wasm-hash)       WASM_HASH="$2"; shift 2 ;;
      --wasm-file)       WASM_FILE="$2"; shift 2 ;;
      --out)             OUT_FILE="$2"; shift 2 ;;
      -h|--help)         usage; exit 0 ;;
      *)                 EXTRA_ARGS+=("$1"); shift ;;
    esac
  done
}

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
: "${STELLAR_NETWORK:=testnet}"
: "${BATCH_SIZE:=20}"
