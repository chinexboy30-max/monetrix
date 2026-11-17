document.addEventListener('DOMContentLoaded', async () => {
  const includes = Array.from(document.querySelectorAll('[data-include]'));
  await Promise.all(includes.map(async (element) => {
    try {
      const response = await fetch(element.dataset.include);
      if(response.ok) element.innerHTML = await response.text();
    } catch(error) {
      console.error('Component include failed', error);
    }
  }));

  const page = window.location.pathname.split('/').pop() || 'index.html';
  const appPages = ['dashboard.html', 'deposit.html', 'withdraw.html', 'vip.html', 'profile.html', 'referral.html'];
  const hasSession = () => {
    try { return Boolean(JSON.parse(localStorage.getItem('monetrix_user') || 'null')?.id); }
    catch { return false; }
  };
  const nav = document.querySelector('.bottom-nav');
  if(nav && appPages.includes(page) && hasSession()) nav.classList.add('visible');
  nav?.querySelectorAll('.nav-item').forEach((item) => {
    const target = item.getAttribute('href');
    if(target === page) item.classList.add('active');
  });

  document.addEventListener('click', async (event) => {
    const logout = event.target.closest('#logout, #logout-btn');
    if(!logout) return;
    logout.disabled = true;
    try { await window.api?.logout?.(); } catch(error) { console.warn('Logout request failed', error); }
    localStorage.removeItem('monetrix_user');
    localStorage.removeItem('monetrix_show_community');
    localStorage.removeItem('monetrix_community_dismissed');
    location.href = 'login.html';
  });
});
