const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');

function loadDotEnvFile(){
  const envPath = path.join(__dirname, '.env');
  if(!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for(const line of lines){
    const trimmed = line.trim();
    if(!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if(separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if(key && typeof process.env[key] === 'undefined') process.env[key] = value;
  }
}

loadDotEnvFile();

const DATA_DIR = process.env.MONETRIX_DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
if(Buffer.byteLength(JWT_SECRET, 'utf8') < 32){
  throw new Error('JWT_SECRET must be configured with at least 32 characters. Use a persistent secret from .env locally or your deployment environment.');
}
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET || PAYSTACK_SECRET_KEY;
const PAYSTACK_PREFERRED_BANK = process.env.PAYSTACK_PREFERRED_BANK || 'wema-bank';
const PAYSTACK_COLLECTION_APPROVED = process.env.PAYSTACK_COLLECTION_APPROVED === 'true';
const TOKEN_NAME = 'mx_token';
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
if(process.env.NODE_ENV === 'production' && Buffer.byteLength(ADMIN_TOKEN, 'utf8') < 32){
  throw new Error('ADMIN_TOKEN must be configured with at least 32 characters in production.');
}
const PAYSTACK_API_BASE = 'https://api.paystack.co';
const MIN_DEPOSIT_AMOUNT = 1000;
const PAYSTACK_DEFAULT_EMAIL = 'monetrixinvesment9@gmail.com';
const ADMIN_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;
const LEGACY_ADMIN_NOTIFICATION_TITLES = new Set([
  'Deposit approved',
  'Deposit rejected',
  'Withdrawal paid',
  'Withdrawal rejected'
]);
const DAILY_LOGIN_REWARD = 50;
const REFERRAL_REWARD_RATE = 0.10;
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Lagos';
const WITHDRAWAL_TIMEZONE = 'Africa/Lagos';
const SECURE_COOKIES = ['production', 'staging'].includes(process.env.NODE_ENV);
const USER_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 7 * 24 * 60 * 60 * 1000 };
const ADMIN_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES, maxAge: 24 * 60 * 60 * 1000 };
const DEFAULT_DEPOSIT_ACCOUNTS = process.env.PAYMENT_ACCOUNT_NUMBER ? [{
  id: 'acct-configured',
  bankName: process.env.PAYMENT_BANK_NAME || '',
  accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER,
  accountName: process.env.PAYMENT_ACCOUNT_NAME || '',
  status: 'active',
  createdAt: Date.now()
}] : [];
const VIP_PLANS = [
  { id: 13, tier: 1, name: 'Starter', deposit: 5000, daily: 600 },
  { id: 2, tier: 2, name: 'Core', deposit: 10000, daily: 1300 },
  { id: 3, tier: 3, name: 'Growth', deposit: 30000, daily: 7500 },
  { id: 4, tier: 4, name: 'Accelerate', deposit: 60000, daily: 15000 },
  { id: 5, tier: 5, name: 'Prime', deposit: 100000, daily: 26000 },
  { id: 6, tier: 6, name: 'Summit', deposit: 200000, daily: 55000 },
  { id: 7, tier: 7, name: 'Signature', deposit: 350000, daily: 100000 },
  { id: 8, tier: 8, name: 'Elite', deposit: 500000, daily: 145000 },
  { id: 9, tier: 9, name: 'Prestige', deposit: 750000, daily: 220000 },
  { id: 10, tier: 10, name: 'Executive', deposit: 1000000, daily: 300000 },
  { id: 11, tier: 11, name: 'Legacy', deposit: 2000000, daily: 620000 },
  { id: 12, tier: 12, name: 'Sovereign', deposit: 5000000, daily: 1600000 }
];

function ensureDataFile(){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if(!fs.existsSync(DATA_FILE)){
    const defaultData = {
      users: [],
      withdrawals: [],
      deposits: [],
      transactions: [],
      verifications: [],
      auditLogs: [],
      announcements: [],
      notifications: [],
      depositAccounts: DEFAULT_DEPOSIT_ACCOUNTS,
      depositAccountCursor: 0,
      paymentSettings: {
         mode: process.env.PAYMENT_MODE || 'testing',
         bankName: process.env.PAYMENT_BANK_NAME || null,
         accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER || null,
         accountName: process.env.PAYMENT_ACCOUNT_NAME || null
      }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
  }
}

function normalizeData(data){
  const normalized = data || {};
  normalized.users = normalized.users || [];
  normalized.withdrawals = normalized.withdrawals || [];
  normalized.deposits = normalized.deposits || [];
  normalized.transactions = normalized.transactions || [];
  normalized.payments = normalized.payments || [];
  normalized.verifications = normalized.verifications || [];
  normalized.auditLogs = normalized.auditLogs || [];
  normalized.announcements = normalized.announcements || [];
  normalized.notifications = normalized.notifications || [];
  normalized.depositAccounts = normalized.depositAccounts && normalized.depositAccounts.length ? normalized.depositAccounts : DEFAULT_DEPOSIT_ACCOUNTS;
  if(normalized.depositAccounts && DEFAULT_DEPOSIT_ACCOUNTS[0]){
    const defaultAccountNumber = DEFAULT_DEPOSIT_ACCOUNTS[0].accountNumber;
    if(!normalized.depositAccounts.some(a => a.accountNumber === defaultAccountNumber)){
      normalized.depositAccounts.unshift(DEFAULT_DEPOSIT_ACCOUNTS[0]);
    }
  }
  normalized.depositAccountCursor = Number.isInteger(normalized.depositAccountCursor) ? normalized.depositAccountCursor : 0;
  normalized.paymentSettings = normalized.paymentSettings || {};

  // Backfill referralCode and referralLink for existing users if missing, ensuring uniqueness
  const existingCodes = new Set((normalized.users || []).map(u => String(u.referralCode || '').toLowerCase()).filter(Boolean));
  function genRefCode(){
    return 'MX' + String(Math.floor(Math.random() * 900000 + 100000));
  }
  for(const u of normalized.users){
    if(!u.referralCode){
      let code = genRefCode();
      while(existingCodes.has(code.toLowerCase())) code = genRefCode();
      u.referralCode = code;
      existingCodes.add(code.toLowerCase());
    }
    if(!u.referralLink){
      u.referralLink = (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : '') + `/register.html?ref=${encodeURIComponent(u.referralCode || '')}`;
    }
    // ensure flag exists
    if(typeof u.referralRewardProcessed === 'undefined') u.referralRewardProcessed = false;
    if(u.activePlan){
      const currentPlan = VIP_PLANS.find(plan => plan.id === Number(u.activePlan.id));
      if(currentPlan){
        u.activePlan.name = currentPlan.name;
        u.activePlan.deposit = currentPlan.deposit;
        u.activePlan.daily = currentPlan.daily;
      }
    }
  }

  return normalized;
}

function readData(){
  ensureDataFile();
  const content = fs.readFileSync(DATA_FILE, 'utf8');
  let parsed;
  try{
    parsed = JSON.parse(content);
  }catch(e){
    throw new Error('The application data store contains invalid JSON.', { cause: e });
  }
  return normalizeData(parsed);
}

function writeData(data){
  const temporaryFile = path.join(DATA_DIR, `.store-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
  try{
    fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryFile, DATA_FILE);
  }finally{
    if(fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
  }
}

function updateData(update){
  const data = readData();
  const result = update(data);
  writeData(data);
  return result;
}

function generateToken(user){
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
}

function sanitizeUser(user){
  if(!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function generateReferralCode(userId){
  return String(userId || '').trim();
}

function findUserByReferralCode(data, code){
  if(!code) return null;
  return data.users.find(u => u.referralCode === code || u.id === code || u.phone === code);
}

function generateUniqueDepositReference(data){
  const existing = new Set([
    ...((data.deposits || []).map(d => String(d.transactionReference || '').toUpperCase())),
    ...((data.virtualAccounts || []).map(v => String(v.paymentReference || v.transactionReference || '').toUpperCase()))
  ]);
  let reference;
  do {
    const rnd = Math.floor(Math.random() * 900000) + 100000;
    reference = `MX-${rnd}`;
  } while(existing.has(reference.toUpperCase()));
  return reference;
}

function getNextDepositAccount(data){
  const activeAccounts = (data.depositAccounts || []).filter(account => account.status !== 'disabled');
  if(!activeAccounts.length) return null;
  const selected = activeAccounts[data.depositAccountCursor % activeAccounts.length];
  data.depositAccountCursor = (data.depositAccountCursor + 1) % activeAccounts.length;
  return selected;
}

function assignDepositAccountToUser(data, user){
  if(user.depositAccount && user.depositAccount.accountNumber){
    return user.depositAccount;
  }
  const account = getNextDepositAccount(data);
  if(!account) return null;
  const accountPayload = {
    id: account.id,
    bankName: account.bankName,
    accountNumber: account.accountNumber,
    accountName: account.accountName,
    status: account.status || 'active',
    assignedAt: Date.now()
  };
  user.depositAccount = accountPayload;
  user.assignedDepositAccountId = account.id;
  user.paystackAccount = accountPayload;
  return accountPayload;
}

function createNotification(data, { userId, title, text, type = 'info', expiresAfterMs }){
  const createdAt = Date.now();
  const notification = {
    id: 'notif-' + Date.now(),
    userId,
    title,
    text,
    type,
    createdAt,
    read: false
  };
  if(Number.isFinite(expiresAfterMs) && expiresAfterMs > 0){
    notification.expiresAt = createdAt + expiresAfterMs;
  }
  data.notifications = data.notifications || [];
  data.notifications.push(notification);
  return notification;
}

function paystackRequest(pathname, { method = 'GET', body = null } = {}) {
  if(!PAYSTACK_SECRET_KEY) {
    return Promise.reject(new Error('Paystack secret key is not configured'));
  }

  const payload = body ? JSON.stringify(body) : null;
  const url = new URL(pathname, PAYSTACK_API_BASE);
  const options = {
    method,
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if(data.length > 1024 * 1024) req.destroy(new Error('Paystack response exceeded the size limit'));
      });
      res.on('end', () => {
        let parsed;
        try{
          parsed = data ? JSON.parse(data) : {};
        }catch(error){
          return reject(new Error('Paystack returned an invalid response.', { cause: error }));
        }
        if(res.statusCode >= 400 || parsed.status === false) {
          return reject(new Error(parsed.message || `Paystack request failed with status ${res.statusCode}`));
        }
        resolve(parsed);
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Paystack request timed out')));
    if(payload) req.write(payload);
    req.end();
  });
}

function getPaystackPublicKey(){
  return PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY || '';
}

function getPaystackMode(){
  const publicMode = getPaystackPublicKey().startsWith('pk_test_') ? 'test' : getPaystackPublicKey().startsWith('pk_live_') ? 'live' : null;
  const secretMode = PAYSTACK_SECRET_KEY.startsWith('sk_test_') ? 'test' : PAYSTACK_SECRET_KEY.startsWith('sk_live_') ? 'live' : null;
  return publicMode && publicMode === secretMode ? publicMode : null;
}

function getPaystackCallbackUrl(){
  const configuredUrl = process.env.PAYSTACK_CALLBACK_URL || (
    process.env.BASE_URL
      ? `${process.env.BASE_URL.replace(/\/$/, '')}/deposit.html`
      : process.env.NODE_ENV === 'production'
        ? ''
        : `http://localhost:${process.env.PORT || 3000}/deposit.html`
  );
  if(!configuredUrl) throw new Error('PAYSTACK_CALLBACK_URL must be configured before enabling Paystack checkout.');

  let callbackUrl;
  try{
    callbackUrl = new URL(configuredUrl);
  }catch(error){
    throw new Error('PAYSTACK_CALLBACK_URL must be a valid absolute URL.', { cause: error });
  }
  if(!['http:', 'https:'].includes(callbackUrl.protocol) || callbackUrl.username || callbackUrl.password){
    throw new Error('PAYSTACK_CALLBACK_URL must use HTTP or HTTPS and must not contain credentials.');
  }
  if(callbackUrl.pathname !== '/deposit.html'){
    throw new Error('PAYSTACK_CALLBACK_URL must point to the existing /deposit.html payment callback page.');
  }
  if(SECURE_COOKIES && callbackUrl.protocol !== 'https:'){
    throw new Error('PAYSTACK_CALLBACK_URL must use HTTPS in hosted environments.');
  }
  if(process.env.BASE_URL){
    let appUrl;
    try{
      appUrl = new URL(process.env.BASE_URL);
    }catch(error){
      throw new Error('BASE_URL must be a valid absolute URL when Paystack checkout is enabled.', { cause: error });
    }
    if(SECURE_COOKIES && (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password)){
      throw new Error('BASE_URL must use HTTPS and must not contain credentials in hosted environments.');
    }
    if(appUrl.origin !== callbackUrl.origin){
      throw new Error('PAYSTACK_CALLBACK_URL must use the same domain as BASE_URL.');
    }
  }
  return callbackUrl.toString();
}

function assertPaystackCheckoutEnabled(){
  const mode = getPaystackMode();
  if(!mode) throw new Error('Configure matching Paystack public and secret keys before enabling checkout.');
  if(mode === 'test' && process.env.NODE_ENV === 'production'){
    throw new Error('Paystack test keys cannot be used in production.');
  }
  if(mode === 'live'){
    if(process.env.NODE_ENV !== 'production'){
      throw new Error('Live Paystack checkout can only be enabled in production.');
    }
    if(process.env.PAYMENT_MODE !== 'live'){
      throw new Error('PAYMENT_MODE=live must be configured before enabling live checkout.');
    }
    if(!PAYSTACK_COLLECTION_APPROVED){
      throw new Error('Live Paystack checkout is disabled until collection approval is explicitly confirmed.');
    }
  }
  return { mode, callbackUrl: getPaystackCallbackUrl() };
}

function isValidPaystackSignature(rawBody, signature){
  if(!PAYSTACK_WEBHOOK_SECRET || !Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !/^[a-f0-9]{128}$/i.test(signature)){
    return false;
  }
  const expected = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function compactBankName(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function resolveBankAccountWithPaystack(bankName, accountNumber){
  const bankResponse = await paystackRequest('/bank?country=nigeria&perPage=100');
  const banks = Array.isArray(bankResponse.data) ? bankResponse.data : [];
  const requestedBank = compactBankName(bankName);
  const bank = banks.find((item) => {
    const candidate = compactBankName(item.name);
    return candidate === requestedBank || candidate.includes(requestedBank) || requestedBank.includes(candidate);
  });
  if(!bank) throw new Error('The selected bank is not available for account verification.');

  const resolvedResponse = await paystackRequest(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bank.code)}`);
  const resolved = resolvedResponse.data || {};
  if(!resolved.account_name) throw new Error('The bank account number could not be resolved.');
  return {
    bankName: bank.name,
    bankCode: bank.code,
    accountNumber: String(resolved.account_number || accountNumber),
    accountName: resolved.account_name
  };
}

function applyPayouts(data, user){
  if(!user || !user.activePlan || !user.activePlan.nextPayoutAt) return false;
  let updated = false;
  const now = Date.now();
  while(user.activePlan.nextPayoutAt <= now){
    const amount = Number(user.activePlan.daily || 0);
    user.balance = (user.balance || 0) + amount;
    user.earnings = (user.earnings || 0) + amount;
    recordTransaction(data, {
      userId: user.id,
      type: 'plan_reward',
      amount,
      status: 'completed',
      meta: { planId: user.activePlan.id, planName: user.activePlan.name, description: 'Daily investment plan reward' }
    });
    user.activePlan.nextPayoutAt += 24 * 60 * 60 * 1000;
    updated = true;
  }
  return updated;
}

function getBusinessDate(timestamp = Date.now()){
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE }).format(new Date(timestamp));
}

function getBusinessDateTimeParts(timestamp = Date.now()){
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WITHDRAWAL_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function isWithdrawalWindowOpen(timestamp = Date.now()){
  const parts = getBusinessDateTimeParts(timestamp);
  return ['Tue', 'Thu'].includes(parts.weekday) && Number(parts.hour) >= 9 && Number(parts.hour) < 21;
}

function getNextWithdrawalOpening(timestamp = Date.now()){
  const parts = getBusinessDateTimeParts(timestamp);
  const weekdayNumber = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  const localMinutes = Number(parts.hour) * 60 + Number(parts.minute);
  let dayOffset = null;
  for(let offset = 0; offset <= 7; offset++){
    const weekday = (weekdayNumber + offset) % 7;
    if(![2, 4].includes(weekday)) continue;
    if(offset === 0 && localMinutes >= 9 * 60) continue;
    dayOffset = offset;
    break;
  }
  if(dayOffset === null) throw new Error('Unable to calculate the next withdrawal opening.');

  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + dayOffset, 9));
  const target = {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
    hour: 9
  };
  let candidate = Date.UTC(target.year, target.month - 1, target.day, target.hour);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: WITHDRAWAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  for(let attempt = 0; attempt < 3; attempt++){
    const localParts = Object.fromEntries(formatter.formatToParts(new Date(candidate))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)]));
    const representedLocalTime = Date.UTC(localParts.year, localParts.month - 1, localParts.day, localParts.hour, localParts.minute);
    const adjustment = Date.UTC(target.year, target.month - 1, target.day, target.hour) - representedLocalTime;
    candidate += adjustment;
    if(adjustment === 0) break;
  }
  return candidate;
}

function getWithdrawalAvailability(timestamp = Date.now()){
  const available = isWithdrawalWindowOpen(timestamp);
  const nextOpenAt = getNextWithdrawalOpening(timestamp);
  const nextOpeningText = new Intl.DateTimeFormat('en-NG', {
    timeZone: WITHDRAWAL_TIMEZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(nextOpenAt));
  return {
    available,
    timezone: WITHDRAWAL_TIMEZONE,
    nextOpenAt,
    message: available
      ? 'Withdrawals are open now — Tuesdays and Thursdays, 9 AM – 9 PM.'
      : `Withdrawals are closed. Next opening: ${nextOpeningText}.`
  };
}

function applyDailyLoginReward(data, user){
  if(!user) return false;
  const today = getBusinessDate();
  if(user.lastLoginRewardDate === today) return false;
  user.balance = (user.balance || 0) + DAILY_LOGIN_REWARD;
  user.loginRewards = (user.loginRewards || 0) + DAILY_LOGIN_REWARD;
  user.lastLoginRewardDate = today;
  recordTransaction(data, {
    userId: user.id,
    type: 'daily_login_reward',
    amount: DAILY_LOGIN_REWARD,
    status: 'completed',
    meta: { date: today, description: 'Daily login reward' }
  });
  createNotification(data, {
    userId: user.id,
    title: 'Daily login reward',
    text: `₦${DAILY_LOGIN_REWARD.toLocaleString()} has been added to your wallet for today.`,
    type: 'success'
  });
  return true;
}

function findUserByPhone(data, phone){
  return data.users.find(u => u.phone === phone);
}

function findUserById(data, id){
  return data.users.find(u => u.id === id);
}

function authMiddleware(req, res, next){
  const token = req.cookies[TOKEN_NAME];
  if(!token) return res.status(401).json({ message: 'Authentication required' });
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    const data = readData();
    const user = findUserById(data, payload.id);
    if(!user) return res.status(401).json({ message: 'Invalid authentication token' });
    if(applyPayouts(data, user)) writeData(data);
    req.user = user;
    next();
  }catch(err){
    return res.status(401).json({ message: 'Invalid authentication token' });
  }
}

// Helper: simple admin auth using an admin token header (x-admin-token)
function adminAuthMiddleware(req, res, next){
  // Accept an admin token via header, query parameter, or the secure HTTP-only session cookie.
  const token = req.headers['x-admin-token'] || req.query.adminToken || req.cookies && req.cookies['mx_admin'];
  if(!token || token !== ADMIN_TOKEN) return res.status(401).json({ message: 'Admin authorization required' });
  req.admin = { token: ADMIN_TOKEN };
  next();
}

function getPaymentSettings(){
  const data = readData();
  const ds = data.paymentSettings || {};
  return {
    mode: process.env.PAYMENT_MODE || ds.mode || 'testing',
    bankName: process.env.PAYMENT_BANK_NAME || ds.bankName || null,
    accountNumber: process.env.PAYMENT_ACCOUNT_NUMBER || ds.accountNumber || null,
    accountName: process.env.PAYMENT_ACCOUNT_NAME || ds.accountName || null
  };
}

function recordTransaction(data, { userId, type, amount, status, meta }){
  const tx = { id: 'txn-' + crypto.randomUUID(), userId, type, amount, status: status || 'pending', meta: meta || {}, createdAt: Date.now() };
  data.transactions = data.transactions || [];
  data.transactions.push(tx);
  return tx;
}

function addAuditLog(data, { adminToken, action, details }){
  data.auditLogs = data.auditLogs || [];
  const entry = { id: 'audit-' + Date.now(), adminToken: adminToken || null, action, details: details || {}, at: Date.now() };
  data.auditLogs.push(entry);
  return entry;
}

const app = express();
app.use(helmet());
app.use(express.json({
  limit: '100kb',
  verify(req, res, buffer){
    if(req.path === '/api/paystack/webhook') req.rawBody = Buffer.from(buffer);
  }
}));
app.use(cookieParser());
const allowedOrigins = String(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.use(cors(allowedOrigins.length ? {
  credentials: true,
  origin(origin, callback){
    if(!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
} : { origin: false }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 80, standardHeaders: true, legacyHeaders: false });
app.use('/api', limiter);

app.post('/api/auth/register', (req, res) => {
  const { fullName, phone, password, referralCode } = req.body;
  if(!fullName || !phone || !password) return res.status(400).json({ message: 'Missing required fields' });
  // Reject fake/invalid phone numbers: must be a valid Nigerian number (11 digits starting 0, or +234 format).
  const phoneDigits = String(phone).replace(/[\s\-()]/g, '');
  const normalizedPhone = /^0\d{10}$/.test(phoneDigits) ? phoneDigits
    : /^\+234\d{10}$/.test(phoneDigits) ? '0' + phoneDigits.slice(4)
    : null;
  if(!normalizedPhone) return res.status(400).json({ message: 'Enter a valid Nigerian phone number, e.g. 08012345678' });
  if(String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
  const data = readData();
  if(findUserByPhone(data, normalizedPhone)) return res.status(409).json({ message: 'Phone number already registered' });
  const id = 'user-' + Date.now();
  const referrer = findUserByReferralCode(data, String(referralCode || '').trim());
  const passwordHash = bcrypt.hashSync(password, 10);
  // Generate a unique referral code for the new user.
  function genRef(){ return 'MX' + String(Math.floor(Math.random() * 900000 + 100000)); }
  let newReferralCode = genRef();
  const existingCodes = new Set((data.users || []).map(u => String(u.referralCode || '').toLowerCase()).filter(Boolean));
  while(existingCodes.has(newReferralCode.toLowerCase())) newReferralCode = genRef();
  const user = {
    id,
    fullName,
    phone: normalizedPhone,
    passwordHash,
    balance: 500,
    welcomeBonus: 500,
    earnings: 0,
    referrals: 0,
    refEarnings: 0,
    activePlan: null,
    referralCode: newReferralCode,
    referralLink: (process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') : '') + `/register.html?ref=${encodeURIComponent(newReferralCode)}`
  };
  if(referrer && referrer.id !== id){
    user.referredBy = referrer.id;
    referrer.referrals = (referrer.referrals || 0) + 1;
    createNotification(data, {
      userId: referrer.id,
      title: 'New referral joined',
      text: `${fullName} joined MONETRIX INVEST using your referral link. You will earn rewards after their first approved deposit.`,
      type: 'info'
    });
  }
  assignDepositAccountToUser(data, user);
  data.users.push(user);
  recordTransaction(data, { userId: user.id, type: 'welcome_bonus', amount: 500, status: 'completed', meta: { description: 'Welcome bonus credited on account opening' } });
  createNotification(data, { userId: user.id, title: 'Welcome bonus', text: 'Your account has been created and your welcome bonus has been credited.', type: 'success' });
  writeData(data);
  const token = generateToken(user);
  res.cookie(TOKEN_NAME, token, USER_COOKIE_OPTIONS);
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body;
  if(!phone || !password) return res.status(400).json({ message: 'Phone and password are required' });
  const data = readData();
  const user = findUserByPhone(data, phone);
  if(!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid credentials' });
  const payoutsApplied = applyPayouts(data, user);
  const loginRewardApplied = applyDailyLoginReward(data, user);
  if(payoutsApplied || loginRewardApplied) writeData(data);
  const token = generateToken(user);
  res.cookie(TOKEN_NAME, token, USER_COOKIE_OPTIONS);
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie(TOKEN_NAME, { httpOnly: true, sameSite: 'lax', secure: SECURE_COOKIES });
  res.json({ message: 'Logged out' });
});

app.get('/api/users/me', authMiddleware, (req, res) => {
  const data = readData();
  const user = findUserById(data, req.user.id);
  if(!user) return res.status(404).json({ message: 'User not found' });
  if(applyPayouts(data, user)) writeData(data);
  res.json({ user: sanitizeUser(user) });
});

app.get('/api/vips', (req, res) => {
  res.json({ plans: VIP_PLANS });
});

// Account verification endpoint (uses testing mock or a real provider when configured)
app.post('/api/verify-account', authMiddleware, async (req, res) => {
  const { bankName, accountNumber } = req.body || {};
  if(!bankName) return res.status(400).json({ message: 'Bank selection is required' });
  const normalizedAccountNumber = String(accountNumber || '').trim();
  if(!/^\d{10}$/.test(normalizedAccountNumber)) return res.status(400).json({ message: 'Account number must contain exactly 10 digits' });

  const settings = getPaymentSettings();
  const data = readData();
  const user = findUserById(data, req.user.id);
  const userPhone = String(user?.phone || '').trim();
  if(!user || !userPhone) return res.status(400).json({ message: 'A registered phone number is required before bank verification.' });
  data.verifications = data.verifications || [];

  if((settings.mode || 'testing') === 'testing'){
    // Mock verification for testing mode
    const accountName = 'Test Account ' + normalizedAccountNumber.slice(-4);
    const verification = { id: 'ver-' + crypto.randomUUID(), userId: user.id, userPhone, bankName, requestedBankName: bankName, accountNumber: normalizedAccountNumber, accountName, verificationMode: 'testing', verifiedAt: Date.now(), createdAt: Date.now() };
    data.verifications.push(verification);
    writeData(data);
    return res.json({ success: true, verificationId: verification.id, bankName: verification.bankName, bankCode: null, accountName, userPhone, verificationMode: 'testing' });
  }

  if(!PAYSTACK_SECRET_KEY) return res.status(502).json({ message: 'Paystack secret key is required for live bank verification.' });
  try{
    const resolved = await resolveBankAccountWithPaystack(bankName, normalizedAccountNumber);
    const verification = { id: 'ver-' + crypto.randomUUID(), userId: user.id, userPhone, requestedBankName: bankName, ...resolved, verificationMode: 'paystack', verifiedAt: Date.now(), createdAt: Date.now() };
    data.verifications.push(verification);
    writeData(data);
    return res.json({ success: true, verificationId: verification.id, bankName: resolved.bankName, bankCode: resolved.bankCode, accountName: resolved.accountName, userPhone, verificationMode: 'paystack' });
  }catch(error){
    return res.status(502).json({ message: error.message || 'Unable to verify the bank account.' });
  }
});

app.get('/api/deposit-account', authMiddleware, (req, res) => {
  res.status(410).json({ message: 'Configured bank-transfer deposit accounts are disabled. Use Paystack checkout to fund your wallet.' });
});

app.get('/api/announcements', (req, res) => {
  const data = readData();
  const now = Date.now();
  const announcements = (data.announcements || []).filter((item) => {
    const createdAt = Number(item.createdAt);
    const expiresAt = Number(item.expiresAt);
    const effectiveExpiry = Number.isFinite(expiresAt) ? expiresAt : createdAt + ADMIN_MESSAGE_TTL_MS;
    return Number.isFinite(createdAt) && effectiveExpiry > now;
  });
  res.json({ announcements });
});

app.get('/api/notifications', authMiddleware, (req, res) => {
  const data = readData();
  const now = Date.now();
  const notifications = (data.notifications || [])
    .filter((notification) => {
      if(notification.userId !== req.user.id) return false;
      const explicitExpiry = Number(notification.expiresAt);
      const createdAt = Number(notification.createdAt);
      const effectiveExpiry = Number.isFinite(explicitExpiry)
        ? explicitExpiry
        : LEGACY_ADMIN_NOTIFICATION_TITLES.has(notification.title) && Number.isFinite(createdAt)
          ? createdAt + ADMIN_MESSAGE_TTL_MS
          : null;
      return effectiveExpiry === null || effectiveExpiry > now;
    })
    .sort((a,b)=>b.createdAt-a.createdAt);
  res.json({ notifications });
});

app.get('/api/paystack/config', (req, res) => {
  const mode = getPaystackMode();
  let enabled = false;
  try{
    assertPaystackCheckoutEnabled();
    enabled = true;
  }catch(error){
    enabled = false;
  }
  res.json({
    publicKey: getPaystackPublicKey(),
    currency: 'NGN',
    mode: mode || 'unconfigured',
    enabled
  });
});

app.post('/api/paystack/initialize', authMiddleware, async (req, res) => {
  const { amount, email } = req.body || {};
  const depositAmount = Number(amount);
  if(!Number.isSafeInteger(depositAmount) || depositAmount < MIN_DEPOSIT_AMOUNT || !Number.isSafeInteger(depositAmount * 100)){
    return res.status(400).json({ message: 'Enter a whole-naira deposit amount of at least ₦1,000.' });
  }
  const normalizedEmail = String(email || PAYSTACK_DEFAULT_EMAIL).trim();
  if(normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)){
    return res.status(400).json({ message: 'Enter a valid email address for Paystack checkout.' });
  }

  let checkoutSettings;
  try{
    checkoutSettings = assertPaystackCheckoutEnabled();
  }catch(error){
    return res.status(503).json({ message: error.message });
  }

  let reference;
  let payment;
  try{
    payment = updateData((data) => {
      const user = findUserById(data, req.user.id);
      if(!user) return null;
      do{
        reference = `MTX_${crypto.randomBytes(16).toString('hex')}`;
      }while((data.payments || []).some((item) => item.reference === reference));
      const createdAt = Date.now();
      const paymentRecord = {
        id: `pay-${crypto.randomUUID()}`,
        userId: user.id,
        amount: depositAmount,
        amountKobo: depositAmount * 100,
        currency: 'NGN',
        provider: 'paystack',
        status: 'initializing',
        statusHistory: [{ status: 'initializing', at: createdAt }],
        reference,
        paystackReference: reference,
        email: normalizedEmail,
        createdAt,
        verifiedAt: null
      };
      const deposit = {
        id: `dep-${crypto.randomUUID()}`,
        userId: user.id,
        userPhone: user.phone,
        email: normalizedEmail,
        amount: depositAmount,
        currency: 'NGN',
        provider: 'paystack',
        paystackReference: reference,
        transactionReference: generateUniqueDepositReference(data),
        paymentId: paymentRecord.id,
        status: 'pending',
        statusHistory: [{ status: 'pending', at: createdAt }],
        createdAt,
        submittedAt: createdAt,
        referredBy: user.referredBy || null,
        referralRewardProcessed: false
      };
      paymentRecord.depositId = deposit.id;
      paymentRecord.transactionId = `txn-${crypto.randomUUID()}`;
      data.payments = data.payments || [];
      data.payments.push(paymentRecord);
      data.deposits = data.deposits || [];
      data.deposits.push(deposit);
      data.transactions = data.transactions || [];
      data.transactions.push({
        id: paymentRecord.transactionId,
        userId: user.id,
        type: 'deposit',
        amount: depositAmount,
        status: 'pending',
        meta: {
          depositId: deposit.id,
          paymentId: paymentRecord.id,
          provider: 'paystack',
          paystackReference: reference,
          currency: 'NGN'
        },
        createdAt
      });
      return paymentRecord;
    });
  }catch(error){
    console.error('Unable to persist Paystack payment initialization:', error);
    return res.status(500).json({ message: 'Unable to create a payment record. Please try again.' });
  }
  if(!payment) return res.status(404).json({ message: 'User not found' });

  let response;
  try{
    response = await paystackRequest('/transaction/initialize', {
      method: 'POST',
      body: {
        email: normalizedEmail,
        amount: payment.amountKobo,
        currency: 'NGN',
        reference,
        callback_url: checkoutSettings.callbackUrl,
        channels: ['card', 'bank', 'ussd']
      }
    });
  }catch(err){
    try{
      updateData((data) => {
        const failedPayment = data.payments.find((item) => item.reference === reference);
        if(failedPayment && failedPayment.status === 'initializing'){
          failedPayment.status = 'initialization_failed';
          failedPayment.statusHistory.push({ status: 'initialization_failed', at: Date.now() });
          failedPayment.failureReason = 'Paystack initialization failed';
          const deposit = data.deposits.find((item) => item.id === failedPayment.depositId);
          if(deposit){
            deposit.status = 'failed';
            deposit.statusHistory.push({ status: 'failed', at: Date.now() });
          }
          const transaction = data.transactions.find((item) => item.id === failedPayment.transactionId);
          if(transaction) transaction.status = 'failed';
        }
      });
    }catch(persistError){
      console.error('Unable to persist Paystack initialization failure:', persistError);
      return res.status(500).json({ message: 'Payment setup failed and its status could not be saved.' });
    }
    console.error('Paystack payment initialization failed:', err.message);
    return res.status(502).json({ message: 'Unable to start Paystack checkout. Please try again.' });
  }

  const authorizationUrl = response.data && response.data.authorization_url;
  const paystackReference = response.data && response.data.reference;
  let checkoutHostIsValid = false;
  try{
    checkoutHostIsValid = new URL(authorizationUrl).origin === 'https://checkout.paystack.com';
  }catch(error){
    checkoutHostIsValid = false;
  }
  if(!checkoutHostIsValid || paystackReference !== reference){
    try{
      updateData((data) => {
        const failedPayment = data.payments.find((item) => item.reference === reference);
        if(failedPayment && failedPayment.status === 'initializing'){
          failedPayment.status = 'initialization_failed';
          failedPayment.statusHistory.push({ status: 'initialization_failed', at: Date.now() });
          failedPayment.failureReason = 'Invalid Paystack checkout response';
          const deposit = data.deposits.find((item) => item.id === failedPayment.depositId);
          if(deposit){
            deposit.status = 'failed';
            deposit.statusHistory.push({ status: 'failed', at: Date.now() });
          }
          const transaction = data.transactions.find((item) => item.id === failedPayment.transactionId);
          if(transaction) transaction.status = 'failed';
        }
      });
    }catch(error){
      console.error('Unable to persist invalid Paystack initialization response:', error);
      return res.status(500).json({ message: 'Payment setup failed and its status could not be saved.' });
    }
    return res.status(502).json({ message: 'Paystack returned an invalid checkout response.' });
  }

  let initializedPayment;
  try{
    initializedPayment = updateData((data) => {
      const storedPayment = data.payments.find((item) => item.reference === reference);
      if(!storedPayment || storedPayment.status !== 'initializing') return null;
      storedPayment.status = 'pending';
      storedPayment.statusHistory.push({ status: 'pending', at: Date.now() });
      return storedPayment;
    });
  }catch(error){
    console.error('Unable to persist Paystack checkout details:', error);
    return res.status(500).json({ message: 'Checkout was initialized but could not be saved. Contact support before retrying.' });
  }
  if(!initializedPayment) return res.status(409).json({ message: 'The payment session could not be saved. Please start again.' });
  return res.json({
    status: true,
    reference,
    authorizationUrl,
    payment: {
      reference,
      amount: initializedPayment.amount,
      currency: initializedPayment.currency,
      status: initializedPayment.status
    }
  });
});

function updatePaymentFromVerification(data, reference, providerTransaction){
  if(!providerTransaction || typeof providerTransaction.reference !== 'string' || typeof providerTransaction.status !== 'string'){
    throw new Error('Paystack verification did not return a valid transaction.');
  }
  const payment = (data.payments || []).find((item) => item.reference === reference && item.provider === 'paystack');
  if(!payment) return null;
  const deposit = (data.deposits || []).find((item) => item.id === payment.depositId && item.userId === payment.userId);
  const transaction = (data.transactions || []).find((item) => item.id === payment.transactionId && item.userId === payment.userId);
  const checkedAt = Date.now();
  const setStatus = (record, status) => {
    if(!record || record.status === status) return;
    record.status = status;
    record.statusHistory = record.statusHistory || [];
    record.statusHistory.push({ status, at: checkedAt });
  };
  const providerAmount = Number(providerTransaction.amount);
  const providerCurrency = String(providerTransaction.currency || '').toUpperCase();
  const matchingReference = providerTransaction.reference === payment.reference;
  const validSuccessfulPayment = providerTransaction.status === 'success'
    && matchingReference
    && Number.isSafeInteger(providerAmount)
    && providerAmount === payment.amountKobo
    && providerCurrency === 'NGN';

  payment.lastCheckedAt = checkedAt;
  payment.paystackTransactionId = providerTransaction.id || null;
  payment.channel = providerTransaction.channel || null;
  payment.gatewayResponse = providerTransaction.gateway_response || null;
  payment.paidAt = providerTransaction.paid_at || null;
  payment.actualAmountKobo = Number.isSafeInteger(providerAmount) ? providerAmount : null;
  payment.actualCurrency = providerCurrency || null;
  if(deposit){
    deposit.paystackStatus = providerTransaction.status;
    deposit.paystackActualAmountKobo = payment.actualAmountKobo;
    deposit.paystackActualCurrency = payment.actualCurrency;
  }

  if(payment.status !== 'success' && payment.status !== 'needs_review'){
    if(providerTransaction.status === 'success' && !validSuccessfulPayment){
      setStatus(payment, 'needs_review');
      payment.failureReason = 'Paystack amount, currency, or reference mismatch';
      setStatus(deposit, 'needs_review');
      if(transaction) transaction.status = 'needs_review';
    }else if(validSuccessfulPayment){
      setStatus(payment, 'success');
      payment.verifiedAt = payment.verifiedAt || checkedAt;
      if(deposit && deposit.status !== 'rejected' && deposit.status !== 'approved'){
        setStatus(deposit, 'pending');
        deposit.paystackStatus = 'success';
        deposit.paymentVerifiedAt = payment.verifiedAt;
      }
      if(transaction && transaction.status !== 'completed'){
        transaction.status = 'verified_pending_approval';
        transaction.meta = { ...(transaction.meta || {}), paymentStatus: 'success', paymentVerifiedAt: payment.verifiedAt };
      }
    }else if(providerTransaction.status === 'failed' || providerTransaction.status === 'abandoned' || providerTransaction.status === 'cancelled'){
      const failedStatus = providerTransaction.status === 'failed' ? 'failed' : 'cancelled';
      setStatus(payment, failedStatus);
      if(deposit && deposit.status !== 'approved' && deposit.status !== 'rejected') setStatus(deposit, payment.status);
      if(transaction && transaction.status !== 'completed') transaction.status = payment.status;
    }else{
      setStatus(payment, 'pending');
    }
  }

  return { payment, deposit };
}

app.post('/api/paystack/verify', authMiddleware, async (req, res) => {
  const reference = String(req.body && req.body.reference || '').trim();
  if(!/^[A-Za-z0-9._-]{8,100}$/.test(reference)) return res.status(400).json({ message: 'A valid transaction reference is required.' });
  const savedPayment = (readData().payments || []).find((item) => item.reference === reference && item.userId === req.user.id && item.provider === 'paystack');
  if(!savedPayment) return res.status(404).json({ message: 'Payment not found.' });
  if(!PAYSTACK_SECRET_KEY) return res.status(503).json({ message: 'Paystack is not configured on this host.' });

  try{
    const response = await paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`);
    const updated = updateData((data) => updatePaymentFromVerification(data, reference, response.data || {}));
    if(!updated) return res.status(404).json({ message: 'Payment not found.' });
    return res.json({
      payment: {
        reference: updated.payment.reference,
        amount: updated.payment.amount,
        currency: updated.payment.currency,
        status: updated.payment.status,
        createdAt: updated.payment.createdAt,
        verifiedAt: updated.payment.verifiedAt,
        gatewayResponse: updated.payment.gatewayResponse,
        paidAt: updated.payment.paidAt
      },
      deposit: updated.deposit ? { status: updated.deposit.status } : null
    });
  }catch(err){
    console.error('Paystack payment verification failed:', err.message);
    return res.status(502).json({ message: 'Unable to verify this payment with Paystack. Please try again.' });
  }
});

