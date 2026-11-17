# MONETRIX INVEST — Railway deployment

## Runtime and persistent storage
- Deploy the existing Node.js/Express app with `npm start` (or the repository Dockerfile).
- Attach a persistent Railway volume at `/usr/src/app/data` so `data/store.json` survives restarts.
- Run a single application instance. The current JSON store is not a multi-instance transactional database.
- Configure a private `JWT_SECRET` and `ADMIN_TOKEN` (each at least 32 characters), plus `BASE_URL=https://<your-deployed-domain>`.
- Serve hosted environments over HTTPS. Use `NODE_ENV=staging` for a test-key staging deployment and `NODE_ENV=production` for live.
- Set `APP_TIMEZONE=Africa/Lagos`; the server enforces the daily withdrawal window from 9:00 AM inclusive to 9:00 PM exclusive in that timezone. Admins send withdrawal transfers manually outside Monetrix, then mark the request paid.

## Paystack test setup (staging)
Set these in Railway Variables. Keep secret values marked private:

- `NODE_ENV=staging`
- `PAYMENT_MODE=testing`
- `APP_TIMEZONE=Africa/Lagos`
- `JWT_SECRET=<private random value, at least 32 characters>`
- `ADMIN_TOKEN=<private random value, at least 32 characters>`
- `BASE_URL=https://<your-deployed-domain>`
- `PAYSTACK_PUBLIC_KEY=pk_test_...`
- `PAYSTACK_SECRET_KEY=sk_test_...`
- `PAYSTACK_CALLBACK_URL=https://<your-deployed-domain>/deposit.html`
- `PAYSTACK_WEBHOOK_SECRET` may be left blank; Paystack signatures use the API secret key.
- `PAYSTACK_COLLECTION_APPROVED=false`

Register this webhook URL in the Paystack dashboard:

`https://<your-deployed-domain>/api/paystack/webhook`

Use Paystack test keys only on a staging deployment. Do not treat test transactions as real funds. The server verifies payment status, amount, and NGN currency; successful deposits remain pending for operations approval before the existing wallet-credit flow runs.

## Live collection
Only after Paystack has approved Monetrix's business and collection model:

1. Replace both test keys with matching live keys.
2. Set `NODE_ENV=production`.
3. Set `PAYMENT_MODE=live` so bank verification cannot use the development mock.
4. Configure private `JWT_SECRET` and `ADMIN_TOKEN` values of at least 32 characters each.
5. Keep `APP_TIMEZONE=Africa/Lagos`.
6. Set `PAYSTACK_COLLECTION_APPROVED=true` only when Paystack has approved Monetrix's live collection model.
7. Keep the callback and webhook URLs on HTTPS and verify the configured webhook delivery.
8. Confirm the deployment uses persistent storage and exactly one app instance.

The secret key must never be exposed in frontend code or committed. `.env` is ignored by Git; configure production secrets in Railway Variables.

## Deployment validation
- Run `npm test` before deployment.
- Check `/healthz` after deployment.
- Register a test user, complete a Paystack test checkout, and verify its server-recorded status in transaction history and the admin queue.
- Confirm wallet credit occurs only after server verification and admin approval.
