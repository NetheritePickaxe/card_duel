@echo off
cd /d "%~dp0"
if "%1"=="--server" (
    if exist "src-tauri\target\release\card-duel.exe" (
        "src-tauri\target\release\card-duel.exe" --server
    ) else (
        cd src-tauri
        cargo build --release
        "src-tauri\target\release\card-duel.exe" --server
    )
) else (
    echo 卡牌对决 Web 版启动中...
    echo 浏览器打开 http://localhost:8787
    start http://localhost:8787
    python -m http.server 8787 -d app
    pause
)