app.post('/api/paystack/webhook', (req, res) => {
  const signature = req.get('x-paystack-signature');
  if(!isValidPaystackSignature(req.rawBody, signature)){
    return res.status(401).json({ message: 'Invalid Paystack webhook signature.' });
  }

  const event = req.body || {};
  if(!['charge.success', 'charge.failed'].includes(event.event)){
    return res.status(200).json({ received: true });
  }
  const reference = String(event.data && event.data.reference || '').trim();
  if(!reference || !(readData().payments || []).some((payment) => payment.reference === reference && payment.provider === 'paystack')){
    return res.status(200).json({ received: true });
  }

  paystackRequest(`/transaction/verify/${encodeURIComponent(reference)}`)
    .then((response) => {
      const updated = updateData((data) => updatePaymentFromVerification(data, reference, response.data || {}));
      if(!updated) return res.status(200).json({ received: true });
      return res.status(200).json({ received: true, paymentStatus: updated.payment.status });
    })
    .catch((error) => {
      console.error('Paystack webhook verification failed:', error.message);
      return res.status(503).json({ message: 'Unable to verify the Paystack event. Please retry.' });
    });
});

app.post('/api/deposits', authMiddleware, (req, res) => {
  res.status(410).json({ message: 'Direct bank-transfer deposit submissions are disabled. Use Paystack checkout to fund your wallet.' });
});

