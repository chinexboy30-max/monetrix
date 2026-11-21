const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');
const { after, before, test } = require('node:test');

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'monetrix-paystack-'));
const secretKey = 'sk_test_monetrix_mock';
const webhookSecret = 'whsec_monetrix_test';
const adminToken = 'test-admin-token';
process.env.MONETRIX_DATA_DIR = dataDirectory;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-with-enough-entropy';
process.env.ADMIN_TOKEN = adminToken;
process.env.PAYSTACK_PUBLIC_KEY = 'pk_test_monetrix_mock';
process.env.PAYSTACK_SECRET_KEY = secretKey;
process.env.PAYSTACK_WEBHOOK_SECRET = webhookSecret;
process.env.PAYSTACK_CALLBACK_URL = 'http://localhost:3000/deposit.html';

const providerTransactions = new Map();
const initializationRequests = [];
const originalHttpsRequest = https.request;
https.request = (url, options, callback) => {
  let requestBody = '';
  const request = new EventEmitter();
  request.write = (chunk) => { requestBody += chunk; };
  request.setTimeout = () => request;
  request.destroy = (error) => {
    if(error) process.nextTick(() => request.emit('error', error));
    return request;
  };
  request.end = () => {
    process.nextTick(() => {
      const requestUrl = new URL(url.toString());
      let responseBody;
      let statusCode = 200;
      if(requestUrl.pathname === '/transaction/initialize'){
        const payload = JSON.parse(requestBody);
        initializationRequests.push(payload);
        providerTransactions.set(payload.reference, {
          reference: payload.reference,
          amount: payload.amount,
          currency: payload.currency,
          status: 'pending',
          channel: 'card',
          gateway_response: 'Mock transaction',
          paid_at: null
        });
        responseBody = {
          status: true,
          data: {
            authorization_url: `https://checkout.paystack.com/${payload.reference}`,
            access_code: 'mock-access-code',
            reference: payload.reference
          }
        };
      }else if(requestUrl.pathname.startsWith('/transaction/verify/')){
        const reference = decodeURIComponent(requestUrl.pathname.slice('/transaction/verify/'.length));
        const transaction = providerTransactions.get(reference);
        if(transaction){
          responseBody = { status: true, data: transaction };
        }else{
          statusCode = 404;
          responseBody = { status: false, message: 'Transaction reference not found' };
        }
      }else{
        statusCode = 404;
        responseBody = { status: false, message: 'Unknown mock endpoint' };
      }

      const response = new EventEmitter();
      response.statusCode = statusCode;
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify(responseBody)));
      response.emit('end');
    });
  };
  return request;
};

const { app, isWithdrawalWindowOpen, getWithdrawalAvailability } = require('../server');
let server;
let origin;
let userCookie;
let userId;
let initialBalance;

