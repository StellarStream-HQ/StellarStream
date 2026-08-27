# StellarStream Contract Deployment Scripts

Deployment automation for the StellarStream token-streaming contract on Stellar/Soroban networks.

## Overview

These scripts automate the deployment process including:
- Building optimized WASM binaries
- Installing and deploying contracts to Testnet/Mainnet
- Initializing contracts with admin addresses
- Configuring RBAC roles and parameters
- Verifying deployment health

## Prerequisites

- [Stellar CLI](https://developers.stellar.org/docs/tools/sdks/cli) (`stellar` or `soroban`)
- Rust toolchain with `wasm32-unknown-unknown` target
- Admin account with sufficient XLM for contract reserves (~10 XLM)

## Quick Start

### Testnet Deployment (Recommended First)

```bash
# Simple deploy
./deploy_testnet.sh --admin-secret S...

# Deploy + initialize
./deploy_testnet.sh --admin-secret S... --init

# Full deploy + initialize + configure
./deploy_testnet.sh --admin-secret S... --init --config \
  --fee-bps 250 --treasury GA... \
  --pauser-secret S... --operator-secret S...
```

### Mainnet Deployment

⚠️ **Always test on testnet first!**

```bash
./deploy_mainnet.sh --admin-secret S... --init
```

The mainnet script requires interactive confirmation before deploying.

## Scripts

### deploy_testnet.sh / deploy_mainnet.sh

Main deployment scripts that handle the full deployment lifecycle.

| Flag | Description | Required |
|------|-------------|----------|
| `--admin-secret KEY` | Admin account secret key | ✅ |
| `--wasm-file PATH` | Pre-built WASM (skips build) | ❌ |
| `--init` | Initialize contract after deploy | ❌ |
| `--config` | Configure roles (requires `--init`) | ❌ |
| `--fee-bps N` | Fee in basis points | ❌ |
| `--treasury ADDRESS` | Treasury address | ❌ |
| `--pauser-secret KEY` | Grant Guardian role | ❌ |
| `--operator-secret KEY` | Grant FinancialOperator role | ❌ |
| `--out FILE` | Output deployment JSON | ❌ |

### initialize.sh

Initializes a deployed contract by setting the admin address and optionally granting RBAC roles.

```bash
./initialize.sh --contract C... --admin-secret S...
```

### configure.sh

Configures protocol parameters and RBAC roles on an initialized contract.

```bash
./configure.sh --contract C... --admin-secret S... --pauser-secret S...
```

### verify.sh

Verifies deployment health by checking queryability, admin address, and RBAC roles.

```bash
./verify.sh --contract C... --network testnet
```

## Common Helpers

`deploy_common.sh` provides shared utilities used by all scripts:

- **Logging**: `log`, `warn`, `fail`, `ok`
- **CLI detection**: `detect_cli` (stellar/soroban)
- **Network helpers**: `network_rpc_url`, `validate_network`
- **Contract operations**: `contract_deploy`, `contract_install`, `contract_invoke`, `contract_query`
- **WASM build**: `build_contract_v1`
- **Deployment records**: `save_deployment_info`

## RBAC Roles

The contract uses three RBAC roles:

| Role | ID | Permissions |
|------|----|-------------|
| `SuperAdmin` | 0 | Upgrade contract, manage roles, all operations |
| `FinancialOperator` | 1 | Set fees, manage treasury |
| `Guardian` | 2 | Pause/unpause contract (emergency controls) |

When initializing with `--init --config`, the admin automatically receives all three roles. Additional roles can be granted to other accounts.

## Deployment Output

Deployment scripts save a JSON file with deployment metadata:

```json
{
  "network": "testnet",
  "contract_id": "C...",
  "admin_address": "GA...",
  "wasm_hash": "abc123...",
  "deployed_at": "2025-01-01T00:00:00Z",
  "deployer": "StellarStream Protocol"
}
```

## Workflow

### Full Production Deployment

```bash
# 1. Testnet deployment and verification
./deploy_testnet.sh --admin-secret S... --init --config
./verify.sh --contract C_TESTNET... --network testnet

# 2. Test contract on testnet
stellar contract invoke --id C_TESTNET... --source S... --network testnet \
  -- create_stream ...

# 3. Mainnet deployment (after testnet validation)
./deploy_mainnet.sh --admin-secret S... --init --config

# 4. Verify mainnet deployment
./verify.sh --contract C_MAINNET... --network mainnet
```

### Incremental Setup

```bash
# Step 1: Deploy only
./deploy_testnet.sh --admin-secret S...

# Step 2: Initialize separately
./initialize.sh --contract C... --admin-secret S...

# Step 3: Configure roles
./configure.sh --contract C... --admin-secret S... --pauser-secret S...

# Step 4: Verify
./verify.sh --contract C... --network testnet
```

## Network Configuration

| Network | RPC URL | Explorer |
|---------|---------|----------|
| testnet | https://soroban-testnet.stellar.org | https://testnet.steexp.com |
| mainnet | https://soroban-mainnet.stellar.org | https://steexp.com |
| futurenet | https://rpc-futurenet.stellar.org | https://futurenet.steexp.com |

## Troubleshooting

### "Required command not found: stellar"
Install the Stellar CLI: `curl -sSf https://stellar.org/install-cli | sh`

### "Missing required environment variable: ADMIN_SECRET"
Set the admin secret: `export ADMIN_SECRET=S...`

### "WASM not found after build"
Ensure the Rust toolchain has the wasm32 target:
```bash
rustup target add wasm32-unknown-unknown
```

### "Admin not set"
The contract has not been initialized. Run `initialize.sh` first.

## Security Notes

- Never commit secret keys to version control
- Use environment variables or secure secret managers
- Test on testnet before mainnet
- Verify deployment with `verify.sh` before using in production
- The mainnet script requires interactive confirmation
