#!/usr/bin/env bash
# Fixes restowner login on the Supabase project:
#   1. email sends a 6-digit CODE ({{ .Token }}), not a magic link
#   2. Site URL points at the deployed app, not localhost
# Run once:  bash fix-auth.sh
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env | head -1 | cut -d= -f2-)
REF=$(grep '^SUPABASE_PROJECT_REF=' .env | head -1 | cut -d= -f2-)

# Code-based email template (no URL -> Supabase sends a plain OTP code).
read -r -d '' TPL <<'HTML' || true
<h2 style="font-family:system-ui,Arial">Votre code de connexion</h2>
<p style="font-family:system-ui,Arial">Saisissez ce code dans restowner&nbsp;:</p>
<p style="font-size:30px;font-weight:700;letter-spacing:8px;font-family:system-ui,Arial">{{ .Token }}</p>
<p style="font-family:system-ui,Arial;color:#888">Ce code expire dans une heure. Si vous n'avez rien demandé, ignorez cet e-mail.</p>
HTML

BODY=$(jq -n --arg tpl "$TPL" '{
  site_url: "https://restowner.pages.dev",
  uri_allow_list: "https://restowner.pages.dev/**,http://localhost:5174/**",
  mailer_subjects_magic_link: "Votre code restowner",
  mailer_templates_magic_link_content: $tpl,
  mailer_templates_confirmation_content: $tpl
}')

echo "Patching auth config for project $REF ..."
RESP=$(curl -sS -X PATCH "https://api.supabase.com/v1/projects/$REF/config/auth" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "$BODY")

echo "$RESP" | jq '{
  site_url,
  magic_link_template_first60: (.mailer_templates_magic_link_content // "" | .[0:60])
}'
echo "Done — request a NEW code in restowner."
