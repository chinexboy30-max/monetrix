document.addEventListener('DOMContentLoaded', async () => {
  if(!requireAuth()) return;

  const form = document.getElementById('paystack-deposit-form');
  const amountInput = document.getElementById('deposit-amount');
  const emailInput = document.getElementById('deposit-email');
  const statusPanel = document.getElementById('deposit-payment-status');
  const statusMessage = document.getElementById('deposit-payment-message');
  const referenceLabel = document.getElementById('deposit-payment-reference');
  const verifyButton = document.getElementById('verify-payment-status');
  let paymentReference = null;

  function showPaymentStatus(message, reference = paymentReference, canRetry = false){
    statusPanel.classList.remove('hidden');
    statusMessage.textContent = message;
    referenceLabel.textContent = reference ? `Payment reference: ${reference}` : '';
    verifyButton.classList.toggle('hidden', !canRetry);
  }

  async function verifyPayment(reference){
    paymentReference = reference;
    verifyButton.classList.remove('hidden');
    verifyButton.disabled = true;
    verifyButton.textContent = 'Checking with Paystack…';
    try{
      const response = await api.verifyPaystackPayment({ reference });
      const status = response.payment && response.payment.status;
      const messages = {
        success: 'Paystack verified your payment. Your deposit is pending operations approval; your wallet has not been credited yet.',
        failed: 'Paystack reports that this payment failed. No wallet credit was made.',
        cancelled: 'This Paystack checkout was cancelled. No wallet credit was made.',
        needs_review: 'The payment details did not match the expected amount or currency. It has been held for review; no wallet credit was made.',
        pending: 'Paystack has not confirmed this payment yet. You can check again shortly.'
      };
      showPaymentStatus(messages[status] || 'The payment status is not yet confirmed. You can check again shortly.', reference, status !== 'success');
      if(status === 'success') showToast('Payment verified. Awaiting operations approval.', 'success');
      else if(status === 'failed' || status === 'cancelled' || status === 'needs_review') showToast(messages[status], 'warning');
    }catch(error){
      showPaymentStatus(error.message || 'Unable to verify this payment. Try checking again.', reference, true);
      showToast(error.message || 'Unable to verify the payment.', 'error');
    }finally{
      verifyButton.disabled = false;
      verifyButton.textContent = 'Check payment status';
    }
  }

  const callbackParams = new URLSearchParams(window.location.search);
  const returnedReference = callbackParams.get('reference')
    || callbackParams.get('trxref')
    || sessionStorage.getItem('monetrix_paystack_reference');
  if(returnedReference){
    const validReference = /^[A-Za-z0-9._-]{8,100}$/.test(returnedReference);
    if(validReference){
      showPaymentStatus('Checking your payment directly with Paystack…', returnedReference, true);
      history.replaceState(null, '', window.location.pathname);
      await verifyPayment(returnedReference);
    }else{
      showPaymentStatus('The returned payment reference is invalid.', returnedReference);
    }
  }

  verifyButton.addEventListener('click', () => {
    if(paymentReference) verifyPayment(paymentReference);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(amountInput.value);
    const email = emailInput.value.trim();
    if(!Number.isSafeInteger(amount) || amount < 100){
      showToast('Enter a whole-naira amount of at least ₦100.', 'warning');
      amountInput.focus();
      return;
    }
    if(!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      showToast('Enter a valid email address for your Paystack receipt.', 'warning');
      emailInput.focus();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    const stopLoading = setLoading(button, true);
    try{
      const response = await api.initializePaystackPayment({ amount, email });
      const checkoutUrl = new URL(response.authorizationUrl);
      if(checkoutUrl.origin !== 'https://checkout.paystack.com'){
        throw new Error('The checkout address returned by the server is invalid.');
      }
      paymentReference = response.reference;
      sessionStorage.setItem('monetrix_paystack_reference', paymentReference);
      location.assign(checkoutUrl.toString());
    }catch(error){
      showToast(error.message || 'Unable to start Paystack checkout.', 'error');
    }finally{
      stopLoading();
    }
  });
});
