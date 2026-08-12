@echo off
setlocal
cd /d "%~dp0"
if not exist "card-duel-server.exe" (
    echo Error: card-duel-server.exe not found
    pause
    exit /b 1
)
start "" "card-duel-server.exe" --server
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:8788/
pause
