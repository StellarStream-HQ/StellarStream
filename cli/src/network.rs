//! Network selection.

use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

use crate::error::CliError;

pub const TESTNET_RPC: &str = "https://soroban-testnet.stellar.org";
pub const MAINNET_RPC: &str = "https://soroban-rpc.mainnet.stellar.gateway.fm";

pub const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";
pub const MAINNET_PASSPHRASE: &str = "Public Global Stellar Network ; September 2015";

/// Which Stellar network to talk to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Network {
    #[default]
    Testnet,
    Mainnet,
}

impl Network {
    pub fn default_rpc_url(&self) -> &'static str {
        match self {
            Network::Testnet => TESTNET_RPC,
            Network::Mainnet => MAINNET_RPC,
        }
    }

    pub fn passphrase(&self) -> &'static str {
        match self {
            Network::Testnet => TESTNET_PASSPHRASE,
            Network::Mainnet => MAINNET_PASSPHRASE,
        }
    }

    /// Whether operations on this network move real value.
    pub fn is_live(&self) -> bool {
        matches!(self, Network::Mainnet)
    }
}

impl fmt::Display for Network {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Network::Testnet => write!(f, "testnet"),
            Network::Mainnet => write!(f, "mainnet"),
        }
    }
}

impl FromStr for Network {
    type Err = CliError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_lowercase().as_str() {
            "testnet" | "test" => Ok(Network::Testnet),
            "mainnet" | "main" | "public" | "pubnet" => Ok(Network::Mainnet),
            other => Err(CliError::with_hint(
                format!("unknown network '{other}'"),
                "choose testnet or mainnet",
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_network_aliases() {
        assert_eq!("testnet".parse::<Network>().unwrap(), Network::Testnet);
        assert_eq!("TEST".parse::<Network>().unwrap(), Network::Testnet);
        assert_eq!("mainnet".parse::<Network>().unwrap(), Network::Mainnet);
        assert_eq!("public".parse::<Network>().unwrap(), Network::Mainnet);
        assert_eq!("pubnet".parse::<Network>().unwrap(), Network::Mainnet);
    }

    #[test]
    fn rejects_unknown_networks_with_the_valid_choices() {
        let err = "devnet".parse::<Network>().unwrap_err();
        assert!(err.hint().unwrap().contains("testnet"));
    }

    #[test]
    fn each_network_has_its_own_passphrase() {
        assert_ne!(Network::Testnet.passphrase(), Network::Mainnet.passphrase());
        assert!(Network::Mainnet.is_live());
        assert!(!Network::Testnet.is_live());
    }

    #[test]
    fn defaults_to_testnet() {
        assert_eq!(Network::default(), Network::Testnet);
    }
}