app.get('/api/withdrawals/availability', authMiddleware, (req, res) => {
  res.json(getWithdrawalAvailability());
});

app.post('/api/vips/buy', authMiddleware, (req, res) => {
  const { planId } = req.body;
  const plan = VIP_PLANS.find((p) => p.id === Number(planId));
  if(!plan) return res.status(400).json({ message: 'Invalid investment plan' });
  const data = readData();
  const user = findUserById(data, req.user.id);
  if(!user) return res.status(404).json({ message: 'User not found' });
  if(!user.balance || user.balance < plan.deposit) return res.status(400).json({ message: 'Insufficient balance' });
  if(user.activePlan) return res.status(400).json({ message: 'Only one investment plan can be active at a time' });
  const now = Date.now();
  user.balance -= plan.deposit;
  user.activePlan = { id: plan.id, name: plan.name, deposit: plan.deposit, daily: plan.daily, startedAt: now, nextPayoutAt: now + 24 * 60 * 60 * 1000 };
  recordTransaction(data, {
    userId: user.id,
    type: 'plan_activation',
    amount: plan.deposit,
    status: 'completed',
    meta: { planId: plan.id, planName: plan.name, description: `${plan.name} activated` }
  });
  createNotification(data, {
    userId: user.id,
    title: 'Investment plan activated',
    text: `Your ${plan.name} is active. Daily rewards of ₦${plan.daily.toLocaleString()} will arrive automatically.`,
    type: 'success'
  });
  writeData(data);
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/withdrawals', authMiddleware, (req, res) => {
  const { amount, bankName, accountNumber, verificationId } = req.body || {};
  const withdrawAmount = Number(amount);
  if(!Number.isSafeInteger(withdrawAmount) || withdrawAmount <= 0) return res.status(400).json({ message: 'Enter a whole-naira withdrawal amount.' });
  if(!bankName) return res.status(400).json({ message: 'Bank selection is required' });
  if(!accountNumber || !/^\d{10}$/.test(String(accountNumber))) return res.status(400).json({ message: 'Account number must contain exactly 10 digits' });
  if(withdrawAmount < 1000) return res.status(400).json({ message: 'Minimum withdrawal amount is ₦1,000' });

  const availability = getWithdrawalAvailability();
  if(!availability.available) return res.status(400).json({ message: availability.message });

  const data = readData();
  const user = findUserById(data, req.user.id);
  if(!user) return res.status(404).json({ message: 'User not found' });
  if(!user.activePlan) return res.status(400).json({ message: 'Activate an investment plan before requesting a withdrawal.' });
  if(withdrawAmount > (user.balance || 0)) return res.status(400).json({ message: 'Insufficient balance' });

  // Validate verification id (result of /api/verify-account)
  data.verifications = data.verifications || [];
  const verification = data.verifications.find(v => v.id === verificationId && v.userId === user.id && v.userPhone === user.phone && (v.requestedBankName || v.bankName) === bankName && v.accountNumber === accountNumber);
  if(!verification) return res.status(400).json({ message: 'Unable to verify account details. Please check the bank and account number.' });

  const withdrawal = {
    id: 'wd-' + crypto.randomUUID(),
    userId: user.id,
    userName: user.fullName,
    userPhone: user.phone,
    amount: withdrawAmount,
    bankName: verification.bankName,
    bankCode: verification.bankCode || null,
    accountNumber,
    accountName: verification.accountName,
    status: 'pending',
    statusHistory: [{ status: 'pending', at: Date.now() }],
    createdAt: Date.now()
  };

  data.withdrawals = data.withdrawals || [];
  data.withdrawals.push(withdrawal);
  // create a pending transaction record
  recordTransaction(data, { userId: user.id, type: 'withdrawal', amount: withdrawAmount, status: 'pending', meta: { withdrawalId: withdrawal.id } });
  // notify user that withdrawal was submitted
  createNotification(data, { userId: user.id, title: 'Withdrawal submitted', text: `Your withdrawal request of ₦${withdrawAmount} is awaiting admin review. If approved, it will be paid manually to your verified bank account.`, type: 'info' });
  writeData(data);
  res.json({ withdrawal });
});

