(function () {
  const splash = document.getElementById('splash');
  const face = document.getElementById('ascii-face');
  const FACE = window.ASCII_FACE;
  if (!splash || !face || !FACE || !FACE.frames) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('intro-pending');

  const overlay = document.createElement('div');
  overlay.id = 'term-intro';
  overlay.setAttribute('aria-hidden', 'true');
  const line = document.createElement('pre');
  line.textContent = 'Welcome';
  line.style.opacity = '0';
  line.style.transition = 'opacity 300ms ease';
  overlay.appendChild(line);
  document.body.appendChild(overlay);

  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  function cleanup() {
    document.documentElement.classList.remove('intro-pending');
    overlay.remove();
  }

  async function run() {
    line.style.opacity = '1';
    await wait(300 + 500);
    line.style.opacity = '0';
    await wait(300 + 100);
    cleanup();
    window.dispatchEvent(new Event('intro:done'));
  }

  let started = false;
  function check() {
    if (started) return;
    if (splash.classList.contains('leaving') || !document.body.contains(splash)) {
      started = true;
      arm.disconnect();
      setTimeout(run, 300);
    }
  }
  const arm = new MutationObserver(check);
  arm.observe(splash, { attributes: true, attributeFilter: ['class'] });
  arm.observe(document.body, { childList: true });
  check();
})();
