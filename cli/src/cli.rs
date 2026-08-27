//! Command-line surface.

use clap::{Parser, Subcommand};

use crate::network::Network;

#[derive(Parser, Debug)]
#[command(
    name = "stellarstream",
    version,
    about = "Interact with the StellarStream payment-streaming contracts",
    long_about = "Create, inspect and manage token streams on Stellar.\n\n\
                  Settings resolve as: flag > environment variable > \
                  ~/.stellarstream/config.toml > default.\n\n\
                  Signing keys are read from $STELLARSTREAM_SECRET_KEY or prompted \
                  for. They are never written to the config file.",
    propagate_version = true
)]
pub struct Cli {
    /// Network to use.
    #[arg(long, short = 'n', global = true, value_name = "testnet|mainnet")]
    pub network: Option<Network>,

    /// Override the Soroban RPC endpoint.
    #[arg(long, global = true, value_name = "URL")]
    pub rpc_url: Option<String>,

    /// StellarStream contract address.
    #[arg(long, global = true, value_name = "C...")]
    pub contract_id: Option<String>,

    /// Environment variable holding the signing secret.
    #[arg(long, global = true, value_name = "NAME")]
    pub secret_key_env: Option<String>,

    /// Path to the config file.
    #[arg(long, global = true, value_name = "PATH")]
    pub config: Option<String>,

    /// Emit JSON instead of tables.
    #[arg(long, global = true)]
    pub json: bool,

    /// Skip confirmation prompts.
    #[arg(long, short = 'y', global = true)]
    pub yes: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Create a new stream.
    Create(CreateArgs),
    /// Withdraw unlocked funds from a stream.
    Withdraw(StreamIdArgs),
    /// Cancel a stream.
    Cancel(StreamIdArgs),
    /// Show one stream.
    Query(StreamIdArgs),
    /// List the streams an account is party to.
    List(ListArgs),
    /// Administrative commands.
    #[command(subcommand)]
    Admin(AdminCommand),
    /// Inspect or change the config file.
    #[command(subcommand)]
    Config(ConfigCommand),
}

#[derive(clap::Args, Debug)]
pub struct CreateArgs {
    /// Funding account. Prompted for if omitted.
    #[arg(long, value_name = "G...")]
    pub sender: Option<String>,

    /// Receiving account. Prompted for if omitted.
    #[arg(long, value_name = "G...")]
    pub receiver: Option<String>,

    /// Token contract address. Prompted for if omitted.
    #[arg(long, value_name = "C...")]
    pub token: Option<String>,

    /// Total amount to stream. Prompted for if omitted.
    #[arg(long, value_name = "AMOUNT")]
    pub amount: Option<String>,

    /// How long the stream runs, e.g. 30d, 12h, 1d12h. Prompted for if omitted.
    #[arg(long, value_name = "DURATION")]
    pub duration: Option<String>,

    /// Unix start time. Defaults to now.
    #[arg(long, value_name = "TIMESTAMP")]
    pub start: Option<u64>,

    /// Vesting curve.
    #[arg(long, value_enum, default_value_t = Curve::Linear)]
    pub curve: Curve,

    /// Make the stream non-transferable.
    #[arg(long)]
    pub soulbound: bool,
}

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Curve {
    Linear,
    Exponential,
}

impl Curve {
    pub fn as_u32(self) -> u32 {
        match self {
            Curve::Linear => 0,
            Curve::Exponential => 1,
        }
    }
}

#[derive(clap::Args, Debug)]
pub struct StreamIdArgs {
    /// Stream id.
    #[arg(long, value_name = "ID")]
    pub stream_id: u64,

    /// Account performing the action. Defaults to the signing key.
    #[arg(long, value_name = "G...")]
    pub account: Option<String>,
}

#[derive(clap::Args, Debug)]
pub struct ListArgs {
    /// Account whose streams to list.
    #[arg(long, value_name = "G...")]
    pub user: String,
}

#[derive(Subcommand, Debug)]
pub enum AdminCommand {
    /// Grant a role to an account.
    GrantRole(GrantRoleArgs),
    /// Set the protocol fee, in basis points.
    SetFee(SetFeeArgs),
}

#[derive(clap::Args, Debug)]
pub struct GrantRoleArgs {
    /// Account to grant the role to.
    #[arg(long, value_name = "G...")]
    pub account: String,

    /// Role to grant.
    #[arg(long, value_enum)]
    pub role: Role,
}

#[derive(clap::ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Admin,
    Pauser,
    Treasury,
}

impl Role {
    pub fn as_u32(self) -> u32 {
        match self {
            Role::Admin => 0,
            Role::Pauser => 1,
            Role::Treasury => 2,
        }
    }
}

#[derive(clap::Args, Debug)]
pub struct SetFeeArgs {
    /// Fee in basis points. 100 bps = 1%.
    #[arg(long, value_name = "BPS")]
    pub bps: u32,
}

#[derive(Subcommand, Debug)]
pub enum ConfigCommand {
    /// Show the resolved configuration and where each value came from.
    Show,
    /// Set a value in the config file.
    Set {
        /// Setting name.
        key: String,
        /// New value.
        value: String,
    },
    /// Print the config file path.
    Path,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn the_command_tree_is_valid() {
        Cli::command().debug_assert();
    }

    #[test]
    fn parses_the_documented_create_invocation() {
        let cli = Cli::try_parse_from([
            "stellarstream",
            "create",
            "--sender",
            "GA",
            "--receiver",
            "GB",
            "--amount",
            "1000",
            "--duration",
            "30d",
        ])
        .unwrap();
        match cli.command {
            Command::Create(args) => {
                assert_eq!(args.sender.as_deref(), Some("GA"));
                assert_eq!(args.amount.as_deref(), Some("1000"));
                assert_eq!(args.duration.as_deref(), Some("30d"));
                assert_eq!(args.curve, Curve::Linear, "linear is the default");
            }
            other => panic!("expected create, got {other:?}"),
        }
    }

    #[test]
    fn parses_the_documented_admin_invocations() {
        let cli = Cli::try_parse_from([
            "stellarstream",
            "admin",
            "grant-role",
            "--account",
            "GA",
            "--role",
            "admin",
        ])
        .unwrap();
        match cli.command {
            Command::Admin(AdminCommand::GrantRole(args)) => {
                assert_eq!(args.role, Role::Admin);
                assert_eq!(args.role.as_u32(), 0);
            }
            other => panic!("expected grant-role, got {other:?}"),
        }

        let cli =
            Cli::try_parse_from(["stellarstream", "admin", "set-fee", "--bps", "100"]).unwrap();
        match cli.command {
            Command::Admin(AdminCommand::SetFee(args)) => assert_eq!(args.bps, 100),
            other => panic!("expected set-fee, got {other:?}"),
        }
    }

    #[test]
    fn global_flags_work_after_the_subcommand() {
        let cli = Cli::try_parse_from([
            "stellarstream",
            "query",
            "--stream-id",
            "3",
            "--network",
            "mainnet",
            "--json",
        ])
        .unwrap();
        assert_eq!(cli.network, Some(Network::Mainnet));
        assert!(cli.json);
    }

    #[test]
    fn rejects_an_unknown_network_at_parse_time() {
        assert!(Cli::try_parse_from(["stellarstream", "list", "--user", "GA", "-n", "devnet"]).is_err());
    }

    #[test]
    fn roles_and_curves_map_to_contract_values() {
        assert_eq!(Role::Treasury.as_u32(), 2);
        assert_eq!(Curve::Exponential.as_u32(), 1);
    }
}
