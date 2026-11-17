document.addEventListener('DOMContentLoaded', async () => {
  const user = getUser();
  if(!user){ location.href = 'login.html'; return; }

  const profileName = document.getElementById('profile-name');
  const profilePhone = document.getElementById('profile-phone');
  const profileBalance = document.getElementById('profile-balance');
  const profileRefCode = document.getElementById('profile-ref-code');
  const profileRefLink = document.getElementById('profile-ref-link');
  const logoutBtn = document.getElementById('logout-btn');
  const transactionsEl = document.getElementById('profile-transactions');

  try{
    const res = await api.getMe();
    if(res && res.user) saveUser(res.user);
  }catch(e){ /* ignore, use cached */ }

  const u = getUser();
  if(profileName) profileName.textContent = u.fullName || '';
  if(profilePhone) profilePhone.textContent = u.phone || '';
  if(profileBalance) profileBalance.textContent = formatN(u.balance || 0);
  if(profileRefCode) profileRefCode.textContent = u.referralCode || '—';
  if(profileRefLink){
    const link = u.referralLink || (window.location.origin + `/register.html?ref=${encodeURIComponent(u.referralCode || '')}`);
    profileRefLink.href = link;
    profileRefLink.textContent = link;
  }

  if(transactionsEl){
    try {
      const response = await api.getTransactions();
      const transactions = (response.transactions || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      transactionsEl.innerHTML = transactions.length ? transactions.map((transaction) => {
        const type = escapeHtml(transaction.type || 'transaction');
        const isDebit = transaction.type === 'withdrawal' || transaction.type === 'wallet_debit' || transaction.type === 'plan_activation';
        const sign = isDebit ? '-' : '+';
        const amountClass = isDebit ? 'negative' : 'positive';
        return `<div class="transaction-row"><div class="transaction-left"><div class="transaction-icon">${isDebit ? '↘' : '↗'}</div><div class="transaction-meta"><strong>${type}</strong><div class="muted">${new Date(transaction.createdAt || Date.now()).toLocaleString()}</div></div></div><div class="transaction-right"><div class="transaction-amount ${amountClass}">${sign}₦${formatN(transaction.amount || 0)}</div><div class="muted">${escapeHtml(transaction.status || 'pending')}</div></div></div>`;
      }).join('') : '<div class="empty-state">No transactions yet.</div>';
    } catch(error) {
      transactionsEl.innerHTML = `<div class="empty-state">${escapeHtml(error.message || 'Unable to load transaction history.')}</div>`;
    }
  }

  logoutBtn?.addEventListener('click', async () => {
    try{ await api.logout(); }catch(e){ /* ignore */ }
    localStorage.removeItem('monetrix_user');
    location.href = 'login.html';
  });
});
