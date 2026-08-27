//! End-to-end tests that run the real `stellarstream` binary.
//!
//! These exercise the shipped executable rather than a library helper, so they
//! prove the wiring — argument parsing, config resolution, error rendering and
//! output formatting — actually works when a user runs the command.

use assert_cmd::Command;
use predicates::str::contains;
use std::path::PathBuf;

/// A valid contract strkey, used only as test data.
const CONTRACT: &str = "CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3";
const ACCOUNT: &str = "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N";

/// The CLI, isolated from the developer's real config and environment.
fn cli(config: &PathBuf) -> Command {
    let mut cmd = Command::cargo_bin("stellarstream").unwrap();
    cmd.arg("--config").arg(config);
    // Never inherit real settings or keys from the machine running the tests.
    for var in [
        "STELLARSTREAM_NETWORK",
        "STELLARSTREAM_CONTRACT_ID",
        "STELLARSTREAM_RPC_URL",
        "STELLARSTREAM_SECRET_KEY",
        "STELLARSTREAM_CONFIG",
    ] {
        cmd.env_remove(var);
    }
    cmd
}

fn temp_config() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.toml");
    (dir, path)
}

#[test]
fn help_lists_every_documented_command() {
    let (_dir, config) = temp_config();
    cli(&config)
        .arg("--help")
        .assert()
        .success()
        .stdout(contains("create"))
        .stdout(contains("withdraw"))
        .stdout(contains("cancel"))
        .stdout(contains("query"))
        .stdout(contains("list"))
        .stdout(contains("admin"))
        .stdout(contains("config"));
}

#[test]
fn admin_help_lists_the_admin_commands() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["admin", "--help"])
        .assert()
        .success()
        .stdout(contains("grant-role"))
        .stdout(contains("set-fee"));
}

#[test]
fn version_is_reported() {
    let (_dir, config) = temp_config();
    cli(&config)
        .arg("--version")
        .assert()
        .success()
        .stdout(contains(env!("CARGO_PKG_VERSION")));
}

#[test]
fn config_round_trips_through_the_real_binary() {
    let (_dir, config) = temp_config();

    // Nothing written yet.
    cli(&config)
        .args(["config", "show"])
        .assert()
        .success()
        .stdout(contains("testnet"))
        .stdout(contains("(not set)"));

    // Write two settings.
    cli(&config)
        .args(["config", "set", "network", "mainnet"])
        .assert()
        .success()
        .stdout(contains("Configuration updated"));

    cli(&config)
        .args(["config", "set", "mainnet_contract_id", CONTRACT])
        .assert()
        .success();

    // They are now in effect.
    cli(&config)
        .args(["config", "show"])
        .assert()
        .success()
        .stdout(contains("mainnet"))
        .stdout(contains(CONTRACT));
}

#[test]
fn config_show_emits_valid_json() {
    let (_dir, config) = temp_config();
    let output = cli(&config)
        .args(["config", "show", "--json"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();

    let parsed: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(parsed["network"], "testnet");
    assert!(parsed["contract_id"].is_null());
}

#[test]
fn config_path_prints_the_file_it_is_using() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "path"])
        .assert()
        .success()
        .stdout(contains(config.file_name().unwrap().to_str().unwrap()));
}

#[test]
fn the_config_file_refuses_to_hold_a_secret() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "set", "secret_key", "SADQOBYHA4DQ"])
        .assert()
        .failure()
        .stderr(contains("not stored in the config"))
        .stderr(contains("STELLARSTREAM_SECRET_KEY"));

    assert!(!config.exists(), "nothing should have been written");
}

#[test]
fn a_flag_overrides_the_config_file() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "set", "network", "mainnet"])
        .assert()
        .success();

    cli(&config)
        .args(["config", "show", "--network", "testnet", "--json"])
        .assert()
        .success()
        .stdout(contains("\"network\": \"testnet\""));
}

