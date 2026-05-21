#!/usr/bin/env bash
# Deploys restowner: applies the storage bucket SQL, builds the app,
# and pushes it to Cloudflare Pages.  Run from the repo root:
#   bash deploy-restowner.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | head -1 | cut -d= -f2-)
REF=$(grep '^SUPABASE_PROJECT_REF=' .env | head -1 | cut -d= -f2-)

echo "==> 1/3  Applying DB migrations (storage + rebate)"
for f in restowner/supabase/storage.sql restowner/supabase/rebate-schema.sql; do
  jq -Rs '{query: .}' "$f" \
    | curl -sS -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data @- \
    | jq -e 'if (type=="object" and has("message")) then error(.message) else true end' >/dev/null
  echo "    $f  ok"
done

echo "==> 2/3  Building restowner"
( cd restowner && npm run build 2>&1 | tail -4 )

echo "==> 3/3  Deploying to Cloudflare Pages"
export CLOUDFLARE_API_TOKEN=$(grep '^CF_API_TOKEN=' .env | cut -d= -f2-)
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CF_ACCOUNT_ID=' .env | cut -d= -f2-)
( cd restowner && npx --yes wrangler@latest pages deploy dist \
    --project-name restowner --branch main --commit-dirty=true 2>&1 | tail -4 )

echo "Done."