// Admin routes: view and manage deposits/withdrawals, view transactions and stats
app.get('/api/admin/deposits', adminAuthMiddleware, (req, res) => {
  const data = readData();
  const deposits = (data.deposits || []).slice().sort((a, b) => (b.createdAt || b.submittedAt || 0) - (a.createdAt || a.submittedAt || 0));
  res.json({ deposits });
});

// Search deposits by transaction reference (query param: ref)
app.get('/api/admin/deposits/search', adminAuthMiddleware, (req, res) => {
  const ref = String(req.query.ref || '').trim();
  if(!ref) return res.status(400).json({ message: 'Missing ref query parameter' });
  const data = readData();
  const matches = (data.deposits || []).filter(d => {
    if(!d.transactionReference) return false;
    try{
      return String(d.transactionReference).toLowerCase().includes(ref.toLowerCase());
    }catch(e){ return false; }
  });
  res.json({ deposits: matches.sort((a, b) => (b.createdAt || b.submittedAt || 0) - (a.createdAt || a.submittedAt || 0)) });
});

app.post('/api/admin/deposits/:id/approve', adminAuthMiddleware, (req, res) => {
  const id = req.params.id;
  const data = readData();
  const deposit = (data.deposits || []).find(d => d.id === id);
  if(!deposit) return res.status(404).json({ message: 'Deposit not found' });
  if(deposit.status !== 'pending') return res.status(409).json({ message: 'Only pending deposits can be approved.' });
  if(deposit.provider !== 'paystack'){
    return res.status(409).json({ message: 'Only verified Paystack deposits can be approved. Direct bank-transfer deposits are disabled.' });
  }
  const paystackPayment = (data.payments || []).find(payment => payment.id === deposit.paymentId && payment.userId === deposit.userId);
  if(!paystackPayment || paystackPayment.status !== 'success' || !paystackPayment.verifiedAt){
    return res.status(409).json({ message: 'This Paystack deposit cannot be approved until payment is verified.' });
  }
  const isFirstApprovedDeposit = !(data.deposits || []).some(d => d.userId === deposit.userId && d.status === 'approved' && d.id !== deposit.id);
  deposit.status = 'approved';
  deposit.statusHistory = deposit.statusHistory || [];
  deposit.statusHistory.push({ status: 'approved', at: Date.now() });
  if(paystackPayment) paystackPayment.creditedAt = Date.now();
  const user = findUserById(data, deposit.userId);
  if(!user) return res.status(404).json({ message: 'User not found' });
  user.balance = (user.balance || 0) + deposit.amount;
  if(data.transactions) data.transactions.forEach(t => { if(t.meta && t.meta.depositId === deposit.id) t.status = 'approved'; });
  recordTransaction(data, { userId: user.id, type: 'wallet_credit', amount: deposit.amount, status: 'completed', meta: { depositId: deposit.id, transactionReference: deposit.transactionReference } });
  createNotification(data, { userId: deposit.userId, title: 'Deposit approved', text: `Your deposit of ₦${deposit.amount} has been approved and credited to your wallet.`, type: 'success', expiresAfterMs: ADMIN_MESSAGE_TTL_MS });

  if(deposit.referredBy && isFirstApprovedDeposit && !deposit.referralRewardProcessed){
    const referrer = findUserById(data, deposit.referredBy);
    const reward = Math.round(deposit.amount * REFERRAL_REWARD_RATE);
    if(referrer){
      referrer.balance = (referrer.balance || 0) + reward;
      referrer.refEarnings = (referrer.refEarnings || 0) + reward;
      referrer.earnings = (referrer.earnings || 0) + reward;
      recordTransaction(data, { userId: referrer.id, type: 'referral_earnings', amount: reward, status: 'completed', meta: { referredUserId: deposit.userId, depositId: deposit.id } });
      createNotification(data, { userId: referrer.id, title: 'Referral reward received', text: `You earned ₦${reward.toLocaleString()} from a successful referral deposit.`, type: 'success' });
      deposit.referralRewardProcessed = true;
    }
  }

  addAuditLog(data, { adminToken: req.admin.token, action: 'approve_deposit', details: { depositId: deposit.id, userId: deposit.userId, amount: deposit.amount } });
  writeData(data);
  res.json({ deposit, user: sanitizeUser(user) });
});

