#!/bin/sh
set -e
node /app/node-chatbot/server.js &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null || true' TERM INT EXIT
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
