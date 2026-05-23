#!/usr/bin/env bash
# Deploys the diner app for a specific tenant. Given a slug, reads the
# restaurant's identity + config from vautcher_restaurants, fetches its
# logo, builds the app with per-tenant env vars, and publishes it to
# <slug>.pages.dev.
#
# Usage:   bash deploy-tenant.sh <slug>
# Needs:   jq, npm, curl
#          CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment
#          (the workflow injects these; locally they live in .env).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLUG="${1:-}"
[ -z "$SLUG" ] && { echo "usage: $0 <slug>" >&2; exit 1; }

# Load .env if running locally and CF creds aren't already set.
if [ -f "$HERE/.env" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  set -a; . "$HERE/.env"; set +a
fi
# The repo .env uses CF_* (matches the existing deploy-*.sh scripts);
# wrangler reads CLOUDFLARE_* — bridge them so either works.
: "${CLOUDFLARE_API_TOKEN:=${CF_API_TOKEN:-}}"
: "${CLOUDFLARE_ACCOUNT_ID:=${CF_ACCOUNT_ID:-}}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

SUPA_URL="${VITE_SUPABASE_URL:-https://yfyfoqrautdogivalimb.supabase.co}"
ANON="${VITE_SUPABASE_ANON_KEY:-sb_publishable_CucZIIP9fzY-AN5ChPQGlQ_vWfmeTAR}"

echo "→ fetching restaurant config for slug=$SLUG"
ROW=$(curl -sS "$SUPA_URL/rest/v1/vautcher_restaurants?slug=eq.$SLUG&select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON")

RID=$(echo "$ROW" | jq -r '.[0].id // empty')
[ -z "$RID" ] && { echo "no restaurant found for slug=$SLUG" >&2; exit 1; }

NAME=$(echo "$ROW" | jq -r '.[0].name')
CFG=$(echo "$ROW" | jq '.[0].config')

PWA_NAME=$(echo "$CFG" | jq -r '.pwa_name // empty')
[ -z "$PWA_NAME" ] && PWA_NAME="$NAME"
PWA_SHORT=$(echo "$CFG" | jq -r '.pwa_short_name // empty')
[ -z "$PWA_SHORT" ] && PWA_SHORT="$NAME"
PWA_DESC=$(echo "$CFG" | jq -r '.pwa_description // empty')
THEME=$(echo "$CFG" | jq -r '.theme_color // "#9e053d"')
LOGO=$(echo "$CFG" | jq -r '.logo_url // empty')

echo "  ✓ $NAME ($RID)"
echo "  pwa: $PWA_NAME — theme $THEME"

# If the logo is an external URL, fetch it into the build so the PWA's
# install icon matches the tenant. Local paths (/assets/…) are taken as-is
# from app/public/.
if [[ "$LOGO" =~ ^https?:// ]]; then
  echo "→ downloading logo $LOGO"
  curl -sS -L -o "$HERE/app/public/assets/logo.jpg" "$LOGO"
fi

# Bake the row into the bundle so the first paint shows the tenant's
# identity immediately, no La-Gioconda fallback flash.
echo "→ baking config into app/src/data/baked.json"
echo "$ROW" | jq '.[0]' > "$HERE/app/src/data/baked.json"

echo "→ building app/ for $SLUG"
( cd "$HERE/app" && \
  VITE_RESTAURANT_ID="$RID" \
  VITE_SUPABASE_URL="$SUPA_URL" \
  VITE_SUPABASE_ANON_KEY="$ANON" \
  VITE_PWA_NAME="$PWA_NAME" \
  VITE_PWA_SHORT_NAME="$PWA_SHORT" \
  VITE_PWA_DESCRIPTION="$PWA_DESC" \
  VITE_THEME_COLOR="$THEME" \
  npm run build )

echo "→ deploying app/dist → $SLUG.pages.dev"
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"

# wrangler no longer auto-creates Pages projects on first deploy — do
# it here, idempotently (ignore "already exists").
( cd "$HERE" && \
  npx --yes wrangler pages project create "$SLUG" --production-branch=main 2>/dev/null || true )

( cd "$HERE" && \
  npx --yes wrangler pages deploy app/dist \
    --project-name="$SLUG" \
    --branch=main \
    --commit-dirty=true )

echo "  ✓ https://$SLUG.pages.dev"

# Restore the local working tree — don't leave baked.json dirty.
git -C "$HERE" checkout HEAD -- app/src/data/baked.json 2>/dev/null || true
