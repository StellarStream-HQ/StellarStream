$ErrorActionPreference = 'Continue'
$out = @()
$out += "=== rustup show ==="
$out += (& rustup show 2>&1)
$out += "=== rustup toolchain list ==="
$out += (& rustup toolchain list 2>&1)
$out += "=== cargo version ==="
$out += (& cargo --version 2>&1)
$out += "=== rustc version ==="
$out += (& rustc --version 2>&1)
$out += "=== cat rust-toolchain ==="
if (Test-Path "rust-toolchain.toml") { $out += Get-Content "rust-toolchain.toml" }
elseif (Test-Path "rust-toolchain") { $out += Get-Content "rust-toolchain" }
else { $out += "(no rust-toolchain file here)" }
$out | Set-Content -Path "toolchain_info.txt" -Encoding UTF8
