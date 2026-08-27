//! Config file at `~/.stellarstream/config.toml`.
//!
//! The file holds network preferences and contract ids. It deliberately holds
//! **no secrets**: admin commands sign with privileged keys, and a CLI that
//! writes those to a dotfile turns every backup and screen-share into a key
//! leak. Signing material is resolved separately, see [`crate::signer`].
//!
//! Values are resolved with the precedence a CLI user expects:
//! command-line flag > environment variable > config file > built-in default.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::{CliError, Result};
use crate::network::Network;

pub const CONFIG_DIR_NAME: &str = ".stellarstream";
pub const CONFIG_FILE_NAME: &str = "config.toml";

/// On-disk settings.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Network used when `--network` is not given.
    pub network: Option<Network>,
    /// Contract id for testnet.
    pub testnet_contract_id: Option<String>,
    /// Contract id for mainnet.
    pub mainnet_contract_id: Option<String>,
    /// Override the RPC endpoint.
    pub rpc_url: Option<String>,
    /// Environment variable the signing secret is read from.
    pub secret_key_env: Option<String>,
    /// Default output format (`table` or `json`).
    pub output: Option<String>,
}

impl Config {
    /// `~/.stellarstream/config.toml`, or the path in `STELLARSTREAM_CONFIG`.
    pub fn default_path() -> Result<PathBuf> {
        if let Ok(explicit) = std::env::var("STELLARSTREAM_CONFIG") {
            if !explicit.trim().is_empty() {
                return Ok(PathBuf::from(explicit));
            }
        }
        let home = dirs::home_dir().ok_or_else(|| {
            CliError::with_hint(
                "could not locate a home directory",
                "set STELLARSTREAM_CONFIG to an explicit config path",
            )
        })?;
        Ok(home.join(CONFIG_DIR_NAME).join(CONFIG_FILE_NAME))
    }

    /// Load from `path`. A missing file is not an error — it means defaults.
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Config::default());
        }
        let text = std::fs::read_to_string(path).map_err(|e| {
            CliError::with_hint(
                format!("could not read {}: {e}", path.display()),
                "check the file's permissions",
            )
        })?;
        toml::from_str(&text).map_err(|e| {
            CliError::with_hint(
                format!("could not parse {}: {e}", path.display()),
                "fix the file by hand, or delete it to start from defaults",
            )
        })
    }

    /// Write to `path`, creating the directory if needed.
    pub fn save(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                CliError::new(format!("could not create {}: {e}", parent.display()))
            })?;
        }
        let text = toml::to_string_pretty(self)
            .map_err(|e| CliError::new(format!("could not serialise config: {e}")))?;
        std::fs::write(path, text)
            .map_err(|e| CliError::new(format!("could not write {}: {e}", path.display())))?;
        Ok(())
    }

    /// Contract id recorded for `network`.
    pub fn contract_id_for(&self, network: Network) -> Option<&str> {
        match network {
            Network::Testnet => self.testnet_contract_id.as_deref(),
            Network::Mainnet => self.mainnet_contract_id.as_deref(),
        }
    }

    pub fn set_contract_id_for(&mut self, network: Network, contract_id: String) {
        match network {
            Network::Testnet => self.testnet_contract_id = Some(contract_id),
            Network::Mainnet => self.mainnet_contract_id = Some(contract_id),
        }
    }

    /// Set one field by name, for `stellarstream config set`.
    pub fn set_field(&mut self, key: &str, value: &str) -> Result<()> {
        match key {
            "network" => self.network = Some(value.parse()?),
            "testnet_contract_id" => {
                self.testnet_contract_id = Some(crate::parse::parse_contract_id(value)?)
            }
            "mainnet_contract_id" => {
                self.mainnet_contract_id = Some(crate::parse::parse_contract_id(value)?)
            }
            "contract_id" => {
                let network = self.network.unwrap_or_default();
                self.set_contract_id_for(network, crate::parse::parse_contract_id(value)?);
            }
            "rpc_url" => self.rpc_url = Some(value.to_string()),
            "secret_key_env" => self.secret_key_env = Some(value.to_string()),
            "output" => {
                if !matches!(value, "table" | "json") {
                    return Err(CliError::with_hint(
                        format!("unknown output format '{value}'"),
                        "choose table or json",
                    ));
                }
                self.output = Some(value.to_string());
            }
            "secret_key" | "secret" | "private_key" => {
                return Err(CliError::with_hint(
                    "secrets are not stored in the config file",
                    "export STELLARSTREAM_SECRET_KEY instead, or set secret_key_env to name a \
                     different variable",
                ))
            }
            other => {
                return Err(CliError::with_hint(
                    format!("unknown setting '{other}'"),
                    "known settings: network, contract_id, testnet_contract_id, \
                     mainnet_contract_id, rpc_url, secret_key_env, output",
                ))
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_config_path() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(CONFIG_DIR_NAME).join(CONFIG_FILE_NAME);
        (dir, path)
    }

    #[test]
    fn a_missing_file_loads_as_defaults() {
        let (_dir, path) = temp_config_path();
        let config = Config::load(&path).unwrap();
        assert_eq!(config, Config::default());
    }

    #[test]
    fn saves_and_reloads_unchanged() {
        let (_dir, path) = temp_config_path();
        let config = Config {
            network: Some(Network::Mainnet),
            rpc_url: Some("https://example.invalid".into()),
            ..Default::default()
        };
        config.save(&path).unwrap();

        assert_eq!(Config::load(&path).unwrap(), config);
    }

    #[test]
    fn contract_ids_are_tracked_per_network() {
        let mut config = Config::default();
        config.set_contract_id_for(
            Network::Testnet,
            "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3".into(),
        );
        assert!(config.contract_id_for(Network::Testnet).is_some());
        assert!(
            config.contract_id_for(Network::Mainnet).is_none(),
            "a testnet contract must not leak into mainnet"
        );
    }

    #[test]
    fn refuses_to_store_a_secret() {
        let mut config = Config::default();
        let err = config
            .set_field("secret_key", "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X")
            .unwrap_err();
        assert!(err.to_string().contains("not stored in the config"));
        assert!(err.hint().unwrap().contains("STELLARSTREAM_SECRET_KEY"));
    }

    #[test]
    fn rejects_an_unknown_setting_and_lists_the_known_ones() {
        let mut config = Config::default();
        let err = config.set_field("nonsense", "x").unwrap_err();
        assert!(err.hint().unwrap().contains("network"));
    }

    #[test]
    fn rejects_a_malformed_contract_id() {
        let mut config = Config::default();
        assert!(config.set_field("testnet_contract_id", "not-a-contract").is_err());
    }

    #[test]
    fn rejects_an_unknown_output_format() {
        let mut config = Config::default();
        assert!(config.set_field("output", "yaml").is_err());
        assert!(config.set_field("output", "json").is_ok());
    }

    #[test]
    fn a_corrupt_file_explains_how_to_recover() {
        let (_dir, path) = temp_config_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "this is not toml =====").unwrap();
        let err = Config::load(&path).unwrap_err();
        assert!(err.hint().unwrap().contains("delete it"));
    }
}
