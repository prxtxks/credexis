#!/bin/sh
# Local pipeline worker (M0.4 DX): runs the Trigger.dev `ingest-document`
# task on THIS machine, in the DEV environment — the same environment the
# web app's dev TRIGGER_SECRET_KEY targets. So `./scripts/dev-local.sh`
# (app) + this (worker) is the whole stack locally, no prod key needed.
#
# Non-interactive auth: writes a CLI profile from TRIGGER_ACCESS_TOKEN
# (the tr_pat_… personal token in .env.local) into a gitignored local
# config dir — no `trigger login` browser flow required.
set -e
cd "$(dirname "$0")/.."
if [ ! -f .env.local ]; then echo "error: .env.local not found" >&2; exit 1; fi
set -a; . ./.env.local; set +a

if [ -z "$TRIGGER_ACCESS_TOKEN" ]; then
  echo "error: TRIGGER_ACCESS_TOKEN (tr_pat_…) missing in .env.local" >&2
  exit 1
fi

# Self-contained CLI auth (gitignored).
CFG_ROOT="$(pwd)/.trigger-local-config"
export XDG_CONFIG_HOME="$CFG_ROOT"
for d in trigger trigger-nodejs; do
  mkdir -p "$CFG_ROOT/$d"
  printf '{"version":2,"currentProfile":"default","profiles":{"default":{"accessToken":"%s","apiUrl":"https://api.trigger.dev"}}}' \
    "$TRIGGER_ACCESS_TOKEN" > "$CFG_ROOT/$d/config.json"
done

# The worker needs Supabase (service role — worker-side only) + the
# classifier key; mirror SUPABASE_URL under the name the task reads.
export SUPABASE_URL="${SUPABASE_URL:-$NEXT_PUBLIC_SUPABASE_URL}"

echo "Starting local ingest worker (dev env). Leave this running; Ctrl-C to stop."
cd packages/pipeline
exec pnpm exec trigger dev
