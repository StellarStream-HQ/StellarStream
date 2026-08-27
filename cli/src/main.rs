//! Entry point.
//!
//! Parses arguments, resolves settings, dispatches to a command, and renders
//! either the result or an actionable error.

use clap::Parser;
use std::path::PathBuf;
use std::process::ExitCode;

use stellarstream_cli::cli::{AdminCommand, Cli, Command, ConfigCommand};
use stellarstream_cli::client::ContractClient;
use stellarstream_cli::commands::{admin, config_cmd, stream};
use stellarstream_cli::config::Config;
use stellarstream_cli::error::Result;
use stellarstream_cli::prompt;
use stellarstream_cli::settings::{Overrides, Settings};
use stellarstream_cli::signer::Signer;

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli).await {
        Ok(output) => {
            println!("{output}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("{}", err.render());
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> Result<String> {
    let config_path: PathBuf = match &cli.config {
        Some(path) => PathBuf::from(path),
        None => Config::default_path()?,
    };
    let config = Config::load(&config_path)?;

    let overrides = Overrides {
        network: cli.network,
        rpc_url: cli.rpc_url.clone(),
        contract_id: cli.contract_id.clone(),
        secret_key_env: cli.secret_key_env.clone(),
        json: cli.json,
    };
    let settings = Settings::resolve(&overrides, &config, &|name| std::env::var(name).ok())?;

    match cli.command {
        // Config commands touch no network and need no key.
        Command::Config(ConfigCommand::Show) => config_cmd::show(&settings, &config, &config_path),
        Command::Config(ConfigCommand::Path) => config_cmd::path(&config_path, settings.json),
        Command::Config(ConfigCommand::Set { key, value }) => {
            config_cmd::set(&key, &value, config, &config_path, settings.json)
        }

        // Reads need a contract but no signing key.
        Command::Query(args) => {
            let client = ContractClient::new(&settings)?;
            stream::query(args, &settings, &client).await
        }
        Command::List(args) => {
            let client = ContractClient::new(&settings)?;
            stream::list(args, &settings, &client).await
        }

        // Writes need both. The key is resolved lazily, so bad arguments are
        // reported before the user is asked for a secret.
        Command::Create(args) => {
            let client = ContractClient::new(&settings)?;
            let signer = || resolve_signer(&settings);
            stream::create(args, &settings, &signer, &client, cli.yes).await
        }
        Command::Withdraw(args) => {
            let client = ContractClient::new(&settings)?;
            let signer = || resolve_signer(&settings);
            stream::withdraw(args, &settings, &signer, &client).await
        }
        Command::Cancel(args) => {
            let client = ContractClient::new(&settings)?;
            let signer = || resolve_signer(&settings);
            stream::cancel(args, &settings, &signer, &client, cli.yes).await
        }
        Command::Admin(AdminCommand::GrantRole(args)) => {
            let client = ContractClient::new(&settings)?;
            let signer = || resolve_signer(&settings);
            admin::grant_role(args, &settings, &signer, &client, cli.yes).await
        }
        Command::Admin(AdminCommand::SetFee(args)) => {
            let client = ContractClient::new(&settings)?;
            let signer = || resolve_signer(&settings);
            admin::set_fee(args, &settings, &signer, &client, cli.yes).await
        }
    }
}

/// Read the signing key from the environment, or prompt for it.
fn resolve_signer(settings: &Settings) -> Result<Signer> {
    Signer::resolve(
        &settings.secret_key_env,
        &|name| std::env::var(name).ok(),
        &|| prompt::secret_prompt("Secret key"),
    )
}
