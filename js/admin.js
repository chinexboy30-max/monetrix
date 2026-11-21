document.addEventListener('DOMContentLoaded', async () => {
  // Verify server-side admin session (cookie) before loading. If not authenticated, redirect to login.
  try {
    const res = await fetch('/api/admin/verify');
    if(!res.ok){ location.href = 'admin-login.html'; return; }
  } catch (e) { location.href = 'admin-login.html'; return; }

  const tokenInput = document.getElementById('admin-token');
  const statsGrid = document.getElementById('stats-grid');
  const depositsList = document.getElementById('deposits-list');
  const withdrawalsList = document.getElementById('withdrawals-list');
  const usersList = document.getElementById('users-list');
  const transactionsList = document.getElementById('transactions-list');
  const announcementsList = document.getElementById('announcements-list');
  const createAnnouncementBtn = document.getElementById('create-announcement');

  // Do not rely on localStorage for admin session in production. Server establishes a secure httpOnly cookie.

  async function adminFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const adminToken = (tokenInput?.value || '').trim();
    if(adminToken) headers['x-admin-token'] = adminToken; // allow override if provided in the UI
    const res = await fetch(url, {
      headers,
      ...options
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok){ throw new Error(data.message || 'Admin request failed'); }
    return data;
  }

  function createStatCard(label, value) {
    return `
      <div class="wallet-card">
        <div class="muted">${label}</div>
        <div class="balance-value" style="font-size:22px; margin-top:10px;">${value}</div>
      </div>
    `;
  }

  function formatDateTime(timestamp) {
    if(!timestamp) return '—';
    return new Date(timestamp).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatAge(timestamp) {
    if(!timestamp) return 'time unavailable';
    const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp)) / 60000));
    if(minutes < 1) return 'just now';
    if(minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  }

  function renderDeposits(items) {
    const list = items || [];
    if(!list.length){
      depositsList.innerHTML = '<div class="muted">No pending deposit requests found.</div>';
      return;
    }
    depositsList.innerHTML = list.map((item) => {
      const canDecide = item.status === 'pending' && item.provider === 'paystack' && item.paystackStatus === 'success';
      const reviewMessage = item.provider !== 'paystack'
        ? 'Direct bank-transfer deposits are disabled and cannot be credited.'
        : item.status === 'needs_review'
        ? 'Held for payment review. Wallet credit is disabled.'
        : 'Awaiting Paystack confirmation. Wallet credit is disabled.';
      return `
      <article class="note-panel card" style="margin:12px 0;">
        <div><strong>${escapeHtml(item.id)}</strong></div>
        <div class="muted">User ID: ${escapeHtml(item.userId)}</div>
        <div class="muted">User phone: ${escapeHtml(item.userPhone || '—')}</div>
        ${item.email ? `<div class="muted">Email: ${escapeHtml(item.email)}</div>` : ''}
        <div class="muted">Amount: ₦${formatN(item.amount)}</div>
        <div class="muted">Provider: ${escapeHtml(item.provider || 'Bank transfer')}</div>
        <div class="muted">MONETRIX Ref: ${escapeHtml(item.transactionReference || '—')}</div>
        ${item.paystackReference ? `<div class="muted">Paystack Ref: ${escapeHtml(item.paystackReference)}</div>` : ''}
        ${item.paystackStatus ? `<div class="muted">Paystack status: ${escapeHtml(item.paystackStatus)}</div>` : ''}
        ${item.paystackActualAmountKobo !== null && item.paystackActualAmountKobo !== undefined ? `<div class="muted">Paystack amount: ₦${formatN(Number(item.paystackActualAmountKobo) / 100)} ${escapeHtml(item.paystackActualCurrency || '')}</div>` : ''}
        ${item.paymentVerifiedAt ? `<div class="muted">Payment verified: ${escapeHtml(formatDateTime(item.paymentVerifiedAt))}</div>` : ''}
        <div class="muted">Payment Ref: ${escapeHtml(item.paymentReference || '—')}</div>
        <div class="muted">Bank Transfer Ref: ${escapeHtml(item.bankTransferReference || '—')}</div>
        <div class="muted">Backing Account: ${escapeHtml(item.backingAccountId || (item.meta && item.meta.backingAccountId) || '—')}</div>
        <div class="admin-request-time"><span>Requested ${escapeHtml(formatDateTime(item.submittedAt || item.createdAt))}</span><strong>${escapeHtml(formatAge(item.submittedAt || item.createdAt))}</strong></div>
        ${item.paymentSessionExpiresAt ? `<div class="muted">Payment session expires: ${escapeHtml(formatDateTime(item.paymentSessionExpiresAt))}</div>` : ''}
        <div class="muted">Status: ${escapeHtml(item.status || 'pending')}</div>
        ${canDecide ? `<div class="button-row">
          <button class="btn primary" data-action="approve-deposit" data-id="${item.id}">Approve</button>
          <button class="btn ghost" data-action="reject-deposit" data-id="${item.id}">Reject</button>
        </div>` : `<div class="muted">${reviewMessage}</div>`}
      </article>
    `;
    }).join('');
  }

  function renderWithdrawals(items) {
    const list = items || [];
    if(!list.length){
      withdrawalsList.innerHTML = '<div class="muted">No pending withdrawal requests found.</div>';
      return;
    }
    withdrawalsList.innerHTML = list.map((item) => `
      <article class="note-panel card" style="margin:12px 0;">
        <div><strong>${escapeHtml(item.id)}</strong></div>
        <div class="muted">User ID: ${escapeHtml(item.userId)}</div>
        <div class="muted">User phone: ${escapeHtml(item.userPhone || '—')}</div>
        <div class="muted">Amount: ₦${formatN(item.amount)}</div>
        <div class="muted">Bank: ${escapeHtml(item.bankName || '—')}${item.bankCode ? ` (${escapeHtml(item.bankCode)})` : ''}</div>
        <div class="muted">Account number: ${escapeHtml(item.accountNumber || '—')}</div>
        <div class="muted">Account name: ${escapeHtml(item.accountName || '—')}</div>
        <div class="muted">Manual payout: Send the bank transfer outside Monetrix, then mark this request paid.</div>
        <div class="admin-request-time"><span>Requested ${escapeHtml(formatDateTime(item.createdAt))}</span><strong>${escapeHtml(formatAge(item.createdAt))}</strong></div>
        <div class="muted">Status: ${escapeHtml(item.status || 'pending')}</div>
        ${item.status === 'pending' ? `<div class="button-row">
          <button class="btn primary" data-action="mark-withdrawal-paid" data-id="${item.id}">Mark paid</button>
          <button class="btn ghost" data-action="reject-withdrawal" data-id="${item.id}">Reject</button>
        </div>` : ''}
      </article>
    `).join('');
  }

  function renderUsers(items) {
    const list = items || [];
    if(!list.length){
      usersList.innerHTML = '<div class="muted">No users found.</div>';
      return;
    }
    usersList.innerHTML = list.map((user) => `
      <article class="note-panel card" style="margin:12px 0;">
        <div><strong>${escapeHtml(user.fullName || 'User')}</strong></div>
        <div class="muted">Phone: ${escapeHtml(user.phone || '—')}</div>
        <div class="muted">Balance: ₦${formatN(user.balance || 0)}</div>
        <div class="muted">Plan: ${user.activePlan ? user.activePlan.name : 'No active plan'}</div>
      </article>
    `).join('');
  }

  function renderTransactions(items) {
    const list = items || [];
    if(!list.length){
      transactionsList.innerHTML = '<div class="muted">No transactions found.</div>';
      return;
    }
    transactionsList.innerHTML = list.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 8).map((transaction) => `
      <article class="note-panel card" style="margin:12px 0;">
        <div><strong>${transaction.type || 'transaction'}</strong></div>
        <div class="muted">Amount: ₦${formatN(transaction.amount || 0)}</div>
        <div class="muted">Status: ${transaction.status || 'pending'}</div>
        <div class="muted">Created: ${new Date(transaction.createdAt || Date.now()).toLocaleString()}</div>
      </article>
    `).join('');
  }

  function renderAnnouncements(items) {
    const list = items || [];
    if(!list.length){
      announcementsList.innerHTML = '<div class="muted">No announcements published.</div>';
      return;
    }
    announcementsList.innerHTML = list.map((item) => `
      <article class="note-panel card" style="margin:12px 0;">
        <div><strong>${escapeHtml(item.title)}</strong></div>
        <div class="muted">${escapeHtml(item.message)}</div>
      </article>
    `).join('');
  }

  async function loadQueue() {
    try {
      const [stats, deposits, withdrawals, users, announcements, transactions] = await Promise.all([
        adminFetch('/api/admin/stats'),
        adminFetch('/api/admin/deposits'),
        adminFetch('/api/admin/withdrawals'),
        adminFetch('/api/admin/users'),
        adminFetch('/api/admin/announcements'),
        adminFetch('/api/admin/transactions')
      ]);

      statsGrid.innerHTML = [
        createStatCard('Total Users', stats.users || 0),
        createStatCard('Total Deposits', `₦${formatN(stats.totalDeposits || 0)}`),
        createStatCard('Total Withdrawals', `₦${formatN(stats.totalWithdrawals || 0)}`),
        createStatCard('Pending Deposits', stats.pendingDeposits || 0),
        createStatCard('Pending Withdrawals', stats.pendingWithdrawals || 0),
        createStatCard('Total Revenue', `₦${formatN(stats.totalRevenue || 0)}`)
      ].join('');

      renderDeposits((deposits.deposits || []).filter(d => d.status === 'pending' || d.status === 'needs_review'));
      renderWithdrawals((withdrawals.withdrawals || []).filter(w => w.status === 'pending'));
      renderUsers(users.users || []);
      renderAnnouncements(announcements.announcements || []);
      renderTransactions(transactions.transactions || []);
    } catch (err) {
      showToast(err.message || 'Failed to load admin queue', 'error');
    }
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if(!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if(!id) return;

    let reason = '';
    if(action.includes('reject')) {
      reason = window.prompt('Enter rejection reason:') || '';
      if(!reason.trim()) {
        showToast('A rejection reason is required.', 'warning');
        return;
      }
    }
    if(action === 'mark-withdrawal-paid' && !window.confirm('Only continue after you have manually sent this bank transfer to the verified account. Mark this withdrawal as paid?')) return;

    let endpoint = '';
    if(action === 'approve-deposit') endpoint = `/api/admin/deposits/${id}/approve`;
    if(action === 'reject-deposit') endpoint = `/api/admin/deposits/${id}/reject`;
    if(action === 'mark-withdrawal-paid') endpoint = `/api/admin/withdrawals/${id}/mark-paid`;
    if(action === 'reject-withdrawal') endpoint = `/api/admin/withdrawals/${id}/reject`;

    try {
      const options = { method: 'POST' };
      if(action.includes('reject')) {
        options.body = JSON.stringify({ reason });
      }
      await adminFetch(endpoint, options);
      showToast(action === 'mark-withdrawal-paid' ? 'Withdrawal marked paid.' : `${action.replace('-', ' ')} completed.`, 'success');
      await loadQueue();
    } catch (err) {
      showToast(err.message || 'Admin action failed', 'error');
    }
  });

  createAnnouncementBtn?.addEventListener('click', async () => {
    const title = document.getElementById('announcement-title')?.value.trim();
    const message = document.getElementById('announcement-message')?.value.trim();
    if(!title || !message){
      showToast('Both title and message are required', 'warning');
      return;
    }
    try {
      await adminFetch('/api/admin/announcements', {
        method: 'POST',
        body: JSON.stringify({ title, message, type: 'info' })
      });
      document.getElementById('announcement-title').value = '';
      document.getElementById('announcement-message').value = '';
      await loadQueue();
      showToast('Announcement created.', 'success');
    } catch (err) {
      showToast(err.message || 'Unable to create announcement', 'error');
    }
  });

  const depositSearchInput = document.getElementById('deposit-search-input');
  const depositSearchButton = document.getElementById('deposit-search-btn');
  const depositSearchClear = document.getElementById('deposit-search-clear');
  depositSearchButton?.addEventListener('click', async () => {
    const ref = depositSearchInput?.value.trim();
    if(!ref){
      showToast('Enter a MONETRIX reference to search.', 'warning');
      return;
    }
    try {
      const response = await adminFetch(`/api/admin/deposits/search?ref=${encodeURIComponent(ref)}`);
      renderDeposits((response.deposits || []).filter((deposit) => deposit.status === 'pending' || deposit.status === 'needs_review'));
    } catch(error) {
      showToast(error.message || 'Unable to search deposits.', 'error');
    }
  });
  depositSearchClear?.addEventListener('click', () => {
    if(depositSearchInput) depositSearchInput.value = '';
    loadQueue();
  });

  await loadQueue();
});
