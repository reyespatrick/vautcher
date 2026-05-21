#!/usr/bin/env bash
# Generates a valid restowner login code WITHOUT sending an email
# (bypasses the built-in email rate limit). Admin-only.
#   bash login-code.sh [email]
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | head -1 | cut -d= -f2-)
REF=$(grep '^SUPABASE_PROJECT_REF=' .env | head -1 | cut -d= -f2-)
URL=$(grep '^SUPABASE_URL=' .env | head -1 | cut -d= -f2-)
EMAIL="${1:-preyes@dpcsolutions.com}"

SKEY=$(curl -sS "https://api.supabase.com/v1/projects/$REF/api-keys?reveal=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '[.[] | select(.name=="service_role")][0].api_key')

RESP=$(curl -sS -X POST "$URL/auth/v1/admin/generate_link" \
  -H "apikey: $SKEY" -H "Authorization: Bearer $SKEY" \
  -H "Content-Type: application/json" \
  --data "$(jq -n --arg e "$EMAIL" '{type:"magiclink", email:$e}')")

OTP=$(echo "$RESP"  | jq -r '.email_otp // .properties.email_otp // empty')
LINK=$(echo "$RESP" | jq -r '.action_link // .properties.action_link // empty')
if [ -n "$OTP" ] || [ -n "$LINK" ]; then
  echo "=================================================="
  echo " restowner login for $EMAIL  (valid ~1h, single use)"
  echo
  echo " TAP-TO-LOGIN LINK (open on the phone — no code needed):"
  echo "   $LINK"
  echo
  echo " ...or type this code on the code screen:"
  echo "   $OTP"
  echo "=================================================="
else
  echo "Could not generate a login. Raw response:"
  echo "$RESP" | jq .
fi
