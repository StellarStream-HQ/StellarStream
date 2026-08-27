//! Resolved settings for one invocation.
//!
//! Combines flags, environment and config file into the values a command
//! actually runs with, applying the precedence documented in [`crate::config`]:
//! flag > environment > config file > default.

use crate::config::Config;
use crate::error::{CliError, Result};
use crate::network::Network;

/// What a command needs to reach the contract.
#[derive(Debug, Clone)]
pub struct Settings {
    pub network: Network,
    pub rpc_url: String,
    pub contract_id: Option<String>,
    pub secret_key_env: String,
    pub json: bool,
}

/// The flag-level inputs, before resolution.
#[derive(Debug, Clone, Default)]
pub struct Overrides {
    pub network: Option<Network>,
    pub rpc_url: Option<String>,
    pub contract_id: Option<String>,
    pub secret_key_env: Option<String>,
    pub json: bool,
}

pub const DEFAULT_SECRET_ENV: &str = "STELLARSTREAM_SECRET_KEY";

impl Settings {
    /// Resolve settings from flags, environment and config.
    ///
    /// `env` is passed in rather than read directly so the precedence rules can
    /// be tested without mutating the process environment.
    pub fn resolve(
        overrides: &Overrides,
        config: &Config,
        env: &dyn Fn(&str) -> Option<String>,
    ) -> Result<Self> {
        let network = match &overrides.network {
            Some(network) => *network,
            None => match env("STELLARSTREAM_NETWORK") {
                Some(text) => text.parse()?,
                None => config.network.unwrap_or_default(),
            },
        };

        let rpc_url = overrides
            .rpc_url
            .clone()
            .or_else(|| env("STELLARSTREAM_RPC_URL"))
            .or_else(|| config.rpc_url.clone())
            .unwrap_or_else(|| network.default_rpc_url().to_string());

        let contract_id = match overrides.contract_id.clone() {
            Some(id) => Some(crate::parse::parse_contract_id(&id)?),
            None => match env("STELLARSTREAM_CONTRACT_ID") {
                Some(id) => Some(crate::parse::parse_contract_id(&id)?),
                None => config.contract_id_for(network).map(str::to_string),
            },
        };

        let secret_key_env = overrides
            .secret_key_env
            .clone()
            .or_else(|| config.secret_key_env.clone())
            .unwrap_or_else(|| DEFAULT_SECRET_ENV.to_string());

        let json = overrides.json || config.output.as_deref() == Some("json");

        Ok(Settings {
            network,
            rpc_url,
            contract_id,
            secret_key_env,
            json,
        })
    }

    /// The contract id, or an error explaining every way to supply one.
    pub fn require_contract_id(&self) -> Result<&str> {
        self.contract_id
            .as_deref()
            .ok_or_else(CliError::missing_contract)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    const CONTRACT_A: &str = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";

    fn env_from(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |key: &str| map.get(key).cloned()
    }

    #[test]
    fn defaults_to_testnet_and_its_rpc() {
        let settings =
            Settings::resolve(&Overrides::default(), &Config::default(), &env_from(&[])).unwrap();
        assert_eq!(settings.network, Network::Testnet);
        assert_eq!(settings.rpc_url, Network::Testnet.default_rpc_url());
        assert_eq!(settings.secret_key_env, DEFAULT_SECRET_ENV);
    }

    #[test]
    fn config_beats_the_default() {
        let config = Config {
            network: Some(Network::Mainnet),
            ..Default::default()
        };
        let settings = Settings::resolve(&Overrides::default(), &config, &env_from(&[])).unwrap();
        assert_eq!(settings.network, Network::Mainnet);
        assert_eq!(settings.rpc_url, Network::Mainnet.default_rpc_url());
    }

    #[test]
    fn environment_beats_config() {
        let config = Config {
            network: Some(Network::Mainnet),
            ..Default::default()
        };
        let settings = Settings::resolve(
            &Overrides::default(),
            &config,
            &env_from(&[("STELLARSTREAM_NETWORK", "testnet")]),
        )
        .unwrap();
        assert_eq!(settings.network, Network::Testnet);
    }

    #[test]
    fn the_flag_beats_everything() {
        let config = Config {
            network: Some(Network::Mainnet),
            ..Default::default()
        };
        let overrides = Overrides {
            network: Some(Network::Testnet),
            ..Default::default()
        };
        let settings = Settings::resolve(
            &overrides,
            &config,
            &env_from(&[("STELLARSTREAM_NETWORK", "mainnet")]),
        )
        .unwrap();
        assert_eq!(settings.network, Network::Testnet);
    }

    #[test]
    fn the_contract_id_follows_the_selected_network() {
        let config = Config {
            testnet_contract_id: Some(CONTRACT_A.into()),
            ..Default::default()
        };

        let on_testnet =
            Settings::resolve(&Overrides::default(), &config, &env_from(&[])).unwrap();
        assert_eq!(on_testnet.contract_id.as_deref(), Some(CONTRACT_A));

        let on_mainnet = Settings::resolve(
            &Overrides {
                network: Some(Network::Mainnet),
                ..Default::default()
            },
            &config,
            &env_from(&[]),
        )
        .unwrap();
        assert!(
            on_mainnet.contract_id.is_none(),
            "the testnet contract must not be used on mainnet"
        );
    }

    #[test]
    fn a_missing_contract_id_explains_all_three_sources() {
        let settings =
            Settings::resolve(&Overrides::default(), &Config::default(), &env_from(&[])).unwrap();
        let err = settings.require_contract_id().unwrap_err();
        let hint = err.hint().unwrap();
        assert!(hint.contains("--contract-id"));
        assert!(hint.contains("STELLARSTREAM_CONTRACT_ID"));
    }

    #[test]
    fn an_invalid_contract_id_is_rejected_at_resolution() {
        let overrides = Overrides {
            contract_id: Some("nope".into()),
            ..Default::default()
        };
        assert!(Settings::resolve(&overrides, &Config::default(), &env_from(&[])).is_err());
    }

    #[test]
    fn json_output_can_come_from_config_or_flag() {
        let config = Config {
            output: Some("json".into()),
            ..Default::default()
        };
        assert!(
            Settings::resolve(&Overrides::default(), &config, &env_from(&[]))
                .unwrap()
                .json
        );
        assert!(Settings::resolve(
            &Overrides {
                json: true,
                ..Default::default()
            },
            &Config::default(),
            &env_from(&[])
        )
        .unwrap()
        .json);
    }
}
