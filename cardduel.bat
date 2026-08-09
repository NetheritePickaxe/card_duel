@echo off
cd /d "%~dp0"
set "SERVER_EXE=src-tauri\target\release\card-duel-server.exe"

if "%1"=="--server" goto run_server
goto serve_web

:run_server
if not exist "%SERVER_EXE%" goto build
"%SERVER_EXE%"
exit /b

:serve_web
if not exist "%SERVER_EXE%" goto build
echo CardDuel Web Server (port 8788)
echo Browser: http://localhost:8788
echo Other devices: see IP shown in the menu
explorer.exe "http://localhost:8788"
"%SERVER_EXE%"
pause
exit /b

:build
echo First run, building Rust server...
cd src-tauri
cargo build --release --bin card-duel-server
if errorlevel 1 goto build_fail
cd ..
if "%1"=="--server" goto run_server
goto serve_web

:build_fail
echo Build failed, check Rust environment.
pause
exit /b 1