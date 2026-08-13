@echo off
set PROFILE=%~1
if "%PROFILE%"=="" set PROFILE=release
echo Building WASM engine (%PROFILE%)...
pushd src-tauri\wasm
cargo build --target wasm32-unknown-unknown --lib --%PROFILE%
if %errorlevel% neq 0 (popd & exit /b 1)
wasm-bindgen --target web --out-dir "..\..\app\js" "target\wasm32-unknown-unknown\%PROFILE%\card_duel_wasm.wasm"
if %errorlevel% neq 0 (popd & exit /b 1)
popd
python -c "import gzip; d=open(r'app\js\card_duel_wasm_bg.wasm','rb').read(); gz=gzip.compress(d); print(f'OK: {len(d)} bytes raw, {len(gz)} bytes gzip')"
