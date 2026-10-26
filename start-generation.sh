#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Install Node.js 22.12 or newer first."; exit 1; }
if [ ! -d node_modules ]; then npm install; fi
npm run dev
