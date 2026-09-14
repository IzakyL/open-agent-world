#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo "Build the macOS installer on a Mac (or the macOS GitHub Actions runner)." >&2
  exit 1
fi
for tool in uv npm cargo python3; do
  command -v "$tool" >/dev/null || { echo "Missing build prerequisite: $tool" >&2; exit 1; }
done
export UV_CACHE_DIR="$PWD/.uv-cache"
npm --prefix frontend ci --ignore-scripts --no-audit --no-fund
npm --prefix frontend run build
python3 scripts/package-backend.py
npm --prefix desktop ci --ignore-scripts --no-audit --no-fund
(cd desktop && npm run build)
app="$PWD/desktop/src-tauri/target/release/bundle/macos/Open Agent World.app"
# Exercise the installed resource layout, including spaces and relocated Python.
payload="$app/Contents/Resources/payload"
PATH="$payload/tools:$PATH" "$payload/python/bin/python3" -I -B "$payload/launch.py" --self-test
codesign --verify --deep --strict "$app"
echo "Installer: desktop/src-tauri/target/release/bundle/dmg/"
