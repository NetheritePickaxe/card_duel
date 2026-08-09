#!/bin/sh
DIR=$(dirname "$0")
cd "$DIR"
BIN=src-tauri/target/release/card-duel-server

run() {
    if [ -f "$BIN" ]; then
        exec "$BIN"
    else
        (cd src-tauri && cargo build --release --bin card-duel-server)
        exec "$BIN"
    fi
}

if [ "$1" = "--server" ]; then
    run
else
    echo "卡牌对决 Web 版启动中（内置 Rust 服务器，端口 8788）"
    echo "浏览器打开 http://localhost:8788"
    echo "其他设备打开 http://<本机IP>:8788（地址显示在主菜单下方）"
    run
fi