app.post('/api/admin/deposits/:id/reject', adminAuthMiddleware, (req, res) => {
  const id = req.params.id;
  const { reason } = req.body || {};
  const data = readData();
  const deposit = (data.deposits || []).find(d => d.id === id);
  if(!deposit) return res.status(404).json({ message: 'Deposit not found' });
  if(deposit.status !== 'pending') return res.status(409).json({ message: 'Only pending deposits can be rejected.' });
  deposit.status = 'rejected';
  deposit.statusHistory = deposit.statusHistory || [];
  deposit.statusHistory.push({ status: 'rejected', at: Date.now(), reason: reason || null });
  if(data.transactions) data.transactions.forEach(t => { if(t.meta && t.meta.depositId === deposit.id) t.status = 'rejected'; });
  createNotification(data, { userId: deposit.userId, title: 'Deposit rejected', text: reason || 'Your deposit request was rejected by the administrator.', type: 'warning', expiresAfterMs: ADMIN_MESSAGE_TTL_MS });
  addAuditLog(data, { adminToken: req.admin.token, action: 'reject_deposit', details: { depositId: deposit.id, userId: deposit.userId, reason: reason || null } });
  writeData(data);
  res.json({ deposit });
});

app.get('/api/admin/withdrawals', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ withdrawals: data.withdrawals || [] });
});

