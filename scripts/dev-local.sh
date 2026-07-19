#!/bin/sh
# Local full-stack dev (M0.4 DX): loads the root .env.local into the web
# app's environment and starts Next on :3000 (override with PORT=…).
# With the PROD Trigger secret key in .env.local, uploads are processed by
# the DEPLOYED cloud worker — no second process needed. To run the worker
# locally instead (dev key): `cd packages/pipeline && pnpm exec trigger dev`
# (one-time `pnpm exec trigger login` first).
set -e
cd "$(dirname "$0")/.."
if [ ! -f .env.local ]; then
  echo "error: .env.local not found at repo root" >&2
  exit 1
fi
set -a; . ./.env.local; set +a
exec pnpm --filter @credexis/web exec next dev --port "${PORT:-3000}"
