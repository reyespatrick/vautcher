#!/usr/bin/env bash
# Pushes the CI secrets from .env to the GitHub repo so the Deploy
# workflow (.github/workflows/deploy.yml) can build + deploy.
# Run once, after the repo exists:  bash set-ci-secrets.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

val() { grep "^$1=" .env | head -1 | cut -d= -f2-; }

gh secret set CLOUDFLARE_API_TOKEN  --body "$(val CF_API_TOKEN)"
gh secret set CLOUDFLARE_ACCOUNT_ID --body "$(val CF_ACCOUNT_ID)"
gh secret set SUPABASE_ACCESS_TOKEN --body "$(val SUPABASE_ACCESS_TOKEN)"

echo "✓ CI secrets set on $(gh repo view --json nameWithOwner -q .nameWithOwner)"
