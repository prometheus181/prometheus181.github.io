const FADE_MS = 800;

const SHOW_EVERY_VISIT = true;

const splash = document.getElementById("splash");

(function() {
  if (!splash) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("rm");
  const seen = !SHOW_EVERY_VISIT && sessionStorage.getItem("ken-splash-seen");
  if (reducedMotion || seen) {
    splash.remove();
    return;
  }
  sessionStorage.setItem("ken-splash-seen", "1");
  let leaving = false;
  function enter() {
    if (leaving) return;
    leaving = true;
    splash.style.transition = "opacity 0.8s ease, background-color 0.7s ease";
    splash.style.backgroundColor = "#000";
    splash.classList.add("leaving");
    setTimeout(() => splash.remove(), FADE_MS);
    window.removeEventListener("keydown", enter);
  }
  splash.addEventListener("click", enter);
  window.addEventListener("keydown", enter);
  splash.focus();
  (function() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const stack = splash.querySelector(".spin-stack");
    const markupBase = stack && stack.querySelector("video");
    if (!stack || !markupBase) return;
    const SRC = markupBase.getAttribute("src");
    const BLUR_SRCS = [ "assets/enter-blur-1.mp4?v=a52362d9", "assets/enter-blur-2.mp4?v=fb4993ab", "assets/enter-blur-3.mp4?v=4e4d2d00", "assets/enter-blur-4.mp4?v=1d316201" ];
    const MAX_SPEED = 4;
    const EASE = .12;
    const SWAP_LEAD = .07;
    function makeVideo(src) {
      const v = document.createElement("video");
      v.src = src;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      return v;
    }
    function makeCopy(baseVideo) {
      const root = document.createElement("div");
      root.className = "spin-copy";
      const videos = [ baseVideo ];
      root.appendChild(baseVideo);
      return {
        root: root,
        videos: videos,
        ready: [ false ]
      };
    }
    const A = makeCopy(markupBase);
    A.ready[0] = true;
    const B = makeCopy(makeVideo(SRC));
    B.videos[0].addEventListener("canplay", function() {
      B.ready[0] = true;
    }, {
      once: true
    });
    stack.appendChild(A.root);
    stack.appendChild(B.root);
    B.root.style.opacity = "0";
    let active = A, standby = B;
    let swapPending = false;
    function addBlurLayers(copy) {
      BLUR_SRCS.forEach(function(src) {
        const v = makeVideo(src);
        const idx = copy.videos.length;
        copy.ready[idx] = false;
        v.addEventListener("canplay", function() {
          copy.ready[idx] = true;
        }, {
          once: true
        });
        copy.root.appendChild(v);
        copy.videos[idx] = v;
      });
    }
    window.addEventListener("load", function() {
      addBlurLayers(A);
      addBlurLayers(B);
      if (!frozen) A.videos.slice(1).forEach(function(v) {
        v.play().catch(function() {});
      });
    });
    const VMAX = 1.6;
    const VEL_DECAY = .95;
    let targetSpeed = 0;
    let speed = 0;
    let frozen = false;
    let lastGlow = "";
    function setRate(v, r) {
      if (v._rate !== r) {
        v._rate = r;
        try {
          v.playbackRate = r;
        } catch (e) {}
      }
    }
    function setOp(v, o) {
      if (v._op !== o) {
        v._op = o;
        v.style.opacity = o;
      }
    }
    let vel = 0;
    let lastX = null, lastY = 0, lastT = 0;
    splash.addEventListener("pointermove", function(e) {
      const t = performance.now();
      if (lastX !== null) {
        const dt = Math.max(8, t - lastT);
        const v = Math.hypot(e.clientX - lastX, e.clientY - lastY) / dt;
        if (v > vel) vel = Math.min(v, VMAX);
      }
      lastX = e.clientX;
      lastY = e.clientY;
      lastT = t;
    });
    splash.addEventListener("pointerleave", function() {
      vel = 0;
      lastX = null;
    });
    function beginSwap() {
      swapPending = true;
      const s = standby;
      const sBase = s.videos[0];
      try {
        s.videos.forEach(function(v, i) {
          if (!s.ready[i]) return;
          setRate(v, Math.max(.0625, speed));
          v.play().catch(function() {});
        });
      } catch (e) {
        swapPending = false;
        return;
      }
      const flip = function() {
        s.root.style.opacity = "1";
        active.root.style.opacity = "0";
        const old = active;
        active = s;
        standby = old;
        setTimeout(function() {
          old.videos.forEach(function(v) {
            try {
              v.pause();
              v.currentTime = 0;
            } catch (e) {}
          });
          swapPending = false;
        }, 80);
      };
      if (sBase.requestVideoFrameCallback) sBase.requestVideoFrameCallback(flip); else sBase.addEventListener("playing", flip, {
        once: true
      });
    }
    (function tick() {
      if (leaving) return;
      vel *= VEL_DECAY;
      const IDLE = 1;
      targetSpeed = IDLE + (MAX_SPEED - IDLE) * Math.pow(vel / VMAX, .7);
      speed += (targetSpeed - speed) * EASE;
      {
        const u = Math.max(0, (speed - 1) / (MAX_SPEED - 1));
        const glow = (1 + .9 * Math.pow(u, 1.1)).toFixed(3);
        if (glow !== lastGlow) {
          lastGlow = glow;
          stack.style.filter = "brightness(" + glow + ")";
        }
      }
      const base = active.videos[0];
      if (speed === 0) {
        if (!frozen) {
          frozen = true;
          active.videos.forEach(function(v) {
            try {
              v.pause();
            } catch (e) {}
          });
        }
      } else {
        if (frozen) {
          frozen = false;
          active.videos.forEach(function(v, i) {
            if (i === 0 || active.ready[i]) v.play().catch(function() {});
          });
        }
        setRate(base, Math.max(.0625, speed));
      }
      const t0 = base.currentTime;
      const dur = base.duration || 0;
      if (dur > 0 && !swapPending && standby.ready[0] && speed > .05 && (dur - t0) / speed < SWAP_LEAD) beginSwap();
      const nLayers = active.videos.length;
      const b = Math.max(0, (speed - 1) / (MAX_SPEED - 1)) * (nLayers - 1);
      const lo = Math.floor(b);
      const frac = b - lo;
      for (let i = 1; i < nLayers; i++) {
        const v = active.videos[i];
        if (!v || !active.ready[i]) continue;
        const opN = i === lo ? 1 - frac : i === lo + 1 ? frac : 0;
        const op = opN.toFixed(3);
        setOp(v, op);
        if (standby.videos[i]) setOp(standby.videos[i], op);
        if (!frozen && dur > 0) {
          let drift = v.currentTime - t0;
          if (drift > dur / 2) drift -= dur;
          if (drift < -dur / 2) drift += dur;
          if (Math.abs(drift) > .4 && opN < .03) {
            v.currentTime = t0;
            setRate(v, Math.max(.0625, speed));
          } else {
            const nudge = Math.max(-.1, Math.min(.1, -drift * 1.5));
            setRate(v, Math.max(.0625, Math.round(speed * (1 + nudge) * 500) / 500));
          }
        }
      }
      requestAnimationFrame(tick);
    })();
  })();
})();
