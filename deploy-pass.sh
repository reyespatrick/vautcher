#!/usr/bin/env bash
# ============================================================
#  Apple Wallet pass — one-shot deployment
#
#  Run once, from the project root:   bash deploy-pass.sh
#
#  Against the live Supabase project, it:
#    1. applies app/supabase/pass-schema.sql (registration table + trigger)
#    2. deploys the `vautcher-pass` edge function
#    3. sets the function secrets (signing cert, password, ids)
#    4. points the stamp->push trigger at the deployed function
#
#  Everything it needs is read from .env — nothing is hard-coded here.
# ============================================================
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

envval () { grep "^$1=" .env | head -1 | cut -d= -f2-; }

TOKEN=$(envval SUPABASE_ACCESS_TOKEN)
REF=$(envval SUPABASE_PROJECT_REF)
URL=$(envval SUPABASE_URL)
P_TYPE=$(envval PASS_TYPE_ID)
P_TEAM=$(envval PASS_TEAM_ID)
P_PWD=$(envval PASS_CERT_PASSWORD)
P_AUTH=$(envval PASS_AUTH_SECRET)
export SUPABASE_ACCESS_TOKEN="$TOKEN"

API="https://api.supabase.com/v1/projects/$REF"

run_sql () {  # $1 = SQL text
  jq -Rs '{query: .}' <<<"$1" \
    | curl -sS -X POST "$API/database/query" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        --data @- \
    | jq -e 'if type=="object" and has("message") then error(.message) else . end' >/dev/null \
    && echo "    ok"
}

echo "==> 1/4  Applying pass-schema.sql"
run_sql "$(cat app/supabase/pass-schema.sql)"

echo "==> 2/4  Deploying the vautcher-pass edge function"
( cd app && supabase functions deploy vautcher-pass --project-ref "$REF" )

echo "==> 3/4  Setting edge function secrets"
P12_B64=$(base64 -i secrets/pass-cert.p12 | tr -d '\n')
supabase secrets set --project-ref "$REF" \
  PASS_CERT_P12_BASE64="$P12_B64" \
  PASS_CERT_PASSWORD="$P_PWD" \
  PASS_TYPE_ID="$P_TYPE" \
  PASS_TEAM_ID="$P_TEAM" \
  PASS_AUTH_SECRET="$P_AUTH"

echo "==> 4/4  Storing the push-hook token in Vault"
SERVICE_KEY=$(curl -sS "$API/api-keys?reveal=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '[.[] | select(.name=="service_role")][0].api_key')
if [ -z "$SERVICE_KEY" ] || [ "$SERVICE_KEY" = "null" ]; then
  echo "    ! could not read the service_role key automatically — skipping."
  echo "    ! Add it manually in the Supabase SQL Editor:"
  echo "    !   select vault.create_secret('<service-role-key>', 'vautcher_pass_push_key');"
else
  run_sql "do \$\$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'vautcher_pass_push_key';
  if v_id is null then
    perform vault.create_secret('$SERVICE_KEY', 'vautcher_pass_push_key', 'Wallet pass push-hook token');
  else
    perform vault.update_secret(v_id, '$SERVICE_KEY', 'vautcher_pass_push_key', 'Wallet pass push-hook token');
  end if;
end \$\$;"
fi

echo
echo "Done. Test the pass download:"
echo "  $URL/functions/v1/vautcher-pass/pass/<profileId>"
echo "(open that URL on an iPhone in Safari — it should offer to add the pass)"
