# Stripe setup for owner subscriptions

This is the one-time setup you do in the Stripe dashboard before the
`feature/cc-payments` branch can be wired up + merged.

We use **Stripe direct** (not a Merchant of Record), so the platform is
the merchant on record and you handle Swiss VAT registration + invoicing
yourself. Stripe Checkout handles the card capture, Stripe Customer
Portal handles cancel / update card.

## 1 — Create the Stripe account

1. Sign up at https://dashboard.stripe.com — use the same email you
   already use for the project so receipts land in one inbox.
2. Switch the toggle in the top-left to **Test mode** while we wire it
   up. Everything below first happens in test; flip to live mode and
   repeat once we're ready to launch.
3. Settings → Account details → fill the business address (Swiss
   business) and the default statement descriptor (≤ 22 chars, e.g.
   `RESTOWNER`).

## 2 — One product, two prices

1. **Catalog → Products → + Add product**:
   - Name: `Restowner — Abonnement`
   - Description: one-liner ("Console restaurateur + app cliente").
2. On that product, add **two prices**:
   - **Monthly** — recurring, monthly, CHF, e.g. `29.00 CHF / mo`.
   - **Yearly** — recurring, yearly, CHF, e.g. `290.00 CHF / yr`
     (≈ 17% off the monthly equivalent).
3. Copy the two **Price IDs** (`price_…`). They go into env vars.

## 3 — Webhook endpoint

1. **Developers → Webhooks → + Add endpoint**.
2. Endpoint URL:
   `https://yfyfoqrautdogivalimb.supabase.co/functions/v1/stripe-webhook`
3. Events to send (subscription lifecycle + invoices):
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `checkout.session.completed` (so we can attach the customer to the
     restaurant the moment the first payment succeeds)
4. Reveal + copy the **signing secret** (`whsec_…`). Goes into env vars.

## 4 — Customer Portal

1. **Settings → Billing → Customer Portal**.
2. Enable: **Cancel subscriptions**, **Update payment method**,
   **View invoices**.
3. Disable plan switching at first — we'll add a "switch monthly/yearly"
   in-app later.

## 5 — Hand me these values

Drop them into the project `.env` (gitignored) so the deploy workflow can
push them to Supabase as edge-function secrets:

```
STRIPE_SECRET_KEY=sk_test_...        # Stripe → Developers → API keys
STRIPE_WEBHOOK_SECRET=whsec_...      # from §3
STRIPE_PRICE_MONTHLY=price_...       # the monthly Price ID from §2
STRIPE_PRICE_YEARLY=price_...        # the yearly Price ID from §2
STRIPE_PUBLISHABLE_KEY=pk_test_...   # only needed if we later embed Stripe Elements
```

(The publishable key isn't strictly required for the Checkout-redirect
flow — Checkout is hosted by Stripe — but it's handy to have.)

Once those land in `.env`, the next step is to deploy three edge
functions: `stripe-checkout`, `stripe-webhook`, `stripe-portal`. Those
are tracked in tasks #43 (edge functions), #44 (UI + gating), #45
(diner suspended dialog).

## Going live later

Flip the Stripe dashboard from **Test mode** to **Live mode** and repeat
steps 2-4 with the live keys / live IDs. Webhook endpoint URL is the
same. Update `.env` with `sk_live_…` / `whsec_…` and re-run
`bash set-ci-secrets.sh`.
