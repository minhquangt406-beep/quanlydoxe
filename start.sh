#!/bin/sh
set -eu

NODE_LOG=/tmp/quanlydoxe-node.log
node /app/node-chatbot/server.js >"$NODE_LOG" 2>&1 &
NODE_PID=$!

cleanup() {
  kill "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
}
trap cleanup TERM INT EXIT

# Fail fast with a useful log if the Node service cannot start.

# Wait briefly for Node to bind its internal port, then fail with its log if it exits.
for i in 1 2 3 4 5; do
  if ! kill -0 "$NODE_PID" 2>/dev/null; then
    cat "$NODE_LOG" >&2 || true
    exit 1
  fi
  if curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! curl -fsS http://127.0.0.1:3100/health >/dev/null 2>&1; then
  echo "[quanlydoxe] Node chatbot did not become ready" >&2
  cat "$NODE_LOG" >&2 || true
  exit 1
fi

echo "[quanlydoxe] Node chatbot started on 127.0.0.1:3100"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
