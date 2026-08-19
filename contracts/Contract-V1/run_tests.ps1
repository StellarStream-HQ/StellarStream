Set-Location "c:\Github repo\StellarStream\contracts\Contract-V1"
cargo build --tests 2> stderr.txt 1> stdout.txt
$buildExit = $LASTEXITCODE
Add-Content -Path "stderr.txt" -Value "BUILD_EXIT_CODE: $buildExit"
Get-Content stdout.txt
Get-Content stderr.txt
