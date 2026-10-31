#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$APP_DIR"
NODE_INTERNAL_PORT=${NODE_INTERNAL_PORT:-3100}
export NODE_INTERNAL_PORT
NODE_LOG=/tmp/quanlydoxe-node.log
node "$APP_DIR/node-chatbot/server.js" >"$NODE_LOG" 2>&1 &
NODE_PID=$!
WEB_PID=

cleanup() {
  trap - TERM INT EXIT
  if [ -n "$WEB_PID" ]; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  kill "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

for i in 1 2 3 4 5 6 7 8 9 10; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    cat "$NODE_LOG" >&2 || true
    exit 1
  fi
  if curl --max-time 2 -fsS "http://127.0.0.1:$NODE_INTERNAL_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl --max-time 2 -fsS "http://127.0.0.1:$NODE_INTERNAL_PORT/health" >/dev/null 2>&1; then
  echo "[quanlydoxe] Node chatbot did not become ready" >&2
  cat "$NODE_LOG" >&2 || true
  exit 1
fi

echo "[quanlydoxe] Node chatbot started on 127.0.0.1:$NODE_INTERNAL_PORT"
python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" &
WEB_PID=$!
wait "$WEB_PID"