function markWithdrawalPaid(req, res){
  const id = req.params.id;
  const data = readData();
  const wd = (data.withdrawals || []).find(w => w.id === id);
  if(!wd) return res.status(404).json({ message: 'Withdrawal not found' });
  if(wd.status !== 'pending') return res.status(409).json({ message: 'Only pending withdrawals can be marked paid.' });
  const user = findUserById(data, wd.userId);
  if(!user) return res.status(404).json({ message: 'User not found' });
  if(wd.amount > (user.balance || 0)) return res.status(409).json({ message: 'Insufficient wallet balance. Do not send the manual bank transfer.' });
  user.balance -= wd.amount;
  wd.status = 'paid';
  wd.paidAt = Date.now();
  wd.payoutMethod = 'manual_bank_transfer';
  wd.statusHistory = wd.statusHistory || [];
  wd.statusHistory.push({ status: 'paid', at: wd.paidAt });
  if(data.transactions) data.transactions.forEach(t => { if(t.meta && t.meta.withdrawalId === wd.id) t.status = 'paid'; });
  recordTransaction(data, { userId: wd.userId, type: 'wallet_debit', amount: wd.amount, status: 'completed', meta: { withdrawalId: wd.id } });
  createNotification(data, { userId: wd.userId, title: 'Withdrawal paid', text: `Your withdrawal of ₦${wd.amount} has been marked paid after manual bank transfer.`, type: 'success', expiresAfterMs: ADMIN_MESSAGE_TTL_MS });
  addAuditLog(data, { adminToken: req.admin.token, action: 'mark_withdrawal_paid', details: { withdrawalId: wd.id, userId: wd.userId, amount: wd.amount, payoutMethod: wd.payoutMethod } });
  writeData(data);
  res.json({ withdrawal: wd, user: sanitizeUser(user) });
}

