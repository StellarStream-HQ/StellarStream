$ErrorActionPreference = 'Continue'
$out = & cargo build --tests 2>&1
$code = $LASTEXITCODE
$out | Set-Content -Path "build_result.txt" -Encoding UTF8
"EXIT:$code" | Add-Content -Path "build_result.txt" -Encoding UTF8
