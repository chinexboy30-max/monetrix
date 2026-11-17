document.addEventListener('DOMContentLoaded', async () => {
  const user = getUser();
  if(!user){ location.href = 'login.html'; return; }

  const greetingEl = document.getElementById('dashboard-greeting');
  const userNameEl = document.getElementById('dashboard-user-name');
  const walletCardsEl = document.getElementById('wallet-cards');
  const planCountdownContentEl = document.getElementById('plan-countdown-content');
  const announcementBannerEl = document.getElementById('announcement-banner');
  const announcementContentEl = document.getElementById('announcement-content');
  const notificationCountEl = document.getElementById('notification-count');
  const activePlanEl = document.getElementById('active-plan-details');
  const transactionsListEl = document.getElementById('transactions-list');
  const profilePic = document.getElementById('user-profile-picture');
  if(profilePic) profilePic.src = user.profilePicture || 'assets/logo/logo.jpeg';

  const roundedGreeting = new Date().getHours() < 12 ? 'Good Morning' : new Date().getHours() < 18 ? 'Good Afternoon' : 'Good Evening';
  if(greetingEl) greetingEl.textContent = roundedGreeting;
  if(userNameEl) userNameEl.textContent = user.fullName || 'MONETRIX INVEST user';

  let currentUser = user;
  try {
    const fresh = await api.getMe();
    if(fresh && fresh.user) {
      currentUser = fresh.user;
      saveUser(currentUser);
    }
  } catch (err) {
    console.warn('Using cached user state.', err);
  }

  function formatMoney(value){
    return `₦${formatN(value || 0)}`;
  }

  function renderWalletCards(data){
    const cards = [
      { label: 'Available Balance', value: formatMoney(data.balance || 0), type: 'balance' },
      { label: "Today's Earnings", value: formatMoney(data.earnings || 0), type: 'earnings' },
      { label: 'Login rewards', value: formatMoney(data.loginRewards || 0), type: 'login-rewards' },
      { label: 'Referral Earnings', value: formatMoney(data.refEarnings || 0), type: 'referral' },
      { label: 'Active investment plan', value: data.activePlan ? data.activePlan.name : 'No active plan', type: 'plan' }
    ];

    walletCardsEl.innerHTML = cards.map((card) => {
      const isBalance = card.type === 'balance';
      return `
        <article class="wallet-card">
          <div class="dashboard-wallet-inline">
            <div>
              <div class="muted">${card.label}</div>
              <div class="balance-amount ${isBalance ? 'balance-value' : ''}" data-balance-scale="${isBalance ? 'balance' : 'other'}">${card.value}</div>
            </div>
            ${isBalance ? '<button class="balance-toggle" type="button" id="toggle-balance-btn">Hide Balance</button>' : ''}
          </div>
        </article>`;
    }).join('');

    const balanceToggle = document.getElementById('toggle-balance-btn');
    if(balanceToggle){
      balanceToggle.addEventListener('click', () => {
        const shouldShow = balanceToggle.dataset.hidden === 'true';
        balanceToggle.dataset.hidden = shouldShow ? 'false' : 'true';
        balanceToggle.textContent = shouldShow ? 'Hide Balance' : 'Show Balance';
          document.querySelectorAll('[data-balance-scale="balance"]').forEach((el) => {
          el.classList.toggle('masked', !shouldShow);
          el.textContent = shouldShow ? formatMoney(data.balance || 0) : '••••••';
        });
      });
    }
  }

  function renderAnnouncements(items){
    const list = items || [];
    if(!list.length){
      announcementBannerEl.classList.add('hidden');
      return;
    }
    announcementBannerEl.classList.remove('hidden');
    announcementContentEl.innerHTML = list.map((item) => `<div><strong>${escapeHtml(item.title || 'MONETRIX INVEST update')}</strong> <div>${escapeHtml(item.message || '')}</div></div>`).join('');
  }

  function renderPlanCountdown(data){
    if(!planCountdownContentEl) return;
    if(!data.activePlan){
      planCountdownContentEl.innerHTML = '<div class="muted">No active investment plan. Choose a plan to start earning daily rewards.</div>';
      return;
    }

    const nextPayoutAt = Number(data.activePlan.nextPayoutAt) || Date.now();
    planCountdownContentEl.innerHTML = `
      <div class="plan-countdown-card">
        <div class="plan-countdown-header">
          <div>
            <span class="eyebrow">Next scheduled reward</span>
            <h3>${escapeHtml(data.activePlan.name || 'Investment plan')}</h3>
            <p class="muted">Automatic credit every 24 hours</p>
          </div>
          <span class="status-pill"><span class="status-dot status-dot--live"></span> Active</span>
        </div>
        <div class="countdown-caption">Next reward in</div>
        <div id="plan-countdown-timer" class="countdown-timer" aria-live="polite">
          <span class="countdown-unit" data-countdown-part="days"><strong>00</strong><small>Days</small></span>
          <span class="countdown-separator">:</span>
          <span class="countdown-unit" data-countdown-part="hours"><strong>00</strong><small>Hours</small></span>
          <span class="countdown-separator">:</span>
          <span class="countdown-unit" data-countdown-part="minutes"><strong>00</strong><small>Minutes</small></span>
          <span class="countdown-separator">:</span>
          <span class="countdown-unit" data-countdown-part="seconds"><strong>00</strong><small>Seconds</small></span>
        </div>
        <div class="countdown-progress" aria-label="Daily reward cycle progress"><span data-countdown-progress></span></div>
        <div class="plan-countdown-footer"><span>Daily reward</span><strong>${formatMoney(data.activePlan.daily || 0)}</strong></div>
      </div>`;

    const timerEl = document.getElementById('plan-countdown-timer');
    if(timerEl && typeof startCountdown === 'function'){
      startCountdown(nextPayoutAt, timerEl, async () => {
        try {
          const fresh = await api.getMe();
          if(fresh && fresh.user){
            currentUser = fresh.user;
            saveUser(currentUser);
            renderWalletCards(currentUser);
            renderActivePlan(currentUser);
            renderPlanCountdown(currentUser);
          }
        } catch (error) {
          console.error('Error refreshing investment plan countdown after payout', error);
        }
      }, { startAt: Number(data.activePlan.startedAt) });
    }
  }

  function renderTransactions(items){
    const list = (items || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6);
    if(!list.length){
      transactionsListEl.innerHTML = '<div class="muted">No transactions yet.</div>';
      return;
    }

    transactionsListEl.innerHTML = list.map((transaction) => {
      const type = transaction.type || 'transaction';
      const icon = type === 'deposit' ? '💳' : type === 'withdrawal' ? '🏦' : '✨';
      const isDebit = type === 'withdrawal' || type === 'wallet_debit' || type === 'plan_activation';
      const amountClass = isDebit ? 'negative' : 'positive';
      const sign = isDebit ? '-' : '+';
      return `
        <div class="transaction-row">
          <div class="transaction-left">
            <div class="transaction-icon">${icon}</div>
            <div class="transaction-meta">
              <strong>${escapeHtml(type)}</strong>
              <div class="muted">${new Date(transaction.createdAt || Date.now()).toLocaleDateString()}</div>
            </div>
          </div>
          <div class="transaction-right">
            <div class="transaction-amount ${amountClass}">${sign}${formatMoney(transaction.amount || 0)}</div>
            <div class="muted">${escapeHtml(transaction.status || 'pending')}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderActivePlan(data){
    if(!data.activePlan){
      activePlanEl.innerHTML = '<div class="muted">No active investment plan. Choose one from the Plans page.</div>';
      return;
    }
    activePlanEl.innerHTML = `<div><strong>${data.activePlan.name}</strong></div><div class="muted">Daily reward: ${formatMoney(data.activePlan.daily || 0)}</div>`;
  }

  async function loadDashboardData(){
    const [transactionsRes, announcementsRes, notificationsRes] = await Promise.all([
      api.getTransactions(),
      api.getAnnouncements(),
      api.getNotifications()
    ]);

    renderWalletCards(currentUser);
    renderAnnouncements(announcementsRes.announcements || []);
    renderPlanCountdown(currentUser);
    renderActivePlan(currentUser);
    renderTransactions(transactionsRes.transactions || []);
    notificationCountEl.textContent = (notificationsRes.notifications || []).length;
   // render notifications list for modal
   const notificationsListEl = document.getElementById('notifications-list');
   if(notificationsListEl){
     const notifs = (notificationsRes.notifications || []).slice(0, 50);
     notificationsListEl.innerHTML = notifs.length ? notifs.map(n => `
       <article class="note-panel" style="padding:8px; margin-bottom:8px;">
         <div><strong>${escapeHtml(n.title || 'Notification')}</strong></div>
         <div class="muted">${escapeHtml(n.text || '')}</div>
         <div class="muted" style="font-size:12px; margin-top:6px;">${new Date(n.createdAt || Date.now()).toLocaleString()}</div>
       </article>
     `).join('') : '<div class="muted">No notifications yet.</div>';
   }
  }
 
  await loadDashboardData();

  // Notifications modal wiring
  const notificationsButton = document.getElementById('notifications-button');
  const notificationsModal = document.getElementById('notifications-modal');
  const notificationsModalClose = document.getElementById('notifications-modal-close');
  notificationsButton?.addEventListener('click', () => { if(notificationsModal) notificationsModal.classList.remove('hidden'); });
  notificationsModalClose?.addEventListener('click', () => { if(notificationsModal) notificationsModal.classList.add('hidden'); });

  const communityModal = document.getElementById('community-modal');
  const shouldShowCommunity = localStorage.getItem('monetrix_show_community') === '1' && !localStorage.getItem('monetrix_community_dismissed');
  if(communityModal && shouldShowCommunity){
    communityModal.classList.remove('hidden');
  }

  const closeModal = () => {
    communityModal?.classList.add('hidden');
    localStorage.setItem('monetrix_community_dismissed', '1');
    localStorage.removeItem('monetrix_show_community');
  };

  document.getElementById('community-modal-close')?.addEventListener('click', closeModal);
  document.getElementById('dismiss-community')?.addEventListener('click', closeModal);
  communityModal?.addEventListener('click', (event) => {
    if(event.target === communityModal) closeModal();
  });
});
