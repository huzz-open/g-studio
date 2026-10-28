#!/usr/bin/env sh
set -eu
PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$PROJECT_ROOT"
for argument in "$@"; do
  if [ "$argument" = --offline ]; then export GEN_OFFLINE=1; fi
done
case "$(uname -s)" in
  Darwin) platform=darwin ;;
  Linux) platform=linux ;;
  MINGW*|MSYS*|CYGWIN*) platform=win32 ;;
  *) echo "Unsupported system. On Windows, use Git Bash." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU architecture." >&2; exit 1 ;;
esac
RESOURCE_HOME=${GEN_HOME:-"$PROJECT_ROOT/runtime/generation"}
if command -v cygpath >/dev/null 2>&1; then RESOURCE_HOME=$(cygpath -u "$RESOURCE_HOME"); fi
NODE_DIR="$RESOURCE_HOME/platforms/$platform-$arch/node"
NODE="$NODE_DIR/node"
if [ "$platform" = win32 ]; then NODE="$NODE_DIR/node.exe"; fi
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' >/dev/null 2>&1; }
# Use an installed Node in place. Package-manager builds can depend on libraries
# beside their original executable and must never be copied into this project.
if command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE=$(command -v node)
elif [ -f "$NODE" ] && chmod +x "$NODE" && node_ok "$NODE"; then
  :
else
  if [ "${GEN_OFFLINE:-0}" = 1 ]; then echo "Offline: a working bundled Node runtime is missing." >&2; exit 1; fi
  command -v curl >/dev/null 2>&1 || { echo "curl is required for first-time setup." >&2; exit 1; }
  version=22.14.0
  node_platform=$platform
  if [ "$platform" = win32 ]; then node_platform=win; extension=zip; else extension=tar.gz; fi
  name="node-v$version-$node_platform-$arch"
  file="$name.$extension"
  download_dir="$RESOURCE_HOME/downloads"
  mkdir -p "$download_dir" "$NODE_DIR"
  echo "[generation] Preparing Node.js $version in $NODE_DIR"
  curl --fail --location --retry 3 --connect-timeout 20 --max-time 60 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$download_dir/node-SHASUMS256.txt"
  expected=$(awk -v name="$file" '$2==name { print $1 }' "$download_dir/node-SHASUMS256.txt")
  [ -n "$expected" ] || { echo "No published checksum for $file" >&2; exit 1; }
  curl --fail --location --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 30 --continue-at - "https://nodejs.org/dist/v$version/$file" -o "$download_dir/$file.part"
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$download_dir/$file.part" | awk '{print $1}'); else actual=$(shasum -a 256 "$download_dir/$file.part" | awk '{print $1}'); fi
  [ "$actual" = "$expected" ] || { echo "Node checksum mismatch; remove $download_dir/$file.part and retry." >&2; exit 1; }
  if [ "$platform" = win32 ]; then
    archive=$(cygpath -w "$download_dir/$file.part")
    destination=$(cygpath -w "$download_dir")
    # Expand-Archive requires a .zip extension. The public entry point stays sh.
    mv "$download_dir/$file.part" "$download_dir/$file"
    archive=$(cygpath -w "$download_dir/$file")
    powershell.exe -NoProfile -NonInteractive -Command '& { param($a,$d) Expand-Archive -LiteralPath $a -DestinationPath $d -Force }' "$archive" "$destination"
    cp "$download_dir/$name/node.exe" "$NODE"
  else
    tar -xzf "$download_dir/$file.part" -C "$download_dir"
    cp "$download_dir/$name/bin/node" "$NODE"
    chmod +x "$NODE"
  fi
  cp "$download_dir/$name/LICENSE" "$NODE_DIR/LICENSE"
  printf 'v%s' "$version" > "$NODE_DIR/license-version.txt"
  node_ok "$NODE" || { echo "Node runtime could not start on this system." >&2; exit 1; }
fi
if [ "$#" -eq 0 ]; then set -- start; fi
case "$1" in --*) set -- start "$@" ;; esac
# MinTTY exposes MSYS pipes to native Windows programs. Give Node and uv a
# console so uv can draw its native byte progress instead of plain log lines.
# Pipes/redirection must stay non-interactive; never wrap those with winpty.
if [ -t 2 ]; then export GEN_PROGRESS=1; fi
if [ "$platform" = win32 ] && [ -t 0 ] && [ -t 1 ] && [ -t 2 ] && command -v winpty >/dev/null 2>&1; then
  if ! "$NODE" -e 'process.exit(process.stderr.isTTY ? 0 : 1)'; then
    exec winpty "$NODE" "$PROJECT_ROOT/scripts/generation/start.mjs" "$@"
  fi
fi
exec "$NODE" "$PROJECT_ROOT/scripts/generation/start.mjs" "$@"
