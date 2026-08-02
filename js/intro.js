(function() {
  const splash = document.getElementById("splash");
  const face = document.getElementById("ascii-face");
  const FACE = window.ASCII_FACE;
  if (!splash || !face || !FACE || !FACE.frames) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("rm")) return;
  document.documentElement.classList.add("intro-pending");
  window.__faceHold = true;
  const overlay = document.createElement("div");
  overlay.id = "term-intro";
  overlay.setAttribute("aria-hidden", "true");
  const line = document.createElement("pre");
  line.style.opacity = "0";
  const text = document.createElement("span");
  const caret = document.createElement("span");
  caret.className = "term-caret";
  caret.textContent = "█";
  line.appendChild(text);
  line.appendChild(caret);
  overlay.appendChild(line);
  document.body.appendChild(overlay);
  const skip = false;
  function wait(ms) {
    return new Promise(function(res) {
      if (skip) return res();
      const t0 = performance.now();
      (function step(now) {
        if (skip || now - t0 >= ms) return res();
        requestAnimationFrame(step);
      })(t0);
    });
  }
  async function typeText(s, ms) {
    for (let i = 1; i <= s.length && !skip; i++) {
      text.textContent = s.slice(0, i);
      await wait(ms);
    }
    if (skip) text.textContent = "";
  }
  async function backspace(ms) {
    while (text.textContent.length && !skip) {
      text.textContent = text.textContent.slice(0, -1);
      await wait(ms);
    }
    text.textContent = "";
  }
  function cleanup() {
    document.documentElement.classList.remove("intro-pending");
    window.__faceHold = false;
    if (window.__faceWake) window.__faceWake();
    const rows = face.children;
    for (let r = 0; r < rows.length; r++) rows[r].style.visibility = "";
    overlay.remove();
  }
  async function run() {
    line.style.opacity = "1";
    await wait(850);
    await typeText("Welcome", 85);
    await wait(750);
    await backspace(38);
    await wait(400);
    cleanup();
  }
  let started = false;
  const arm = new MutationObserver(function() {
    if (started) return;
    if (splash.classList.contains("leaving") || !document.body.contains(splash)) {
      started = true;
      arm.disconnect();
      setTimeout(run, 800);
    }
  });
  arm.observe(splash, {
    attributes: true,
    attributeFilter: [ "class" ]
  });
  arm.observe(document.body, {
    childList: true
  });
})();
