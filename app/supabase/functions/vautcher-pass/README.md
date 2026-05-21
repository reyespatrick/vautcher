# vautcher-pass — Apple Wallet loyalty pass

Generates, signs and live-updates the La Gioconda loyalty card as an
Apple Wallet `.pkpass`.

- `index.ts` — routes: pass download, PassKit web service, push trigger
- `pkpass.ts` — builds + PKCS#7-signs the `.pkpass`
- `apns.ts` — APNs push (mutual-TLS with the Pass Type cert)
- `assets/` — pass images + Apple WWDR G4 intermediate cert

## Deploy

Deploy **without** JWT verification — Apple and Safari send no Supabase
token; the function authenticates each route itself:

```sh
supabase functions deploy vautcher-pass --no-verify-jwt \
  --project-ref yfyfoqrautdogivalimb
```

## Required secrets

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
Set the rest:

```sh
# The signing cert, base64-encoded (the .p12 itself stays out of the repo)
base64 -i secrets/pass-cert.p12 | tr -d '\n' > /tmp/p12.b64

supabase secrets set --project-ref yfyfoqrautdogivalimb \
  PASS_CERT_P12_BASE64="$(cat /tmp/p12.b64)" \
  PASS_CERT_PASSWORD='test' \
  PASS_TYPE_ID='pass.ch.reyes.patrick.vautcher' \
  PASS_TEAM_ID='E3ZZ2H78X4' \
  PASS_AUTH_SECRET='<a long random string>'

rm /tmp/p12.b64
```

`PASS_AUTH_SECRET` keys the per-pass `authenticationToken`. Pick any long
random value; changing it later invalidates already-issued passes.

## Wire the stamp → push trigger

After deploy, point the `vautcher_stamps` trigger (see
`app/supabase/pass-schema.sql`) at this function:

```sql
alter database postgres set app.pass_push_url =
  'https://yfyfoqrautdogivalimb.supabase.co/functions/v1/vautcher-pass/push';
alter database postgres set app.pass_push_key = '<SERVICE_ROLE_KEY>';
```

## Flow

1. Diner taps **Ajouter à Apple Wallet** → `GET /pass/{profileId}` →
   signed `.pkpass` → iOS adds it.
2. iOS registers the device via the PassKit web service routes.
3. restowner scans the pass QR → `vautcher_add_stamp` inserts a stamp.
4. The DB trigger calls `POST /push` → APNs notifies every device →
   Wallet re-fetches `GET /v1/passes/...` → the card shows the new count.
