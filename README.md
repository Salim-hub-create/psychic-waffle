# Invoice Generator

This project is a minimal invoice generator with a Node.js backend that integrates:

- Local storage for invoices and purchases
- Stripe (payments)
- OpenRouter (AI API proxy)

Setup

1. Copy `.env.example` to `.env` and fill in keys.
2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm run dev
```

To test the flow locally

```powershell
cd "c:\Users\USER\Downloads\invoice generator"
npm install
npm run dev
```

Then open `http://localhost:3000` (or your configured origin), create an invoice and click "Purchase Now" to start a Stripe Checkout session. Use Stripe test cards (for example `4242 4242 4242 4242`) in test mode.

Webhook setup and testing

- It's recommended to configure a Stripe webhook for `/api/stripe-webhook` to reliably receive payment events (e.g. `checkout.session.completed`).
- In the Stripe dashboard, add an endpoint pointing to `https://<your-domain>/api/stripe-webhook` and copy the signing secret into `STRIPE_WEBHOOK_SECRET` in your `.env` file.
- For local testing, use the Stripe CLI to forward events:

```powershell
stripe listen --forward-to localhost:3000/api/stripe-webhook
```

Confirm endpoint (no webhook)

- If you opt not to use webhooks, the app uses `/api/confirm-checkout?session_id=...` to verify the session after the user returns from Checkout. This endpoint uses your Stripe secret key to confirm payment and will save a `purchases` record locally on success.

Security notes

- Purchases are saved locally to `data/purchases.json`. Invoices are stored client-side in `localStorage`.
- Webhooks are still supported and are more robust than relying solely on the `success_url` redirect.

