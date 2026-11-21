# MONETRIX INVEST

MONETRIX INVEST is an investment platform frontend backed by the existing lightweight Express server.

## Features
- Responsive fintech UI with MONETRIX INVEST navy, electric blue, and cyan branding
- Registration / login with cookie-based sessions
- Wallet balance, welcome bonus, and investment plans
- Paystack-hosted NGN deposit checkout with server-side verification and signed webhooks
- Deposits of at least ₦100 use Paystack checkout only and remain pending until an administrator approves a verified payment
- Withdrawals are available Tuesdays and Thursdays from 9:00 AM inclusive to 9:00 PM exclusive Africa/Lagos time and are paid manually by an administrator
- Administrator announcements and decision messages expire from the user inbox after 24 hours
- Active investment plan support with server-managed 24-hour countdown payout logic
- ₦50 server-side daily login reward, credited once per business day
- 10% reward on a referee's first approved deposit
- Data persisted in a local JSON database at `data/store.json`

## Run locally
1. Install Node.js
2. Copy `.env.example` to `.env` and set persistent random `JWT_SECRET` and `ADMIN_TOKEN` values. Each must be at least 32 characters for production.
3. In the project root:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:3000`

## Backend
- Server entry: `server.js`
- JSON data store: `data/store.json` (users, deposits, payments, and transactions)
- API routes under `/api`
- Uses `express`, `cookie-parser`, `cors`, `helmet`, `express-rate-limit`, `bcryptjs`, and `jsonwebtoken`

## Frontend
- HTML pages: `index.html`, `register.html`, `login.html`, `dashboard.html`, `vip.html`, `deposit.html`, `withdraw.html`, `referral.html`, `profile.html`
- JS files in `js/`
- Styles in `css/`
- Reusable components in `components/`

## Paystack setup
1. Copy `.env.example` to `.env` for local work, or set the variables in your hosting provider. Never commit `.env`.
2. Set matching Paystack **test** keys in `PAYSTACK_PUBLIC_KEY` and `PAYSTACK_SECRET_KEY`.
3. Use `PAYSTACK_CALLBACK_URL=http://localhost:3000/deposit.html` locally. Production uses `https://monetrix-production.up.railway.app/deposit.html`; if unset, the server derives it from `BASE_URL`.
4. Run `npm test` for the mocked collection and webhook tests, then start with `npm start`.

The backend creates a unique reference and pending payment/deposit/transaction records before requesting hosted checkout. It verifies callback and webhook references directly with Paystack and checks the expected amount and NGN currency. A successful provider payment is not by itself a wallet credit: the existing operations approval flow credits only a server-verified Paystack deposit. Failed, cancelled, mismatched, and legacy bank-transfer deposits cannot be approved. No Paystack transfers or dedicated virtual accounts are implemented. Withdrawals collect verified bank details for administrator review and are paid manually outside Monetrix.

Configure this webhook URL in the Paystack dashboard after hosting:

`https://monetrix-production.up.railway.app/api/paystack/webhook`

The hosted checkout callback is `https://monetrix-production.up.railway.app/deposit.html`; it reads Paystack's returned reference and verifies it through the existing authenticated `/api/paystack/verify` route. The webhook route is `/api/paystack/webhook`.

Paystack signs webhook bodies with the API secret key. Leave `PAYSTACK_WEBHOOK_SECRET` blank to use `PAYSTACK_SECRET_KEY`, or set it to the same secret. Do not expose either secret in frontend code.

For live keys, use `NODE_ENV=production`, HTTPS, `PAYMENT_MODE=live`, matching live public/secret keys, and `PAYSTACK_COLLECTION_APPROVED=true` following Paystack's collection approval. The app refuses live checkout outside production, without the explicit approval flag, or with mismatched/test keys.

Integration references: [Accept Payments](https://paystack.com/docs/payments/accept-payments/), [Verify Payments](https://paystack.com/docs/payments/verify-payments/), and [Webhooks](https://paystack.com/docs/payments/webhooks/).

## Storage and deployment limitations
Payment records, deposits, and wallet updates are persisted together in the existing JSON store using synchronous updates and atomic file replacement. This protects a single running Node process from partial writes, but it does not provide multi-instance database transactions or safe horizontal scaling. Deploy one app instance with persistent storage; migrate to a transactional database before running multiple instances or handling production-scale payment traffic. A verified payment is not automatically credited if the admin review has not completed.
