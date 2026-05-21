#!/usr/bin/env bash
# Builds the La Gioconda diner app and deploys it to Cloudflare Pages.
# Both `la-gioconda` and `la-gioconda-restaurant` serve the diner PWA,
# so deploy to both to keep them in sync.
#   bash deploy-app.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

echo "==> Building the diner app"
( cd app && npm run build 2>&1 | tail -4 )

export CLOUDFLARE_API_TOKEN=$(grep '^CF_API_TOKEN=' .env | cut -d= -f2-)
export CLOUDFLARE_ACCOUNT_ID=$(grep '^CF_ACCOUNT_ID=' .env | cut -d= -f2-)

for proj in la-gioconda la-gioconda-restaurant; do
  echo "==> Deploying to $proj"
  ( cd app && npx --yes wrangler@latest pages deploy dist \
      --project-name "$proj" --branch main --commit-dirty=true 2>&1 | tail -4 )
done

echo "Done."
