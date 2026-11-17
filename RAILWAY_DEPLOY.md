# Railway deployment notes

The app runs on the existing Node.js/Express backend. Deploy with the repository Dockerfile (or `npm start`) and attach a persistent volume at `/usr/src/app/data` for `data/store.json`. Run one instance only.

## Staging with Paystack test keys
- `NODE_ENV=staging`
- `PAYMENT_MODE=testing`
- `APP_TIMEZONE=Africa/Lagos`
- `PORT` (Railway supplies this)
- `JWT_SECRET=<private random value, at least 32 characters>`
- `ADMIN_TOKEN=<private random value, at least 32 characters>`
- `BASE_URL=https://<your-staging-domain>`
- `PAYSTACK_PUBLIC_KEY=pk_test_...`
- `PAYSTACK_SECRET_KEY=sk_test_...`
- `PAYSTACK_CALLBACK_URL=https://<your-staging-domain>/deposit.html`
- `PAYSTACK_COLLECTION_APPROVED=false`
- `PAYSTACK_WEBHOOK_SECRET` (optional; if omitted, the API secret key is used)

Do not commit `.env` or expose `PAYSTACK_SECRET_KEY` in client code. `PAYSTACK_WEBHOOK_SECRET` can remain blank because Paystack signs webhooks with the API secret key.

After hosting, register this URL in the Paystack dashboard:

`https://<your-staging-domain>/api/paystack/webhook`

Test keys are rejected when `NODE_ENV=production`. Hosted staging uses `NODE_ENV=staging` and HTTPS cookies. Do not treat test transactions as real funds.

## Live collection
Only after Paystack approves Monetrix's business and collection model, switch to:
- `NODE_ENV=production`
- `PAYMENT_MODE=live`
- `APP_TIMEZONE=Africa/Lagos`
- Matching live `pk_live_...` and `sk_live_...` keys
- `JWT_SECRET` and `ADMIN_TOKEN` (private random values, at least 32 characters each)
- `BASE_URL=https://<your-live-domain>`
- `PAYSTACK_CALLBACK_URL=https://<your-live-domain>/deposit.html`
- `PAYSTACK_COLLECTION_APPROVED=true`

Register `https://<your-live-domain>/api/paystack/webhook` in the Paystack dashboard. Always use HTTPS.

The JSON store only supports a single app instance. Ensure the Railway volume is mounted at the app's `data` directory and configure one instance; use a transactional database before scaling horizontally. Payments are verified directly with Paystack and require admin approval before wallet credit.

Deposits use Paystack checkout only, with a ₦100 minimum. Withdrawals are accepted daily from 9:00 AM (inclusive) until 9:00 PM (exclusive), Africa/Lagos time. Administrators must send the bank transfer manually and only then use **Mark paid** in the admin dashboard; Monetrix does not call Paystack transfers.

Run `npm test` and verify `/healthz` before enabling traffic.
