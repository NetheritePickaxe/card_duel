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
    echo "CardDuel Web Server (port 8788)"
    echo "Browser: http://localhost:8788"
    echo "Other devices: see IP shown in the menu"
    run
fi