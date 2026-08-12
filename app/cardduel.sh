#!/bin/sh
DIR=$(dirname "$0")
cd "$DIR"
if [ ! -x "./card-duel-server" ]; then
    echo "Error: card-duel-server not found"
    exit 1
fi
"./card-duel-server" --server &
sleep 3
xdg-open http://127.0.0.1:8788/ 2>/dev/null || open http://127.0.0.1:8788/ 2>/dev/null || echo "Open http://127.0.0.1:8788/"
wait
