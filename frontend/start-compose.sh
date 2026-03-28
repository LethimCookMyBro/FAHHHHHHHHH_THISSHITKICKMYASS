#!/bin/sh
set -eu

LOCKFILE="package-lock.json"
STAMP_FILE="node_modules/.package-lock.sha256"

current_hash="$(sha256sum "$LOCKFILE" | awk '{print $1}')"
cached_hash=""

if [ -f "$STAMP_FILE" ]; then
  cached_hash="$(cat "$STAMP_FILE" 2>/dev/null || true)"
fi

if [ -d "node_modules" ] && [ ! -f "$STAMP_FILE" ] && [ -x "node_modules/.bin/vite" ]; then
  echo "[frontend] node_modules volume already populated; reusing bundled dependencies"
  printf "%s" "$current_hash" > "$STAMP_FILE"
  cached_hash="$current_hash"
fi

if [ ! -d "node_modules" ] || [ ! -x "node_modules/.bin/vite" ] || [ "$cached_hash" != "$current_hash" ]; then
  echo "[frontend] package-lock changed or node_modules missing; running npm ci"
  npm ci --include=dev
  mkdir -p node_modules
  printf "%s" "$current_hash" > "$STAMP_FILE"
else
  echo "[frontend] reusing existing node_modules volume"
fi

echo "[frontend] building current source"
npm run build

echo "[frontend] starting web server"
exec node server.cjs
