// Shared client helpers. The browser is always backed by the Express API.
const API_BASE = '/api';

function getUser(){
  try { return JSON.parse(localStorage.getItem('monetrix_user')) || null; }
  catch { return null; }
}

function saveUser(user){
  if(user) localStorage.setItem('monetrix_user', JSON.stringify(user));
  else localStorage.removeItem('monetrix_user');
}

function requireAuth(redirectTo = 'login.html'){
  const user = getUser();
  if(!user) location.href = redirectTo;
  return user;
}

function formatN(amount){
  const value = Number(amount);
  return Number.isFinite(value) ? value.toLocaleString('en-NG') : '0';
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

async function apiFetch(url, options = {}){
  const opts = {
    credentials: 'include',
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  };
  if(opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);

  const response = await fetch(url, opts);
  const data = await response.json().catch(() => ({}));
  if(!response.ok){
    throw new Error(data.message || 'Request failed');
  }
  return data;
}

const api = {
  register: (payload) => apiFetch(`${API_BASE}/auth/register`, { method: 'POST', body: payload }),
  login: (payload) => apiFetch(`${API_BASE}/auth/login`, { method: 'POST', body: payload }),
  logout: () => apiFetch(`${API_BASE}/auth/logout`, { method: 'POST' }),
  getMe: () => apiFetch(`${API_BASE}/users/me`),
  getTransactions: () => apiFetch(`${API_BASE}/transactions`),
  getAnnouncements: () => apiFetch(`${API_BASE}/announcements`),
  getNotifications: () => apiFetch(`${API_BASE}/notifications`),
  initializePaystackPayment: (payload) => apiFetch(`${API_BASE}/paystack/initialize`, { method: 'POST', body: payload }),
  verifyPaystackPayment: (payload) => apiFetch(`${API_BASE}/paystack/verify`, { method: 'POST', body: payload }),
  deposit: (payload) => apiFetch(`${API_BASE}/deposits`, { method: 'POST', body: payload }),
  verifyAccount: (payload) => apiFetch(`${API_BASE}/verify-account`, { method: 'POST', body: payload }),
  buyVip: (payload) => apiFetch(`${API_BASE}/vips/buy`, { method: 'POST', body: payload }),
  withdraw: (payload) => apiFetch(`${API_BASE}/withdrawals`, { method: 'POST', body: payload })
};

window.api = api;
