# StellarStream CLI

Command-line interface for the StellarStream payment-streaming contracts.

Issue: [#1495](https://github.com/StellarStream-HQ/StellarStream/issues/1495)

```bash
stellarstream create --sender GA... --receiver GB... --token C... --amount 1000 --duration 30d
stellarstream query --stream-id 123
stellarstream withdraw --stream-id 123
```

## Install

```bash
cargo install --path cli
```

That puts `stellarstream` on your `PATH`.

Building needs a system OpenSSL development package, because the Soroban client
links TLS through `native-tls`. On Debian/Ubuntu:

```bash
sudo apt install libssl-dev pkg-config
```

If you cannot install it, build OpenSSL from source instead:

```bash
cargo install --path cli --features vendored-tls
```

## Quick start

```bash
# 1. Point the CLI at a contract
stellarstream config set network testnet
stellarstream config set contract_id C...

# 2. Read something — no key needed
stellarstream query --stream-id 1

# 3. Provide a signing key for writes
export STELLARSTREAM_SECRET_KEY=S...
stellarstream create --receiver GB... --token C... --amount 1000 --duration 30d
```

## Commands

### Streams

| Command | What it does |
| --- | --- |
| `create` | Create a stream |
| `withdraw --stream-id N` | Withdraw whatever has unlocked |
| `cancel --stream-id N` | Cancel a stream (asks first) |
| `query --stream-id N` | Show one stream |
| `list --user G...` | List the streams an account is party to |

`create` options:

| Flag | Meaning |
| --- | --- |
| `--sender G...` | Funding account |
| `--receiver G...` | Receiving account |
| `--token C...` | Token contract |
| `--amount N` | Total to stream. `1000`, `1_000` and `1,000` all work |
| `--duration D` | `30d`, `12h`, `90m`, `45s`, `2w`, or compound: `1d12h`. A bare number is seconds |
| `--start T` | Unix start time (default: now) |
| `--curve linear\|exponential` | Vesting curve (default: linear) |
| `--soulbound` | Make the stream non-transferable |

Anything omitted is prompted for, so `stellarstream create` on its own walks
through the parameters. In a script, a missing value is an error naming the
flag rather than a hang waiting for input.

### Admin

| Command | What it does |
| --- | --- |
| `admin grant-role --account G... --role admin\|pauser\|treasury` | Grant a role |
| `admin set-fee --bps N` | Set the protocol fee (100 bps = 1%) |

Both confirm before submitting. Pass `--yes` to skip the prompt in a script.

### Config

| Command | What it does |
| --- | --- |
| `config show` | Show the values actually in effect |
| `config set KEY VALUE` | Write a setting |
| `config path` | Print the config file path |

### Global flags

| Flag | Meaning |
| --- | --- |
| `-n, --network testnet\|mainnet` | Which network |
| `--rpc-url URL` | Override the RPC endpoint |
| `--contract-id C...` | StellarStream contract |
| `--secret-key-env NAME` | Read the signing key from a different variable |
| `--config PATH` | Use a different config file |
| `--json` | Emit JSON instead of tables |
| `-y, --yes` | Skip confirmation prompts |

## Configuration

Settings live in `~/.stellarstream/config.toml` and resolve in this order:

```
command-line flag  >  environment variable  >  config file  >  built-in default
```

```toml
network = "testnet"
testnet_contract_id = "C..."
mainnet_contract_id = "C..."
rpc_url = "https://soroban-testnet.stellar.org"
secret_key_env = "STELLARSTREAM_SECRET_KEY"
output = "table"
```

Contract ids are recorded per network, so switching with `--network mainnet`
cannot accidentally send a transaction to the testnet contract.

| Setting | Environment variable |
| --- | --- |
| `network` | `STELLARSTREAM_NETWORK` |
| `contract_id` | `STELLARSTREAM_CONTRACT_ID` |
| `rpc_url` | `STELLARSTREAM_RPC_URL` |
| — | `STELLARSTREAM_CONFIG` (path to the config file) |

## Keys

**The config file never holds secrets.** Admin commands sign with privileged
keys, and a CLI that writes those to a dotfile turns every backup, `cat` and
screen-share into a key leak. `config set secret_key ...` is refused.

A signing key comes from one of two places:

1. `$STELLARSTREAM_SECRET_KEY` — or another variable named by
   `--secret-key-env NAME`
2. An interactive prompt, which does not echo, and keeps the key in memory only
   for the life of the process

Read-only commands (`query`, `list`, `config`) need no key at all.

Keys are only requested after every argument has been validated, so a typo
never gets as far as asking for a secret. `Signer` has a redacting `Debug`
implementation, so a stray `{:?}` cannot print signing material.

## Transactions

Every write goes through one pipeline:

```
build → simulate → assemble with footprint + resource fee → sign → submit → poll
```

Simulation is not optional. It is what determines the footprint and resource
fee; submitting without it produces transactions that fail on-chain after the
fee has been taken. Each step is announced with a progress indicator, since the
whole sequence takes several seconds.

Reads use the same builder but stop after simulation, so they cost nothing and
need no key.

## Output

Human-readable tables by default:

```
┌─────────────────┬──────────────────────────┐
│ Field           ┆ Value                    │
╞═════════════════╪══════════════════════════╡
│ Stream ID       ┆ 7                        │
│ State           ┆ active                   │
│ Total           ┆ 1,000,000                │
│ Withdrawn       ┆ 250,000                  │
│ Progress        ┆ 25%                      │
│ Duration        ┆ 30d                      │
└─────────────────┴──────────────────────────┘
```

`--json` emits machine-readable output instead, and suppresses the progress
spinner so stdout stays parseable:

```bash
stellarstream query --stream-id 7 --json | jq .total_amount
```

Set `output = "json"` in the config to make that the default.

## Errors

Errors name the offending value and what would have worked:

```
$ stellarstream create --duration 30x ...
error: '30x' is not a valid duration: 'x' is not a known unit (use s, m, h, d or w)
hint: durations look like 30d, 12h, 90m, 45s, or 1d12h

$ stellarstream query --stream-id 1
error: no contract id configured for this network
hint: pass --contract-id C..., set STELLARSTREAM_CONTRACT_ID, or run: stellarstream config set contract_id C...
```

Contract failures are translated from numeric codes into sentences —
`Error(Contract, #4)` becomes "no stream with that id exists".

Exit status is `0` on success and `1` on failure, so the tool composes with
shell scripts.

## Development

```bash
cargo test                          # or: cargo test --features vendored-tls
cargo clippy --all-targets
```

The tests split in two:

- **Unit tests** next to each module cover duration and amount parsing, address
  validation, setting precedence, key resolution, output formatting and the
  `ScVal` codec.
- **Integration tests** in `tests/cli.rs` run the built `stellarstream` binary
  and assert on its real stdout, stderr and exit status — config round-trips,
  precedence, and every error path above.
