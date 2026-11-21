document.addEventListener('DOMContentLoaded', async ()=>{
  let u = null;
  try{
    const res = await api.getMe();
    if(res && res.user){ u = res.user; saveUser(res.user); }
  }catch(err){ u = getUser(); }
  if(!u) { location.href = 'login.html'; return; }

  const avail = document.getElementById('available-balance'); if(avail) avail.textContent = formatN((u && u.balance) || 0);
  const withdrawStatus = document.getElementById('withdraw-status');
  const form = document.getElementById('withdraw-form');
  const submitBtn = form?.querySelector('button[type="submit"]');
  const verifyBtn = document.getElementById('verify-account');
  const scheduleStatus = document.getElementById('withdraw-schedule-status');

  async function refreshWithdrawalAvailability(){
    try{
      const availability = await api.getWithdrawalAvailability();
      if(scheduleStatus) scheduleStatus.textContent = availability.message;
      if(submitBtn) submitBtn.disabled = !availability.available;
      return availability;
    }catch(error){
      console.error('Unable to load withdrawal schedule:', error);
      if(scheduleStatus) scheduleStatus.textContent = 'Unable to check the withdrawal schedule. Please refresh the page before submitting a request.';
      if(submitBtn) submitBtn.disabled = false;
      return null;
    }
  }

  await refreshWithdrawalAvailability();

  if(!u.activePlan){
    if(withdrawStatus){
      withdrawStatus.style.display = 'block';
    }
    if(form){
      form.querySelectorAll('input, button, select').forEach(el => el.disabled = true);
      if(submitBtn) submitBtn.textContent = 'Activate a plan to withdraw';
    }
    return;
  }

  if(withdrawStatus) withdrawStatus.style.display = 'none';
  window.setInterval(refreshWithdrawalAvailability, 60 * 1000);

  // Account verification flow
  verifyBtn?.addEventListener('click', async ()=>{
    const bank = document.getElementById('bank-name').value.trim();
    const acctNo = document.getElementById('account-number').value.trim();
    const acctNameEl = document.getElementById('account-name');
    const verIdEl = document.getElementById('verification-id');
    if(!bank){ showToast('Please select a bank', 'warning'); return; }
    if(!/^\d{10}$/.test(acctNo)){ showToast('Account number must be exactly 10 digits', 'warning'); return; }
    try{
      const res = await api.verifyAccount({ bankName: bank, accountNumber: acctNo });
      if(res && res.success){
        if(acctNameEl) acctNameEl.value = res.accountName || '';
        if(verIdEl) verIdEl.value = res.verificationId || '';
        showToast(`Account verified for ${res.userPhone || 'your registered number'}`, 'success');
      }else{
        showToast(res.message || 'Unable to verify account details. Please check the bank and account number.', 'error');
      }
    }catch(err){ console.error(err); showToast(err.message || 'Verification failed', 'error'); }
  });

  if(!form) return;
  form.addEventListener('submit', async e=>{
    e.preventDefault();
    const availability = await refreshWithdrawalAvailability();
    if(!availability){
      showToast('Unable to check the withdrawal schedule. Please try again.', 'error');
      return;
    }
    if(!availability.available){
      showToast(availability.message, 'warning');
      return;
    }
    const button = submitBtn;
    const stopLoading = setLoading(button, true);
    const amt = Number(document.getElementById('withdraw-amount').value);
    const bank = document.getElementById('bank-name').value.trim();
    const acctNo = document.getElementById('account-number').value.trim();
    const acctName = document.getElementById('account-name').value.trim();
    const verificationId = document.getElementById('verification-id').value;
    if(!amt || amt <= 0){ stopLoading(); showToast('Enter a valid amount', 'warning'); return; }
    if(amt < 1000){ stopLoading(); showToast('Minimum withdrawal amount is ₦1,000', 'warning'); return; }
    if(amt > (u.balance||0)){ stopLoading(); showToast('Insufficient balance', 'warning'); return; }
    if(!bank || !acctNo){ stopLoading(); showToast('Please complete your bank details', 'warning'); return; }
    if(!/^\d{10}$/.test(acctNo)){ stopLoading(); showToast('Account number must be exactly 10 digits', 'warning'); return; }
    if(!verificationId){ stopLoading(); showToast('Please verify the account before submitting the withdrawal request', 'warning'); return; }
    try{
      const res = await api.withdraw({ amount: amt, bankName: bank, accountNumber: acctNo, verificationId });
      if(res && res.withdrawal){
        showToast('Withdrawal request submitted.', 'success');
        setTimeout(()=> location.href = 'dashboard.html', 800);
      }else{
        showToast('Withdrawal submission failed', 'error');
      }
    }catch(err){ console.error(err); showToast(err.message || 'Withdrawal failed', 'error'); }
    stopLoading();
  });
});
