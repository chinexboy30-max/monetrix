# MONETRIX INVEST

MONETRIX INVEST is an investment platform frontend backed by the existing lightweight Express server.

## Features
- Responsive fintech UI with MONETRIX INVEST navy, electric blue, and cyan branding
- Registration / login with cookie-based sessions
- Wallet balance, welcome bonus, and investment plans
- Paystack-hosted NGN deposit checkout with server-side verification and signed webhooks
- Deposits of at least ₦100 use Paystack checkout only and remain pending until an administrator approves a verified payment
- Withdrawals are available daily from 9:00 AM to 9:00 PM Africa/Lagos time and are paid manually by an administrator
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
3. Use `PAYSTACK_CALLBACK_URL=http://localhost:3000/deposit.html` locally. In production, use the public HTTPS deposit page URL.
4. Run `npm test` for the mocked collection and webhook tests, then start with `npm start`.

The backend creates a unique reference and pending payment/deposit/transaction records before requesting hosted checkout. It verifies callback and webhook references directly with Paystack and checks the expected amount and NGN currency. A successful provider payment is not by itself a wallet credit: the existing operations approval flow credits only a server-verified Paystack deposit. Failed, cancelled, mismatched, and legacy bank-transfer deposits cannot be approved. No Paystack transfers or dedicated virtual accounts are implemented. Withdrawals collect verified bank details for administrator review and are paid manually outside Monetrix.

Configure this webhook URL in the Paystack dashboard after hosting:

`https://<your-deployed-domain>/api/paystack/webhook`

Paystack signs webhook bodies with the API secret key. Leave `PAYSTACK_WEBHOOK_SECRET` blank to use `PAYSTACK_SECRET_KEY`, or set it to the same secret. Do not expose either secret in frontend code.

For live keys, use HTTPS and set `PAYMENT_MODE=live`. Set `PAYSTACK_COLLECTION_APPROVED=true` only after Paystack has approved the business and collection model. The app deliberately refuses live checkout without that confirmation and refuses test keys in production.

Integration references: [Accept Payments](https://paystack.com/docs/payments/accept-payments/), [Verify Payments](https://paystack.com/docs/payments/verify-payments/), and [Webhooks](https://paystack.com/docs/payments/webhooks/).

## Storage and deployment limitations
Payment records, deposits, and wallet updates are persisted together in the existing JSON store using synchronous updates and atomic file replacement. This protects a single running Node process from partial writes, but it does not provide multi-instance database transactions or safe horizontal scaling. Deploy one app instance with persistent storage; migrate to a transactional database before running multiple instances or handling production-scale payment traffic. A verified payment is not automatically credited if the admin review has not completed.
