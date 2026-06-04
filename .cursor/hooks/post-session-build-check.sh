#!/bin/bash
cd "$(git rev-parse --show-toplevel)" || exit 0

echo "[hook] Running build check (vue-tsc + vite build)..."
pnpm run build 2>&1

exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo '{"additional_context": "Build check FAILED. There are type errors or build errors that need to be fixed before ending the session."}'
else
  echo '{"additional_context": "Build check passed."}'
fi

exit 0
