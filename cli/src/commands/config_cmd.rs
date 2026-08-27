//! `stellarstream config` — inspect and edit the config file.

use comfy_table::{presets::UTF8_FULL, Attribute, Cell, ContentArrangement, Table};

use crate::config::Config;
use crate::error::Result;
use crate::output;
use crate::settings::Settings;

/// `stellarstream config show`
///
/// Shows the values actually in effect, not just what is on disk, so it is
/// usable for working out why a command is talking to the wrong network.
pub fn show(settings: &Settings, config: &Config, path: &std::path::Path) -> Result<String> {
    if settings.json {
        return output::to_json(&serde_json::json!({
            "config_file": path.display().to_string(),
            "config_file_exists": path.exists(),
            "network": settings.network.to_string(),
            "rpc_url": settings.rpc_url,
            "contract_id": settings.contract_id,
            "secret_key_env": settings.secret_key_env,
            "output": if settings.json { "json" } else { "table" },
            "stored": config,
        }));
    }

    let mut table = Table::new();
    table
        .load_preset(UTF8_FULL)
        .set_content_arrangement(ContentArrangement::Dynamic);
    table.set_header(vec![
        Cell::new("Setting").add_attribute(Attribute::Bold),
        Cell::new("Value").add_attribute(Attribute::Bold),
    ]);

    let rows = vec![
        ("Config file", path.display().to_string()),
        (
            "Config exists",
            if path.exists() { "yes" } else { "no" }.to_string(),
        ),
        ("Network", settings.network.to_string()),
        ("RPC URL", settings.rpc_url.clone()),
        (
            "Contract ID",
            settings
                .contract_id
                .clone()
                .unwrap_or_else(|| "(not set)".to_string()),
        ),
        ("Secret key from", format!("${}", settings.secret_key_env)),
    ];
    for (key, value) in rows {
        table.add_row(vec![Cell::new(key), Cell::new(value)]);
    }

    Ok(format!(
        "{table}\n\nSecrets are never stored in the config file."
    ))
}

/// `stellarstream config set`
pub fn set(
    key: &str,
    value: &str,
    mut config: Config,
    path: &std::path::Path,
    json: bool,
) -> Result<String> {
    config.set_field(key, value)?;
    config.save(path)?;

    if json {
        return output::to_json(&serde_json::json!({
            "updated": key,
            "value": value,
            "config_file": path.display().to_string(),
        }));
    }
    Ok(format!(
        "{}\n  {} = {}\n  Saved to {}",
        output::success("Configuration updated"),
        key,
        value,
        path.display()
    ))
}

/// `stellarstream config path`
pub fn path(path: &std::path::Path, json: bool) -> Result<String> {
    if json {
        return output::to_json(&serde_json::json!({
            "config_file": path.display().to_string(),
            "exists": path.exists(),
        }));
    }
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::{Overrides, Settings};

    fn settings() -> Settings {
        Settings::resolve(&Overrides::default(), &Config::default(), &|_| None).unwrap()
    }

    #[test]
    fn show_reports_the_effective_values() {
        let rendered = show(
            &settings(),
            &Config::default(),
            std::path::Path::new("/tmp/does-not-exist.toml"),
        )
        .unwrap();
        assert!(rendered.contains("testnet"));
        assert!(rendered.contains("(not set)"), "an unset contract says so");
        assert!(rendered.contains("Secrets are never stored"));
    }

    #[test]
    fn set_writes_the_value_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");

        let message = set("network", "mainnet", Config::default(), &path, false).unwrap();
        assert!(message.contains("mainnet"));

        let reloaded = Config::load(&path).unwrap();
        assert_eq!(reloaded.network, Some(crate::network::Network::Mainnet));
    }

    #[test]
    fn set_refuses_a_secret() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.toml");
        assert!(set("secret_key", "SABC", Config::default(), &path, false).is_err());
        assert!(!path.exists(), "nothing should have been written");
    }
}
