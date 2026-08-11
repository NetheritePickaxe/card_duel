# Build WASM engine for browser
param(
    [switch]$Release = $true
)

$target = if ($Release) { "release" } else { "debug" }
$profile = if ($Release) { "--release" } else { "" }

Write-Host "Building WASM engine ($target)..."

# Build the wasm crate
Push-Location src-tauri/wasm
cargo build $profile --target wasm32-unknown-unknown --lib
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }

# Generate JS bindings
wasm-bindgen --target web --out-dir "../../app/js" "target/wasm32-unknown-unknown/$target/card_duel_wasm.wasm"
if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
Pop-Location

# Report size
$wasm = Get-Item "app/js/card_duel_wasm_bg.wasm"
$raw = $wasm.Length
$bytes = [System.IO.File]::ReadAllBytes($wasm.FullName)
$ms = New-Object System.IO.MemoryStream
$gz = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Compress)
$gz.Write($bytes, 0, $bytes.Length)
$gz.Close()
$compressed = $ms.ToArray()
Write-Host "OK: $raw bytes raw, $($compressed.Length) bytes gzip"