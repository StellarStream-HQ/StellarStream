$ErrorActionPreference = 'Continue'
$result = @()

# Find what toolchains are available
$result += "=== rustup toolchain list ==="
$result += (& rustup toolchain list 2>&1)

# Find active toolchain
$result += "=== active toolchain ==="
$result += (& rustup show active-toolchain 2>&1)

# Try building with the msvc toolchain explicitly
$result += "=== cargo build --tests with +stable-msvc ==="
$result += (& cargo +stable-x86_64-pc-windows-msvc build --tests 2>&1)
$result += "BUILD_EXIT:$LASTEXITCODE"

$result | Set-Content -Path "install_result.txt" -Encoding UTF8
