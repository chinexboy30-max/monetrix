async function loadVIPPlans(){
  const response = await apiFetch(`${API_BASE}/vips`);
  return Array.isArray(response.plans) ? response.plans : [];
}

function planCurrency(value){
  return `₦${formatN(value)}`;
}

async function renderVIPList(){
  const list = document.getElementById('vip-list') || document.getElementById('vip-preview');
  if(!list) return;

  list.innerHTML = '<div class="loading-state"><span class="loader"></span> Loading investment plans…</div>';
  try {
    const plans = await loadVIPPlans();
    if(!plans.length){
      list.innerHTML = '<div class="empty-state">Investment plans are currently unavailable.</div>';
      return;
    }

    let user = null;
    if(getUser()){
      try {
        const response = await api.getMe();
        user = response.user || null;
        if(user) saveUser(user);
      } catch { /* Public preview pages do not require an active session. */ }
    }

    const isPreviewPage = !document.getElementById('vip-list');
    list.innerHTML = plans.map((plan) => {
      const active = user?.activePlan?.id === plan.id;
      return `
        <article class="vip-card card ${active ? 'is-active' : ''}">
          <div class="vip-card-topline">
            <span class="plan-badge">${active ? 'Active plan' : 'Investment plan'}</span>
            <span class="plan-index">${escapeHtml(String(plan.tier ?? plan.id).padStart(2, '0'))}</span>
          </div>
          <h3>${escapeHtml(plan.name)}</h3>
          <div class="plan-price">${planCurrency(plan.deposit)}</div>
          <div class="plan-return"><span>Daily reward</span><strong>${planCurrency(plan.daily)}</strong></div>
          <div class="plan-footnote">Backend configured plan · Rewards are managed by your account.</div>
          <button class="btn ${isPreviewPage ? 'ghost vip-preview' : 'primary buy-vip'}" data-id="${plan.id}">
            ${isPreviewPage ? 'View after login' : active ? 'Current plan' : 'Activate plan'}
          </button>
        </article>`;
    }).join('');

    list.querySelectorAll('.buy-vip').forEach((button) => {
      button.addEventListener('click', async () => {
        const stopLoading = setLoading(button, true);
        try {
          const current = (await api.getMe()).user;
          if(!current) throw new Error('Please log in to continue.');
          if(current.activePlan) throw new Error('Only one investment plan can be active at a time.');
          const plan = plans.find((item) => Number(item.id) === Number(button.dataset.id));
          if(!plan) throw new Error('This investment plan is no longer available.');
          if(Number(current.balance || 0) < Number(plan.deposit || 0)) throw new Error('Insufficient available balance for this plan.');
          const response = await api.buyVip({ planId: plan.id });
          if(response.user) saveUser(response.user);
          showToast(`${plan.name} is now active.`, 'success');
          setTimeout(() => { location.href = 'dashboard.html'; }, 700);
        } catch(error) {
          showToast(error.message || 'Unable to activate this plan.', 'error');
        } finally {
          stopLoading();
        }
      });
    });

    list.querySelectorAll('.vip-preview').forEach((button) => {
      button.addEventListener('click', () => {
        location.href = 'login.html';
      });
    });
  } catch(error) {
    list.innerHTML = '<div class="empty-state">We could not load the investment plans. Please refresh and try again.</div>';
    showToast(error.message || 'Unable to load investment plans.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', renderVIPList);