async function request(endpoint, { method = 'GET', body, cookie = userCookie, headers = {} } = {}){
  const requestHeaders = { ...headers };
  if(body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if(cookie) requestHeaders.Cookie = cookie;
  const response = await fetch(`${origin}${endpoint}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  return { response, data };
}

async function initializePayment(amount = 5000){
  const result = await request('/api/paystack/initialize', {
    method: 'POST',
    body: { amount }
  });
  assert.equal(result.response.status, 200);
  return result.data;
}

async function adminDeposits(){
  const result = await request('/api/admin/deposits', {
    headers: { 'x-admin-token': adminToken }
  });
  assert.equal(result.response.status, 200);
  return result.data.deposits;
}

async function setProviderStatus(reference, updates){
  const current = providerTransactions.get(reference);
  assert.ok(current, 'mock Paystack transaction should exist');
  providerTransactions.set(reference, { ...current, ...updates });
}

function signWebhook(payload){
  const rawBody = JSON.stringify(payload);
  const signature = crypto.createHmac('sha512', webhookSecret).update(rawBody).digest('hex');
  return { rawBody, signature };
}

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;

  const registration = await request('/api/auth/register', {
    method: 'POST',
    cookie: null,
    body: { fullName: 'Test User', phone: '08000000001', password: 'secure-test-password' }
  });
  assert.equal(registration.response.status, 200);
  userCookie = registration.response.headers.get('set-cookie').split(';')[0];
  userId = registration.data.user.id;
  initialBalance = registration.data.user.balance;
});

after(async () => {
  if(server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  https.request = originalHttpsRequest;
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test('Paystack collection is verified, idempotent, and user-owned', async (t) => {
  await t.test('refuses to start without a persistent JWT secret', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, JWT_SECRET: '' }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /JWT_SECRET must be configured with at least 32 characters/);

    const weakAdminToken = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(serverPath)})`], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'test-jwt-secret-with-enough-entropy', ADMIN_TOKEN: 'weak' }
    });
    assert.notEqual(weakAdminToken.status, 0);
    assert.match(weakAdminToken.stderr, /ADMIN_TOKEN must be configured with at least 32 characters in production/);
  });

  await t.test('enables live checkout only with production, matching live configuration, and approval', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const script = `const { app } = require(${JSON.stringify(serverPath)}); const server = app.listen(0, '127.0.0.1', async () => { try { const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/paystack/config'); console.log(JSON.stringify(await response.json())); } finally { server.close(); } });`;
    const liveEnv = {
      ...process.env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-jwt-secret-with-enough-entropy',
      ADMIN_TOKEN: 'test-admin-token-with-enough-entropy',
      PAYMENT_MODE: 'live',
      PAYSTACK_PUBLIC_KEY: 'pk_live_mock',
      PAYSTACK_SECRET_KEY: 'sk_live_mock',
      PAYSTACK_CALLBACK_URL: 'https://monetrix.example.test/deposit.html',
      BASE_URL: 'https://monetrix.example.test',
      PAYSTACK_COLLECTION_APPROVED: 'true'
    };
    const approved = spawnSync(process.execPath, ['-e', script], { cwd: os.tmpdir(), encoding: 'utf8', env: liveEnv });
    assert.equal(approved.status, 0, approved.stderr);
    const liveConfig = JSON.parse(approved.stdout.trim());
    assert.equal(liveConfig.mode, 'live');
    assert.equal(liveConfig.enabled, true);
    assert.equal(Object.prototype.hasOwnProperty.call(liveConfig, 'secretKey'), false);

    const unapproved = spawnSync(process.execPath, ['-e', script], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      env: { ...liveEnv, PAYSTACK_COLLECTION_APPROVED: 'false' }
    });
    assert.equal(unapproved.status, 0, unapproved.stderr);
    assert.equal(JSON.parse(unapproved.stdout.trim()).enabled, false);
  });

  await t.test('serves public pages while protecting data and admin files', async () => {
    for(const publicPage of ['/', '/index.html', '/register.html', '/login.html', '/dashboard.html', '/vip.html', '/deposit.html', '/withdraw.html', '/referral.html', '/profile.html', '/admin-login.html']){
      const page = await request(publicPage);
      assert.equal(page.response.status, 200, `${publicPage} should load`);
    }

    const depositPage = await request('/deposit.html');
    assert.equal(depositPage.response.status, 200);
    assert.match(depositPage.response.headers.get('content-type'), /text\/html/);
    assert.match(depositPage.data, /id="deposit-email"[^>]*value="monetrixinvesment9@gmail\.com"[^>]*readonly/);
    for(const publicAsset of ['/css/dashboard.css', '/js/deposit.js', '/components/navbar.html', '/assets/logo/logo.jpeg']){
      const asset = await request(publicAsset);
      assert.equal(asset.response.status, 200, `${publicAsset} should be available`);
    }

    for(const privatePath of ['/data/store.json', '/server.js', '/package.json', '/.env']){
      const blocked = await request(privatePath);
      assert.equal(blocked.response.status, 404, `${privatePath} must not be served`);
    }

    const unauthenticatedAdminPage = await request('/admin.html');
    assert.equal(unauthenticatedAdminPage.response.status, 401);
    const authenticatedAdminPage = await request('/admin.html', {
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(authenticatedAdminPage.response.status, 200);
  });

  await t.test('requires authentication and validates whole-naira amounts', async () => {
    const unauthorized = await request('/api/paystack/initialize', {
      method: 'POST',
      cookie: null,
      body: { amount: 5000, email: 'payer@example.test' }
    });
    assert.equal(unauthorized.response.status, 401);

    for(const amount of [500, 999, 99.5, 0, -5000]){
      const invalid = await request('/api/paystack/initialize', {
        method: 'POST',
        body: { amount }
      });
      assert.equal(invalid.response.status, 400, `amount ${amount} should be rejected`);
    }
    const emailOverride = await request('/api/paystack/initialize', {
      method: 'POST',
      body: { amount: 5000, email: 'changed@example.test' }
    });
    assert.equal(emailOverride.response.status, 200);
    assert.equal(initializationRequests.at(-1).email, 'monetrixinvesment9@gmail.com');

    const minimum = await initializePayment(1000);
    assert.equal(minimum.payment.amount, 1000);
    assert.equal(initializationRequests.at(-1).amount, 100000);
    assert.equal(initializationRequests.at(-1).email, 'monetrixinvesment9@gmail.com');
  });

  await t.test('initializes hosted checkout and rejects a different user verifying its reference', async () => {
    const config = await request('/api/paystack/config', { cookie: null });
    assert.equal(config.data.enabled, true);
    assert.equal(config.data.publicKey, 'pk_test_monetrix_mock');
    assert.equal(Object.prototype.hasOwnProperty.call(config.data, 'secretKey'), false);

    const initialized = await initializePayment();
    assert.match(initialized.authorizationUrl, /^https:\/\/checkout\.paystack\.com\//);
    assert.equal(initialized.payment.currency, 'NGN');
    const initPayload = initializationRequests.at(-1);
    assert.equal(initPayload.amount, 500000);
    assert.equal(initPayload.currency, 'NGN');
    assert.equal(initPayload.email, 'monetrixinvesment9@gmail.com');
    assert.equal(initPayload.callback_url, process.env.PAYSTACK_CALLBACK_URL);
    const pendingDeposit = (await adminDeposits()).find((deposit) => deposit.paystackReference === initialized.reference);
    assert.equal(pendingDeposit.email, 'monetrixinvesment9@gmail.com');
    const prematureApproval = await request(`/api/admin/deposits/${pendingDeposit.id}/approve`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(prematureApproval.response.status, 409);

    const unauthenticatedVerify = await request('/api/paystack/verify', {
      method: 'POST',
      cookie: null,
      body: { reference: initialized.reference }
    });
    assert.equal(unauthenticatedVerify.response.status, 401);

    const otherUser = await request('/api/auth/register', {
      method: 'POST',
      cookie: null,
      body: { fullName: 'Other User', phone: '08000000002', password: 'secure-test-password' }
    });
    const otherCookie = otherUser.response.headers.get('set-cookie').split(';')[0];
    const forbidden = await request('/api/paystack/verify', {
      method: 'POST',
      cookie: otherCookie,
      body: { reference: initialized.reference }
    });
    assert.equal(forbidden.response.status, 404);
  });

  await t.test('verifies successful payment once and ignores duplicate signed webhooks', async () => {
    const initialized = await initializePayment(12000);
    await setProviderStatus(initialized.reference, { status: 'success', paid_at: new Date().toISOString() });

    const before = await request('/api/users/me');
    assert.equal(before.data.user.balance, initialBalance);

    const firstCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: initialized.reference }
    });
    const repeatedCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: initialized.reference }
    });
    assert.equal(firstCheck.data.payment.status, 'success');
    assert.equal(repeatedCheck.data.payment.status, 'success');

    const webhook = { event: 'charge.success', data: { reference: initialized.reference } };
    const signed = signWebhook(webhook);
    for(let i = 0; i < 2; i++){
      const delivered = await request('/api/paystack/webhook', {
        method: 'POST',
        cookie: null,
        body: webhook,
        headers: { 'x-paystack-signature': signed.signature }
      });
      assert.equal(delivered.response.status, 200);
    }

    const adminTxs = await request('/api/admin/transactions', {
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(adminTxs.data.transactions.filter((tx) => tx.meta.paystackReference === initialized.reference).length, 1);
    assert.equal(adminTxs.data.transactions.find((tx) => tx.meta.paystackReference === initialized.reference).status, 'verified_pending_approval');
    const matchingDeposit = (await adminDeposits()).find((deposit) => deposit.paystackReference === initialized.reference);
    assert.ok(matchingDeposit);
    assert.equal(matchingDeposit.status, 'pending');

    const stillUncredited = await request('/api/users/me');
    assert.equal(stillUncredited.data.user.balance, initialBalance);
    const approved = await request(`/api/admin/deposits/${matchingDeposit.id}/approve`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(approved.response.status, 200);
    const approvalNotifications = await request('/api/notifications');
    const approvalMessage = approvalNotifications.data.notifications.find((item) => item.title === 'Deposit approved');
    assert.ok(approvalMessage);
    assert.equal(approvalMessage.expiresAt - approvalMessage.createdAt, 24 * 60 * 60 * 1000);
    const duplicateApproval = await request(`/api/admin/deposits/${matchingDeposit.id}/approve`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(duplicateApproval.response.status, 409);
    const credited = await request('/api/users/me');
    assert.equal(credited.data.user.balance, initialBalance + 12000);
  });

  await t.test('rejects invalid and unknown references and invalid webhook signatures', async () => {
    const malformed = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: 'bad' }
    });
    assert.equal(malformed.response.status, 400);
    const unknown = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: `MTX_${'0'.repeat(32)}` }
    });
    assert.equal(unknown.response.status, 404);

    const invalidWebhook = await request('/api/paystack/webhook', {
      method: 'POST',
      cookie: null,
      body: { event: 'charge.success', data: { reference: 'MTX_unknown' } },
      headers: { 'x-paystack-signature': '0'.repeat(128) }
    });
    assert.equal(invalidWebhook.response.status, 401);
  });

  await t.test('records failed and cancelled payments without allowing wallet approval', async () => {
    const failed = await initializePayment();
    await setProviderStatus(failed.reference, { status: 'failed', gateway_response: 'Declined' });
    const failedCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: failed.reference }
    });
    assert.equal(failedCheck.data.payment.status, 'failed');

    const cancelled = await initializePayment();
    await setProviderStatus(cancelled.reference, { status: 'abandoned', gateway_response: 'Abandoned' });
    const cancelledCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: cancelled.reference }
    });
    assert.equal(cancelledCheck.data.payment.status, 'cancelled');

    for(const reference of [failed.reference, cancelled.reference]){
      const deposit = (await adminDeposits()).find((item) => item.paystackReference === reference);
      const approval = await request(`/api/admin/deposits/${deposit.id}/approve`, {
        method: 'POST',
        headers: { 'x-admin-token': adminToken }
      });
      assert.equal(approval.response.status, 409);
    }
    const account = await request('/api/users/me');
    assert.equal(account.data.user.balance, initialBalance + 12000);
  });

  await t.test('holds successful payments with amount or currency mismatches for review', async () => {
    const wrongAmount = await initializePayment(5000);
    await setProviderStatus(wrongAmount.reference, { status: 'success', amount: 999999 });
    const amountCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: wrongAmount.reference }
    });
    assert.equal(amountCheck.data.payment.status, 'needs_review');

    const wrongCurrency = await initializePayment(5000);
    await setProviderStatus(wrongCurrency.reference, { status: 'success', currency: 'USD' });
    const currencyCheck = await request('/api/paystack/verify', {
      method: 'POST',
      body: { reference: wrongCurrency.reference }
    });
    assert.equal(currencyCheck.data.payment.status, 'needs_review');

    for(const reference of [wrongAmount.reference, wrongCurrency.reference]){
      const deposit = (await adminDeposits()).find((item) => item.paystackReference === reference);
      assert.equal(deposit.status, 'needs_review');
      const approval = await request(`/api/admin/deposits/${deposit.id}/approve`, {
        method: 'POST',
        headers: { 'x-admin-token': adminToken }
      });
      assert.equal(approval.response.status, 409);
    }
  });

  await t.test('accepts withdrawals only from 9 AM up to 9 PM Africa/Lagos time', async () => {
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-07T06:59:59Z')), false);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-07T08:00:00Z')), true);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-07T19:59:59Z')), true);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-07T20:00:00Z')), false);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-08T08:00:00Z')), false);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-09T07:59:59Z')), false);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-09T08:00:00Z')), true);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-09T19:59:59Z')), true);
    assert.equal(isWithdrawalWindowOpen(Date.parse('2025-01-09T20:00:00Z')), false);

    const closedSchedule = getWithdrawalAvailability(Date.parse('2025-01-08T08:00:00Z'));
    assert.equal(closedSchedule.available, false);
    assert.equal(closedSchedule.nextOpenAt, Date.parse('2025-01-09T08:00:00Z'));
    assert.match(closedSchedule.message, /next open/i);

    const availability = await request('/api/withdrawals/availability');
    assert.equal(availability.response.status, 200);
    assert.equal(availability.data.timezone, 'Africa/Lagos');
    assert.equal(typeof availability.data.available, 'boolean');
  });

  await t.test('expires administrator announcements and only explicitly expiring inbox messages', async () => {
    const created = await request('/api/admin/announcements', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: { title: 'Temporary admin update', message: 'This message expires.' }
    });
    assert.equal(created.response.status, 200);
    assert.equal(created.data.announcement.expiresAt - created.data.announcement.createdAt, 24 * 60 * 60 * 1000);
    const activeAnnouncements = await request('/api/announcements');
    assert.ok(activeAnnouncements.data.announcements.some((item) => item.id === created.data.announcement.id));

    const storePath = path.join(dataDirectory, 'store.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const expiredAt = Date.now() - 1;
    const announcement = store.announcements.find((item) => item.id === created.data.announcement.id);
    announcement.createdAt = expiredAt - 24 * 60 * 60 * 1000;
    announcement.expiresAt = expiredAt;
    store.notifications.push(
      { id: 'expired-admin-message', userId, title: 'Expired admin message', text: 'Expired', createdAt: expiredAt - 24 * 60 * 60 * 1000, expiresAt: expiredAt },
      { id: 'legacy-expired-admin-message', userId, title: 'Deposit rejected', text: 'Legacy expired', createdAt: expiredAt - 25 * 60 * 60 * 1000 },
      { id: 'persistent-activity', userId, title: 'Account activity', text: 'Keep this', createdAt: expiredAt }
    );
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

    const hiddenAnnouncements = await request('/api/announcements');
    assert.ok(!hiddenAnnouncements.data.announcements.some((item) => item.id === created.data.announcement.id));
    const refreshedAnnouncements = await request('/api/announcements');
    assert.ok(!refreshedAnnouncements.data.announcements.some((item) => item.id === created.data.announcement.id));
    const adminHistory = await request('/api/admin/announcements', { headers: { 'x-admin-token': adminToken } });
    assert.ok(adminHistory.data.announcements.some((item) => item.id === created.data.announcement.id));

    const inbox = await request('/api/notifications');
    assert.ok(!inbox.data.notifications.some((item) => item.id === 'expired-admin-message'));
    assert.ok(!inbox.data.notifications.some((item) => item.id === 'legacy-expired-admin-message'));
    assert.ok(inbox.data.notifications.some((item) => item.id === 'persistent-activity'));
    const refreshedInbox = await request('/api/notifications');
    assert.ok(!refreshedInbox.data.notifications.some((item) => item.id === 'expired-admin-message'));
  });

  await t.test('rejects legacy bank deposits and records manual withdrawal payout once', async () => {
    const directDeposit = await request('/api/deposits', {
      method: 'POST',
      body: { amount: 100, transactionReference: 'legacy-bank-transfer' }
    });
    assert.equal(directDeposit.response.status, 410);
    const directAccount = await request('/api/deposit-account');
    assert.equal(directAccount.response.status, 410);

    const storePath = path.join(dataDirectory, 'store.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    store.deposits.push({
      id: 'legacy-bank-deposit',
      userId,
      amount: 100,
      status: 'pending',
      transactionReference: 'legacy-bank-transfer'
    });
    store.users.find((user) => user.id === userId).activePlan = { id: 13, name: 'Starter' };
    store.withdrawals.push({
      id: 'manual-payout-test',
      userId,
      userName: 'Test User',
      userPhone: '08000000001',
      amount: 1000,
      bankName: 'Test Bank',
      bankCode: '000',
      accountNumber: '0123456789',
      accountName: 'Test User',
      status: 'pending',
      statusHistory: [{ status: 'pending', at: Date.now() }],
      createdAt: Date.now()
    });
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
    const balanceBefore = (await request('/api/users/me')).data.user.balance;

    const legacyApproval = await request('/api/admin/deposits/legacy-bank-deposit/approve', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(legacyApproval.response.status, 409);

    const adminQueue = await request('/api/admin/withdrawals', {
      headers: { 'x-admin-token': adminToken }
    });
    const queuedWithdrawal = adminQueue.data.withdrawals.find((item) => item.id === 'manual-payout-test');
    assert.equal(queuedWithdrawal.bankName, 'Test Bank');
    assert.equal(queuedWithdrawal.bankCode, '000');
    assert.equal(queuedWithdrawal.accountNumber, '0123456789');
    assert.equal(queuedWithdrawal.accountName, 'Test User');

    const forbiddenMarkPaid = await request('/api/admin/withdrawals/manual-payout-test/mark-paid', {
      method: 'POST',
      cookie: null
    });
    assert.equal(forbiddenMarkPaid.response.status, 401);

    const paid = await request('/api/admin/withdrawals/manual-payout-test/mark-paid', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(paid.response.status, 200);
    assert.equal(paid.data.withdrawal.status, 'paid');
    assert.equal(paid.data.withdrawal.payoutMethod, 'manual_bank_transfer');
    const duplicate = await request('/api/admin/withdrawals/manual-payout-test/mark-paid', {
      method: 'POST',
      headers: { 'x-admin-token': adminToken }
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal((await request('/api/users/me')).data.user.balance, balanceBefore - 1000);
  });

  assert.ok(userId);
});

test('enforces withdrawal minimum and expires pending deposits after 24 hours', async () => {
  const tooSmall = await request('/api/withdrawals', {
    method: 'POST',
    body: { amount: 2999, bankName: 'Test Bank', accountNumber: '0123456789' }
  });
  assert.equal(tooSmall.response.status, 400);
  assert.match(tooSmall.data.message, /₦3,000/);

  const initialized = await initializePayment(5000);
  const deposit = (await adminDeposits()).find((item) => item.paystackReference === initialized.payment.reference);
  assert.ok(deposit);

  const storePath = path.join(dataDirectory, 'store.json');
  const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  const expiredAt = Date.now() - 24 * 60 * 60 * 1000 - 1;
  const storedDeposit = store.deposits.find((item) => item.id === deposit.id);
  storedDeposit.createdAt = expiredAt;
  storedDeposit.submittedAt = expiredAt;
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));

  const remainingDeposits = await adminDeposits();
  assert.ok(!remainingDeposits.some((item) => item.id === deposit.id));
  const updatedStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(updatedStore.payments.find((item) => item.id === deposit.paymentId).status, 'expired');
  assert.equal(updatedStore.transactions.find((item) => item.meta && item.meta.depositId === deposit.id).status, 'expired');
});

test('allows an authenticated administrator to delete a user and their account records', async () => {
  const unauthorized = await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    cookie: null
  });
  assert.equal(unauthorized.response.status, 401);

  const removed = await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { 'x-admin-token': adminToken }
  });
  assert.equal(removed.response.status, 200);
  assert.equal(removed.data.userId, userId);

  const users = await request('/api/admin/users', { headers: { 'x-admin-token': adminToken } });
  assert.ok(!users.data.users.some((user) => user.id === userId));

  const store = JSON.parse(fs.readFileSync(path.join(dataDirectory, 'store.json'), 'utf8'));
  for(const collection of ['deposits', 'payments', 'withdrawals', 'transactions', 'verifications', 'notifications']){
    assert.ok(store[collection].every((item) => item.userId !== userId), `${collection} should not retain deleted user records`);
  }
  assert.ok(store.auditLogs.some((entry) => entry.action === 'delete_user' && entry.details.userId === userId));
});
