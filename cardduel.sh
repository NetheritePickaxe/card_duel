#!/bin/sh
DIR=$(dirname "$0")
cd "$DIR"
if [ "$1" = "--server" ]; then
    if [ -f "src-tauri/target/release/card-duel" ]; then
        exec src-tauri/target/release/card-duel --server
    else
        cd src-tauri
        cargo build --release
        exec src-tauri/target/release/card-duel --server
    fi
else
    echo "卡牌对决 Web 版启动中..."
    echo "浏览器打开 http://localhost:8787"
    python3 -m http.server 8787 -d app
fi