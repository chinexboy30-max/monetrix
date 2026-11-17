document.addEventListener('DOMContentLoaded', async () => {
  if(!requireAuth()) return;
  const refLinkEl = document.getElementById('ref-link');
  const countEl = document.getElementById('ref-count');
  const earnEl = document.getElementById('ref-earn');
  try {
    const response = await api.getMe();
    const user = response.user;
    if(user) {
      saveUser(user);
      const link = user.referralLink || `${window.location.origin}/register.html?ref=${encodeURIComponent(user.referralCode || '')}`;
      if(refLinkEl) refLinkEl.value = link;
      if(countEl) countEl.textContent = `Referrals: ${user.referrals || 0}`;
      if(earnEl) earnEl.textContent = `Referral earnings: ₦${formatN(user.refEarnings || 0)}`;
    }
  } catch(error) {
    showToast(error.message || 'Unable to load referral details.', 'error');
  }

  document.getElementById('copy-ref')?.addEventListener('click', async () => {
    if(!refLinkEl?.value) return;
    try { await navigator.clipboard.writeText(refLinkEl.value); showToast('Referral link copied.', 'success'); }
    catch { showToast('Unable to copy the referral link.', 'warning'); }
  });
});
