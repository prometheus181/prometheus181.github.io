(function () {
  const pre = document.getElementById('amoeba-logo');
  const LOGO = window.ASCII_LOGO;
  if (!pre || !LOGO || !LOGO.frames.length) return;
  let i = 0;

  function fit() {
    const probe = document.createElement('span');
    probe.style.fontSize = '100px';
    probe.textContent = 'M'.repeat(10);
    pre.textContent = '';
    pre.appendChild(probe);
    const adv = probe.getBoundingClientRect().width / 1000;
    pre.removeChild(probe);
    const fs = pre.clientWidth / (LOGO.cols * adv);
    pre.style.fontSize = fs + 'px';
    pre.style.lineHeight = (2 * adv * fs) + 'px';
    pre.textContent = LOGO.frames[i];
  }

  fit();
  addEventListener('resize', fit);

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const step = 1000 / LOGO.fps;
  let last = performance.now();
  (function tick(now) {
    if (now - last >= step) {
      last = now - ((now - last) % step);
      i = (i + 1) % LOGO.frames.length;
      pre.textContent = LOGO.frames[i];
    }
    requestAnimationFrame(tick);
  })(last);
})();
