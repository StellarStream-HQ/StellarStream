#!/usr/bin/env bash
# =============================================================================
# StellarStream Contract Deployment — shared helpers
#
# Source this file from the deployment scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/deploy_common.sh"
#
# Required environment variables (or pass via CLI flags):
#   STELLAR_NETWORK   testnet | mainnet
#   ADMIN_SECRET      admin account secret key (for admin-gated calls)
# =============================================================================
set -euo pipefail

# -----------------------------------------------------------------------------
# Logging helpers (identical to migration/common.sh for consistency)
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
# Network helpers
# -----------------------------------------------------------------------------
network_rpc_url() {
  case "${STELLAR_NETWORK:-testnet}" in
    testnet)
      echo "https://soroban-testnet.stellar.org"
      ;;
    mainnet)
      echo "https://soroban-mainnet.stellar.org"
      ;;
    futurenet)
      echo "https://rpc-futurenet.stellar.org"
      ;;
    *)
      # Allow custom RPC URL via env
      if [[ -n "${STELLAR_RPC_URL:-}" ]]; then
        echo "$STELLAR_RPC_URL"
      else
        fail "Unknown network: ${STELLAR_NETWORK}. Set STELLAR_RPC_URL or use testnet/mainnet/futurenet."
      fi
      ;;
  esac
}

validate_network() {
  local net="${1:-${STELLAR_NETWORK:-}}"
  case "$net" in
    testnet|mainnet|futurenet) ;;
    *) fail "Invalid network: '$net'. Must be testnet, mainnet, or futurenet." ;;
  esac
}

# -----------------------------------------------------------------------------
# Contract helpers
# -----------------------------------------------------------------------------
contract_deploy() {
  # Deploy a WASM contract and return the contract ID.
  # usage: contract_deploy <wasm_file> <source_secret>
  local wasm_file="$1" source_secret="$2"
  "$STELLAR_BIN" contract deploy \
    --wasm "$wasm_file" \
    --source "$source_secret" \
    --network "$STELLAR_NETWORK"
}

contract_install() {
  # Install a WASM contract and return the WASM hash.
  # usage: contract_install <wasm_file> <source_secret>
  local wasm_file="$1" source_secret="$2"
  "$STELLAR_BIN" contract install \
    --wasm "$wasm_file" \
    --source "$source_secret" \
    --network "$STELLAR_NETWORK"
}

contract_invoke() {
  # Invoke a contract function.
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
# WASM build helpers
# -----------------------------------------------------------------------------
build_contract_v1() {
  log "Building Contract-V1 WASM ..."
  local contract_dir
  contract_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  (
    cd "$contract_dir"
    "$STELLAR_BIN" contract build --optimize
  )

  local wasm_file="${contract_dir}/target/wasm32-unknown-unknown/release/stellarstream_contracts.wasm"
  if [[ ! -f "$wasm_file" ]]; then
    fail "WASM not found after build: $wasm_file"
  fi

  local size
  size=$(stat -f%z "$wasm_file" 2>/dev/null || stat -c%s "$wasm_file")
  local size_kb=$((size / 1024))

  if [[ $size_kb -gt 64 ]]; then
    fail "WASM size (${size_kb}KB) exceeds 64KB limit"
  fi

  ok "WASM built successfully: ${size_kb}KB"
  echo "$wasm_file"
}

# -----------------------------------------------------------------------------
# Deployment record helpers
# -----------------------------------------------------------------------------
save_deployment_info() {
  # Save deployment metadata to a JSON file for later reference.
  # usage: save_deployment_info <output_file> <network> <contract_id> <admin_address> <wasm_hash>
  local output_file="$1" network="$2" contract_id="$3" admin_address="$4" wasm_hash="$5"
  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  cat > "$output_file" <<EOF
{
  "network": "${network}",
  "contract_id": "${contract_id}",
  "admin_address": "${admin_address}",
  "wasm_hash": "${wasm_hash}",
  "deployed_at": "${timestamp}",
  "deployer": "StellarStream Protocol"
}
EOF
  log "Deployment info saved to: $output_file"
}

# -----------------------------------------------------------------------------
# Parsing helpers
# -----------------------------------------------------------------------------
parse_args() {
  EXTRA_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --contract)        CONTRACT_ID="$2"; shift 2 ;;
      --admin-secret)    ADMIN_SECRET="$2"; shift 2 ;;
      --admin-address)   ADMIN_ADDRESS="$2"; shift 2 ;;
      --network)         STELLAR_NETWORK="$2"; shift 2 ;;
      --wasm-file)       WASM_FILE="$2"; shift 2 ;;
      --wasm-hash)       WASM_HASH="$2"; shift 2 ;;
      --fee-bps)         FEE_BPS="$2"; shift 2 ;;
      --treasury)        TREASURY_ADDRESS="$2"; shift 2 ;;
      --out)             OUT_FILE="$2"; shift 2 ;;
      --pauser-secret)   PAUSER_SECRET="$2"; shift 2 ;;
      --operator-secret) OPERATOR_SECRET="$2"; shift 2 ;;
      -h|--help)         usage; exit 0 ;;
      *)                 EXTRA_ARGS+=("$1"); shift ;;
    esac
  done
}

# -----------------------------------------------------------------------------
# Defaults
# -----------------------------------------------------------------------------
: "${STELLAR_NETWORK:=testnet}"
: "${ADMIN_ADDRESS:=}"