#[test]
fn an_environment_variable_overrides_the_config_file() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "set", "network", "mainnet"])
        .assert()
        .success();

    cli(&config)
        .args(["config", "show", "--json"])
        .env("STELLARSTREAM_NETWORK", "testnet")
        .assert()
        .success()
        .stdout(contains("\"network\": \"testnet\""));
}

#[test]
fn a_missing_contract_id_says_how_to_supply_one() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["query", "--stream-id", "1"])
        .assert()
        .failure()
        .stderr(contains("no contract id configured"))
        .stderr(contains("--contract-id"))
        .stderr(contains("STELLARSTREAM_CONTRACT_ID"));
}

#[test]
fn a_bad_duration_is_rejected_before_any_network_call() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args([
            "create",
            "--contract-id",
            CONTRACT,
            "--sender",
            ACCOUNT,
            "--receiver",
            ACCOUNT,
            "--token",
            CONTRACT,
            "--amount",
            "1000",
            "--duration",
            "30x",
            // Point at an address nothing is listening on: if validation were
            // deferred, this would fail as a connection error instead.
            "--rpc-url",
            "http://127.0.0.1:1",
        ])
        // Deliberately no signing key: argument validation must happen before
        // the tool asks for a secret.
        .assert()
        .failure()
        .stderr(contains("not a valid duration"))
        .stderr(contains("30d, 12h"));
}

#[test]
fn a_bad_address_is_rejected_with_a_reason() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["list", "--user", "not-an-address", "--contract-id", CONTRACT])
        .assert()
        .failure()
        .stderr(contains("not a valid address"));
}

#[test]
fn an_unknown_network_lists_the_valid_choices() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "show", "--network", "devnet"])
        .assert()
        .failure()
        .stderr(contains("devnet"));
}

#[test]
fn an_unknown_setting_lists_the_known_ones() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args(["config", "set", "nonsense", "value"])
        .assert()
        .failure()
        .stderr(contains("unknown setting"))
        .stderr(contains("rpc_url"));
}

#[test]
fn a_fee_above_the_contract_cap_is_rejected_locally() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args([
            "admin",
            "set-fee",
            "--bps",
            "5000",
            "--contract-id",
            CONTRACT,
            "--yes",
            "--rpc-url",
            "http://127.0.0.1:1",
        ])
        // No signing key: the cap check must fire first.
        .assert()
        .failure()
        .stderr(contains("above the contract's cap"))
        .stderr(contains("1000 bps"));
}

#[test]
fn a_malformed_secret_key_is_an_error_not_a_crash() {
    let (_dir, config) = temp_config();
    let assert = cli(&config)
        .args([
            "withdraw",
            "--stream-id",
            "1",
            "--contract-id",
            CONTRACT,
            "--rpc-url",
            "http://127.0.0.1:1",
        ])
        .env("STELLARSTREAM_SECRET_KEY", "SNOTAREALKEY")
        .assert()
        .failure();

    let stderr = String::from_utf8_lossy(&assert.get_output().stderr).to_string();
    assert!(
        stderr.contains("could not be parsed"),
        "expected a readable error, got: {stderr}"
    );
    assert!(
        !stderr.contains("panicked"),
        "a bad key must not panic: {stderr}"
    );
}

#[test]
fn a_public_key_offered_as_a_signing_key_is_rejected() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args([
            "withdraw",
            "--stream-id",
            "1",
            "--contract-id",
            CONTRACT,
            "--rpc-url",
            "http://127.0.0.1:1",
        ])
        .env("STELLARSTREAM_SECRET_KEY", ACCOUNT)
        .assert()
        .failure()
        .stderr(contains("cannot sign"));
}

#[test]
fn cancel_refuses_to_assume_confirmation_without_a_terminal() {
    let (_dir, config) = temp_config();
    cli(&config)
        .args([
            "cancel",
            "--stream-id",
            "1",
            "--contract-id",
            CONTRACT,
            "--rpc-url",
            "http://127.0.0.1:1",
        ])
        .env("STELLARSTREAM_SECRET_KEY", "SADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP54X")
        .assert()
        .failure()
        .stderr(contains("--yes"));
}
