function startCountdown(endsAt, el, onComplete, options = {}){
  let timerId = null;
  let completed = false;
  const parts = {
    days: el.querySelector('[data-countdown-part="days"] strong'),
    hours: el.querySelector('[data-countdown-part="hours"] strong'),
    minutes: el.querySelector('[data-countdown-part="minutes"] strong'),
    seconds: el.querySelector('[data-countdown-part="seconds"] strong')
  };
  const progress = el.querySelector('[data-countdown-progress]');
  const startAt = Number(options.startAt) || Number(endsAt) - 24 * 60 * 60 * 1000;

  function tick(){
    const diff = Math.max(0, Number(endsAt) - Date.now());
    const totalSeconds = Math.floor(diff / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hasParts = Object.values(parts).every(Boolean);

    if(hasParts){
      parts.days.textContent = String(days).padStart(2, '0');
      parts.hours.textContent = String(hours).padStart(2, '0');
      parts.minutes.textContent = String(minutes).padStart(2, '0');
      parts.seconds.textContent = String(seconds).padStart(2, '0');
    } else {
      const totalHours = Math.floor(totalSeconds / 3600);
      el.textContent = `${String(totalHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    if(progress){
      const duration = Math.max(1, Number(endsAt) - startAt);
      const elapsed = Math.min(duration, Math.max(0, Date.now() - startAt));
      progress.style.width = `${Math.round((elapsed / duration) * 100)}%`;
    }

    if(diff <= 0 && !completed){
      completed = true;
      if(timerId) clearInterval(timerId);
      if(onComplete) onComplete();
    }
  }

  tick();
  timerId = setInterval(tick, 1000);
  return timerId;
}