app.post('/api/admin/withdrawals/:id/mark-paid', adminAuthMiddleware, markWithdrawalPaid);
app.post('/api/admin/withdrawals/:id/approve', adminAuthMiddleware, markWithdrawalPaid);

app.post('/api/admin/withdrawals/:id/reject', adminAuthMiddleware, (req, res) => {
  const id = req.params.id;
  const { reason } = req.body || {};
  const data = readData();
  const wd = (data.withdrawals || []).find(w => w.id === id);
  if(!wd) return res.status(404).json({ message: 'Withdrawal not found' });
  if(wd.status !== 'pending') return res.status(409).json({ message: 'Only pending withdrawals can be rejected.' });
  wd.status = 'rejected';
  wd.statusHistory = wd.statusHistory || [];
  wd.statusHistory.push({ status: 'rejected', at: Date.now(), reason: reason || null });
  if(data.transactions) data.transactions.forEach(t => { if(t.meta && t.meta.withdrawalId === wd.id) t.status = 'rejected'; });
  createNotification(data, { userId: wd.userId, title: 'Withdrawal rejected', text: reason || 'Your withdrawal request was rejected by the administrator.', type: 'warning', expiresAfterMs: ADMIN_MESSAGE_TTL_MS });
  addAuditLog(data, { adminToken: req.admin.token, action: 'reject_withdrawal', details: { withdrawalId: wd.id, userId: wd.userId, reason: reason || null } });
  writeData(data);
  res.json({ withdrawal: wd });
});

