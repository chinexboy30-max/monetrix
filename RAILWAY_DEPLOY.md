# Railway deployment notes

## Monetrix service configuration
- Connect `chinexboy30-max/monetrix` on `main`; use the repository root as the Root Directory. Do not point this service at a `backend` subdirectory.
- Use the Dockerfile builder and the root `Dockerfile`. Leave Railway's separate build-command override unset: the Dockerfile installs production dependencies with `npm ci --only=production`.
- Use `node server.js` as the start command (also declared by `npm start` and `railway.json`). The server listens on Railway's injected `PORT`; `/healthz` is the health check.
- Express serves the HTML pages, CSS, JavaScript, and `/api` routes from the same origin. This is a single Node/Express service, not a separate static frontend plus Django API.

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
Paystack has approved Monetrix's business and collection model. To enable live checkout, switch to:
- `NODE_ENV=production`
- `PAYMENT_MODE=live`
- `APP_TIMEZONE=Africa/Lagos`
- Matching live `pk_live_...` and `sk_live_...` keys
- `JWT_SECRET` and `ADMIN_TOKEN` (private random values, at least 32 characters each)
- `BASE_URL=https://monetrix-production.up.railway.app`
- `PAYSTACK_CALLBACK_URL=https://monetrix-production.up.railway.app/deposit.html`
- `PAYSTACK_COLLECTION_APPROVED=true`

Register `https://monetrix-production.up.railway.app/api/paystack/webhook` in the Paystack dashboard. If `PAYSTACK_CALLBACK_URL` is unset, it is derived from `BASE_URL`; the callback must resolve to the existing `/deposit.html` page.

The JSON store only supports a single app instance. Ensure the Railway volume is mounted at the app's `data` directory and configure one instance; use a transactional database before scaling horizontally. Payments are verified directly with Paystack and require admin approval before wallet credit.

Deposits use Paystack checkout only, with a ₦100 minimum. Withdrawals are accepted Tuesdays and Thursdays from 9:00 AM (inclusive) until 9:00 PM (exclusive), Africa/Lagos time. User-facing admin announcements and decision messages expire after 24 hours. Administrators must send the bank transfer manually and only then use **Mark paid** in the admin dashboard; Monetrix does not call Paystack transfers.

Run `npm test` and verify `/healthz` before enabling traffic.
