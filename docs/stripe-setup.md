# Stripe setup — vautcher subscriptions

Owner billing for vautcher tenants. Single flat tier, 14-day trial with
no card required up front.

This doc is the checklist you (the human) follow once. The code is
already wired against the env-var names listed below; the only thing
that ties the code to your Stripe account is the values you paste into
those env vars on Supabase.

---

## 1. Pricing model

- **One product** — "vautcher" (or whatever you want to show on the
  invoice).
- **One recurring price** — monthly, CHF.
  Suggested amount: 39 CHF / mois (matches the "abonnement fixe"
  positioning in `docs/argumentaire-commercial.md`).
- **Trial** — 14 days, no card collected. The trial is started by our
  scaffold-tenant edge function (it inserts a `trialing` row with
  `trial_end = now() + 14 days`); Stripe does not see the trial until
  the owner clicks **S'abonner**. On checkout we pass
  `trial_period_days: <days remaining>` so Stripe honours whatever's
  left of the local trial.

---

## 2. Stripe dashboard — one-time setup

Do this **in test mode** first. When everything works, repeat in live
mode and swap the keys.

1. **Create a Stripe account.** https://dashboard.stripe.com/register
   (already done if you have one — skip).
2. **Toggle the dashboard to test mode** (top-right switch).
3. **Create the product.**
   Products → + Add product
   - Name: `vautcher`
   - Description: `Abonnement mensuel à la plateforme vautcher`
4. **Add a recurring price.**
   - Pricing model: Standard pricing
   - Price: `39.00 CHF` (or your number)
   - Billing period: Monthly
   - Save → copy the **Price ID** (looks like `price_1abc...`).
5. **Grab the API keys.**
   Developers → API keys
   - Copy the **Secret key** (`sk_test_...`).
   - Copy the **Publishable key** (`pk_test_...`) — restowner doesn't
     use it today (we never mount Stripe.js client-side; checkout is a
     full redirect to Stripe-hosted Checkout), but worth keeping.
6. **Create the webhook endpoint.**
   Developers → Webhooks → + Add endpoint
   - Endpoint URL: `https://<your-project>.supabase.co/functions/v1/stripe-webhook`
     (replace `<your-project>` with your Supabase project ref).
   - Events to listen to — add these five:
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - Save → copy the **Signing secret** (`whsec_...`).
7. **Enable the Customer Portal.**
   Settings → Billing → Customer portal
   - Turn on "Allow customers to update payment methods" and
     "Allow customers to cancel subscriptions".
   - Save.

---

## 3. Supabase secrets

Set these on the Supabase project so the edge functions can read them:

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_xxx \
  STRIPE_WEBHOOK_SECRET=whsec_xxx \
  STRIPE_PRICE_ID=price_xxx \
  STRIPE_PORTAL_RETURN_URL=https://restowner.pages.dev/abonnement \
  STRIPE_CHECKOUT_SUCCESS_URL=https://restowner.pages.dev/abonnement?status=ok \
  STRIPE_CHECKOUT_CANCEL_URL=https://restowner.pages.dev/abonnement?status=cancel
```

Variables in detail:

| Name | Source | Used by |
|---|---|---|
| `STRIPE_SECRET_KEY` | dashboard API keys | checkout, portal, webhook |
| `STRIPE_WEBHOOK_SECRET` | webhook endpoint signing secret | webhook (verifies the signature) |
| `STRIPE_PRICE_ID` | price you created in step 2.4 | checkout (the line item) |
| `STRIPE_PORTAL_RETURN_URL` | where Stripe Portal sends owners back | portal |
| `STRIPE_CHECKOUT_SUCCESS_URL` | where Stripe Checkout sends after payment | checkout |
| `STRIPE_CHECKOUT_CANCEL_URL` | where Stripe Checkout sends if owner cancels | checkout |

The four URLs should point at the live restowner deployment, not
localhost.

---

## 4. Deploy the edge functions

```bash
supabase functions deploy stripe-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy stripe-portal
```

`stripe-webhook` runs with `--no-verify-jwt` because Stripe calls it
directly; the function verifies the request itself via the Stripe
signature header.

---

## 5. Smoke-test

1. Owner-side: open restowner, scaffold a fresh tenant. You should land
   on the regular dashboard with a "Essai gratuit — 14 jours restants"
   chip on the new **Abonnement** tab.
2. Click **S'abonner**, complete checkout with the Stripe test card
   `4242 4242 4242 4242` (any future expiry, any CVC, any postcode).
3. Back in restowner, the chip should flip to **Actif** within a
   second or two (the webhook fires almost immediately).
4. Diner side: open the tenant's site. Normal app.
5. Stripe dashboard → cancel the subscription. Within a second the
   diner site should swap to the takeover page ("Ce restaurant
   n'utilise plus vautcher") and the restowner Abonnement chip should
   show **Annulé**.

---

## 6. Going live

When you're ready:

1. Repeat steps 2.3–2.7 in **live mode** of the dashboard.
2. `supabase secrets set` the live values (`sk_live_...`, `whsec_...`,
   the new live `price_...`). The webhook endpoint URL stays the same;
   you'll create a new live-mode webhook in the dashboard.
3. Turn on the live API keys and re-deploy the edge functions.

Test-mode subscriptions and live-mode subscriptions live in completely
separate Stripe environments; nothing crosses over.