// Transactions and stats endpoints
app.get('/api/transactions', authMiddleware, (req, res) => {
  const data = readData();
  const txs = (data.transactions || []).filter(t => t.userId === req.user.id);
  res.json({ transactions: txs });
});

app.get('/api/admin/transactions', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ transactions: data.transactions || [] });
});

app.get('/api/admin/users', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ users: (data.users || []).map(user => sanitizeUser(user)) });
});

app.get('/api/admin/deposit-accounts', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ accounts: data.depositAccounts || DEFAULT_DEPOSIT_ACCOUNTS });
});

app.post('/api/admin/deposit-accounts', adminAuthMiddleware, (req, res) => {
  const { accountId, status } = req.body || {};
  const data = readData();
  const target = (data.depositAccounts || []).find(account => account.id === accountId);
  if(!target) return res.status(404).json({ message: 'Deposit account not found' });
  target.status = status || target.status;
  writeData(data);
  res.json({ account: target });
});

app.get('/api/admin/announcements', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ announcements: data.announcements || [] });
});

app.post('/api/admin/announcements', adminAuthMiddleware, (req, res) => {
  const { title, message, type = 'info' } = req.body || {};
  if(!title || !message) return res.status(400).json({ message: 'Title and message are required' });
  const data = readData();
  const createdAt = Date.now();
  const announcement = {
    id: 'ann-' + crypto.randomUUID(),
    title,
    message,
    type,
    createdAt,
    expiresAt: createdAt + ADMIN_MESSAGE_TTL_MS
  };
  data.announcements = data.announcements || [];
  data.announcements.push(announcement);
  writeData(data);
  res.json({ announcement });
});

app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  const data = readData();
  const totalDeposits = (data.deposits || []).reduce((s,d)=>s+(d.amount||0),0);
  const totalWithdrawals = (data.withdrawals || []).reduce((s,w)=>s+(w.amount||0),0);
  const totalBalances = (data.users || []).reduce((s,u)=>s+(u.balance||0),0);
  const pendingDeposits = (data.deposits || []).filter(d => d.status !== 'approved' && d.status !== 'rejected').length;
  const pendingWithdrawals = (data.withdrawals || []).filter(w => w.status !== 'approved' && w.status !== 'rejected').length;
  const totalRevenue = totalDeposits;
  res.json({ totalDeposits, totalWithdrawals, totalBalances, users: (data.users||[]).length, pendingDeposits, pendingWithdrawals, totalRevenue });
});

app.get('/api/admin/verify', adminAuthMiddleware, (req, res) => {
  res.json({ ok: true, message: 'Admin access verified' });
});

// Admin: list virtual deposit sessions for reconciliation
app.get('/api/admin/virtual-accounts', adminAuthMiddleware, (req, res) => {
  const data = readData();
  res.json({ virtualAccounts: data.virtualAccounts || [] });
});

// Server-side admin login: accepts token and sets a secure httpOnly cookie for the admin session.
app.post('/api/admin/login', (req, res) => {
  const token = req.body && req.body.token;
  if(!token || token !== ADMIN_TOKEN) return res.status(401).json({ message: 'Invalid admin token' });
  // Set a short-lived httpOnly cookie to establish the admin session
  res.cookie('mx_admin', ADMIN_TOKEN, ADMIN_COOKIE_OPTIONS);
  res.json({ ok: true, message: 'Admin session created' });
});

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-login.html'));
});

app.get('/admin', adminAuthMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', adminAuthMiddleware, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'monetrix-invest', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
[
  'index.html',
  'admin-login.html',
  'dashboard.html',
  'deposit.html',
  'login.html',
  'profile.html',
  'referral.html',
  'register.html',
  'vip.html',
  'withdraw.html'
].forEach((page) => {
  app.get(`/${page}`, (req, res) => res.sendFile(path.join(__dirname, page)));
});

for(const directory of ['assets', 'components', 'css', 'js']){
  app.use(`/${directory}`, express.static(path.join(__dirname, directory), { dotfiles: 'deny', index: false }));
}
app.get('/banner.jpeg', (req, res) => res.sendFile(path.join(__dirname, 'banner.jpeg')));

app.use((req, res, next) => {
  if(req.path === '/api' || req.path.startsWith('/api/')){
    return res.status(404).json({ message: 'API route not found' });
  }
  return res.status(404).send('Not found');
});

const port = process.env.PORT || 3000;
if(require.main === module){
  app.listen(port, () => console.log(`MONETRIX INVEST backend running on http://localhost:${port}`));
}

module.exports = {
  app,
  isValidPaystackSignature,
  updatePaymentFromVerification,
  isWithdrawalWindowOpen,
  getWithdrawalAvailability
};
