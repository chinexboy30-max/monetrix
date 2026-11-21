// Registration and login using the api wrapper (falls back to localStorage when backend is disabled)
document.addEventListener('DOMContentLoaded', ()=>{
  const reg = document.getElementById('register-form');
  if(reg){
    // If the page was opened with a ?ref=... query param, prefill the referral input
    try{
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if(ref){ const refEl = document.getElementById('referralCode'); if(refEl) refEl.value = ref; }
    }catch(e){ /* ignore */ }

    reg.addEventListener('submit', async e=>{
      e.preventDefault();
      const button = reg.querySelector('button[type="submit"]');
      const stopLoading = setLoading(button, true);
      const fullName = document.getElementById('fullName').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const password = document.getElementById('password').value;
      const referralCode = (document.getElementById('referralCode') && document.getElementById('referralCode').value.trim()) || undefined;
      if(!fullName||!phone||!password){ stopLoading(); showToast('Please fill all fields', 'warning'); return; }
      const phoneDigits = phone.replace(/[\s\-()]/g, '');
      const isValidPhone = /^0\d{10}$/.test(phoneDigits) || /^\+234\d{10}$/.test(phoneDigits);
      if(!isValidPhone){ stopLoading(); showToast('Enter a valid Nigerian phone number, e.g. 08012345678', 'warning'); return; }
      try{
        const payload = { fullName, phone, password };
        if(referralCode) payload.referralCode = referralCode;
        const res = await api.register(payload);
        if(res && res.user) saveUser(res.user);
        localStorage.setItem('monetrix_show_community', '1');
        showToast('Your account is ready. Welcome to MONETRIX INVEST.', 'success');
        setTimeout(()=> location.href = 'dashboard.html', 800);
      }catch(err){
        console.error(err);
        showToast(err.message || 'Registration failed', 'error');
      }finally{ stopLoading(); }
    });
  }

  const login = document.getElementById('login-form');
  if(login){
    login.addEventListener('submit', async e=>{
      e.preventDefault();
      const button = login.querySelector('button[type="submit"]');
      const stopLoading = setLoading(button, true);
      const phone = document.getElementById('phone').value.trim();
      const password = document.getElementById('password').value;
      try{
        const res = await api.login({ phone, password });
        if(res && res.user) saveUser(res.user);
        localStorage.setItem('monetrix_show_community', '1');
        location.href = 'dashboard.html';
      }catch(err){
        console.error(err);
        showToast(err.message || 'Invalid credentials', 'error');
      }finally{ stopLoading(); }
    });
  }
});
