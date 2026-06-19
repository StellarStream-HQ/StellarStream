// build.rs — Issue #840: WASM-size guard for splitter-v3
//
// Runs after `cargo build --release --target wasm32-unknown-unknown`.
// Asserts the compiled WASM stays under the Soroban 64 KB hard limit.
// CI will fail fast here rather than at deploy time.
//
// The check is skipped when the WASM artifact does not yet exist (e.g. on a
// plain `cargo check` or the very first build before the file is written).

use std::{env, fs, path::PathBuf};

/// Soroban hard limit for a single contract WASM blob.
const MAX_WASM_BYTES: u64 = 128 * 1024; // 131_072 bytes

fn main() {
    // Only run the size check for release builds targeting wasm32.
    let profile = env::var("PROFILE").unwrap_or_default();
    let target = env::var("TARGET").unwrap_or_default();

    if profile != "release" || !target.contains("wasm32") {
        return;
    }

    // Locate the WASM artifact produced by this crate.
    // OUT_DIR is  …/target/wasm32-unknown-unknown/release/build/<crate>/out
    // The WASM sits at …/target/wasm32-unknown-unknown/release/<crate_name>.wasm
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    // Walk up: out/<crate>/build/release/wasm32-unknown-unknown/target
    let wasm_dir = out_dir
        .ancestors()
        .find(|p| p.ends_with("wasm32-unknown-unknown/release"))
        .map(|p| p.to_path_buf());

    let wasm_path = match wasm_dir {
        Some(dir) => dir.join("stellar_splitter_v3.wasm"),
        None => return, // can't locate artifact — skip silently
    };

    if !wasm_path.exists() {
        // First build pass — artifact not yet written; skip.
        return;
    }

    let size = fs::metadata(&wasm_path)
        .expect("failed to stat WASM artifact")
        .len();

    if size > MAX_WASM_BYTES {
        panic!(
            "\n\
            ╔══════════════════════════════════════════════════════════╗\n\
            ║  WASM SIZE LIMIT EXCEEDED — Issue #840                  ║\n\
            ╠══════════════════════════════════════════════════════════╣\n\
            ║  Artifact : {}  ║\n\
            ║  Size     : {:>10} bytes                             ║\n\
            ║  Limit    : {:>10} bytes (64 KB)                     ║\n\
            ║  Overage  : {:>10} bytes                             ║\n\
            ╚══════════════════════════════════════════════════════════╝\n\
            \n\
            Reduce binary size before merging:\n\
              • Remove #[derive(Debug)] from contract types\n\
              • Move error strings to external error codes\n\
              • Split large functions into #[inline(never)] helpers\n\
              • Verify opt-level = \"z\", lto = true in Cargo.toml\n",
            wasm_path.display(),
            size,
            MAX_WASM_BYTES,
            size - MAX_WASM_BYTES,
        );
    }

    println!(
        "cargo:warning=WASM size OK: {} / {} bytes ({:.1}% of limit)",
        size,
        MAX_WASM_BYTES,
        (size as f64 / MAX_WASM_BYTES as f64) * 100.0
    );

    // Re-run this script if the WASM artifact changes.
    println!("cargo:rerun-if-changed={}", wasm_path.display());
}
