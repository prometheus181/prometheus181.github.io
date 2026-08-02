(function() {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.documentElement.classList.add("ascii-cursor");
  const layer = document.createElement("div");
  layer.id = "cursor-layer";
  layer.setAttribute("aria-hidden", "true");
  const canvas = document.createElement("canvas");
  canvas.id = "cursor-canvas";
  layer.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dot = document.createElement("span");
  dot.className = "cursor-dot";
  layer.appendChild(dot);
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d", {
    willReadFrequently: true
  });
  let mem = null, hold = null;
  let field = null, tmpF = null;
  let mRect = null, mw = 0, mh = 0;
  let cenC = 0, cenR = 0;
  let maskOn = false;
  let sampleFlip = false;
  let lastSampleT = 0;
  const HOLD_MS = 300;
  const RELEASE_MS = 180;
  function visibleSpinVideo() {
    const copies = document.querySelectorAll("#splash .spin-copy");
    for (let i = 0; i < copies.length; i++) {
      if (copies[i].style.opacity !== "0") {
        const v = copies[i].querySelector("video");
        if (v) return v;
      }
    }
    return document.querySelector("#splash video");
  }
  const SP = 16;
  const INF = 55;
  const HEAT_MS = 450;
  const COOL_MS = 2600;
  const BASE_R = 1, GROW_R = .5;
  const BASE_A = .2, GROW_A = 0;
  const PUSH = 12;
  const SPRING = 90;
  const DAMP = 9;
  const KICK = 2.2;
  const MPUSH = 12;
  const DEEP = .55;
  const GONE_MS = 140;
  let nx = 0, ny = 0, heat = null;
  let offX = null, offY = null, velX = null, velY = null;
  let gone = null;
  let calm = false;
  function sizeField() {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    nx = Math.ceil(innerWidth / SP);
    ny = Math.ceil(innerHeight / SP);
    heat = new Float32Array(nx * ny);
    offX = new Float32Array(nx * ny);
    offY = new Float32Array(nx * ny);
    velX = new Float32Array(nx * ny);
    velY = new Float32Array(nx * ny);
    gone = new Float32Array(nx * ny);
    calm = false;
  }
  function warm(x, y, ms) {
    const c0 = Math.max(0, Math.floor((x - INF) / SP));
    const c1 = Math.min(nx - 1, Math.floor((x + INF) / SP));
    const r0 = Math.max(0, Math.floor((y - INF) / SP));
    const r1 = Math.min(ny - 1, Math.floor((y + INF) / SP));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c * SP + SP / 2 - x, r * SP + SP / 2 - y);
        if (d >= INF) continue;
        const f = 1 - d / INF;
        const i = r * nx + c;
        heat[i] = Math.min(1, heat[i] + f * f * (ms / HEAT_MS));
      }
    }
  }
  let mx = innerWidth / 2, my = innerHeight / 2;
  let px = null, py = 0;
  let inside = false;
  let hot = false;
  let pulse = 1;
  addEventListener("pointermove", function(e) {
    mx = e.clientX;
    my = e.clientY;
    if (!inside) {
      dot.style.opacity = "1";
      inside = true;
      px = mx;
      py = my;
    }
  }, {
    passive: true
  });
  addEventListener("pointerdown", function() {
    pulse = .7;
  });
  addEventListener("pointerover", function(e) {
    hot = !!(e.target && e.target.closest && e.target.closest("a, button, .spin-stack"));
  }, {
    passive: true
  });
  document.addEventListener("mouseleave", function() {
    dot.style.opacity = "0";
    inside = false;
    px = null;
  });
  addEventListener("resize", sizeField);
  document.body.appendChild(layer);
  sizeField();
  let prev = performance.now();
  (function tick(now) {
    const dt = Math.min(50, now - prev);
    prev = now;
    pulse += (1 - pulse) * .18 * (dt / 16.7);
    dot.style.transform = "translate3d(" + mx + "px," + my + "px,0) translate(-50%,-50%)" + " scale(" + ((hot ? 1.5 : 1) * pulse).toFixed(3) + ")";
    const splashEl = document.getElementById("splash");
    const fieldOn = !!splashEl && !splashEl.classList.contains("leaving");
    const wantOp = fieldOn ? "1" : "0";
    if (canvas._op !== wantOp) {
      canvas._op = wantOp;
      canvas.style.opacity = wantOp;
    }
    if (!fieldOn) {
      requestAnimationFrame(tick);
      return;
    }
    const dts = dt / 1e3;
    let cvx = 0, cvy = 0;
    if (inside && px !== null && dts > 0) {
      const cap = 1500;
      cvx = Math.max(-cap, Math.min(cap, (mx - px) / dts));
      cvy = Math.max(-cap, Math.min(cap, (my - py) / dts));
    }
    if (inside && px !== null) {
      const dx = mx - px, dy = my - py;
      const d = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(d / 12));
      for (let s = 1; s <= steps; s++) {
        warm(px + dx * s / steps, py + dy * s / steps, dt / steps);
      }
      px = mx;
      py = my;
    }
    let active = false;
    const vid = visibleSpinVideo();
    if (vid && vid.readyState >= 2) {
      const b = vid.getBoundingClientRect();
      if (b.width > 1) {
        mRect = b;
        const advancing = !vid.paused && !vid.ended;
        sampleFlip = !sampleFlip;
        if (advancing && sampleFlip || !maskOn) {
          mw = 72;
          mh = Math.max(1, Math.round(mw * b.height / b.width));
          if (mask.width !== mw || mask.height !== mh) {
            mask.width = mw;
            mask.height = mh;
          }
          try {
            mctx.drawImage(vid, 0, 0, mw, mh);
            const mData = mctx.getImageData(0, 0, mw, mh).data;
            maskOn = true;
            calm = false;
            const sdt = Math.min(100, now - lastSampleT);
            lastSampleT = now;
            if (!mem || mem.length !== mw * mh) {
              mem = new Float32Array(mw * mh);
              hold = new Float32Array(mw * mh);
            }
            for (let m = 0; m < mem.length; m++) {
              const s = Math.max(0, Math.min(1, (mData[m * 4] - 1) / 5));
              if (s > 0) {
                if (s > mem[m]) mem[m] = s;
                hold[m] = HOLD_MS;
              } else if (hold[m] > 0) {
                hold[m] -= sdt;
              } else if (mem[m] > 0) {
                mem[m] = Math.max(0, mem[m] - sdt / RELEASE_MS);
              }
            }
            let cw = 0, cx = 0, cy = 0;
            for (let m = 0; m < mem.length; m++) {
              if (mem[m] > .3) {
                cw += mem[m];
                cx += mem[m] * (m % mw);
                cy += mem[m] * (m / mw | 0);
              }
            }
            if (cw > 0) {
              cenC = cx / cw;
              cenR = cy / cw;
            }
            if (!field || field.length !== mw * mh) {
              field = new Float32Array(mw * mh);
              tmpF = new Float32Array(mw * mh);
            }
            const BR = 8;
            for (let br = 0; br < mh; br++) {
              for (let bc = 0; bc < mw; bc++) {
                let bs = 0, bn = 0;
                for (let k = Math.max(0, bc - BR); k <= Math.min(mw - 1, bc + BR); k++) {
                  bs += mem[br * mw + k];
                  bn++;
                }
                tmpF[br * mw + bc] = bs / bn;
              }
            }
            for (let br = 0; br < mh; br++) {
              for (let bc = 0; bc < mw; bc++) {
                let bs = 0, bn = 0;
                for (let k = Math.max(0, br - BR); k <= Math.min(mh - 1, br + BR); k++) {
                  bs += tmpF[k * mw + bc];
                  bn++;
                }
                field[br * mw + bc] = bs / bn;
              }
            }
          } catch (e) {}
        }
        if (advancing) {
          active = true;
          calm = false;
        }
      }
    } else {
      maskOn = false;
    }
    const cool = dt / COOL_MS;
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        if (heat[i] > 0) {
          heat[i] = Math.max(0, heat[i] - cool);
          if (heat[i] > 0) active = true;
        }
        const x = c * SP + SP / 2, y = r * SP + SP / 2;
        let tx = 0, ty = 0, f = 0;
        if (inside) {
          const ddx = x - mx, ddy = y - my;
          const d = Math.hypot(ddx, ddy);
          if (d < INF && d > 1) {
            f = Math.pow(1 - d / INF, 1.5);
            tx = ddx / d * PUSH * f;
            ty = ddy / d * PUSH * f;
          }
        }
        let cull = false;
        if (maskOn && field && mRect && x >= mRect.left && x < mRect.right && y >= mRect.top && y < mRect.bottom) {
          const pcf = (x - mRect.left) / mRect.width * mw;
          const prf = (y - mRect.top) / mRect.height * mh;
          const pc = Math.min(mw - 1, pcf | 0);
          const pr = Math.min(mh - 1, prf | 0);
          if (mem[pr * mw + pc] > .15 && field[pr * mw + pc] > DEEP) {
            cull = true;
          } else if (mem[pr * mw + pc] > .15) {
            let wx = pcf, wy = prf, ldx = 0, ldy = -1;
            for (let k = 0; k < 48; k++) {
              const ci = Math.max(0, Math.min(mw - 1, wx | 0));
              const ri = Math.max(0, Math.min(mh - 1, wy | 0));
              if (mem[ri * mw + ci] < .15) break;
              let gx = field[ri * mw + Math.min(mw - 1, ci + 2)] - field[ri * mw + Math.max(0, ci - 2)];
              let gy = field[Math.min(mh - 1, ri + 2) * mw + ci] - field[Math.max(0, ri - 2) * mw + ci];
              let gl = Math.hypot(gx, gy);
              if (gl < 1e-4) {
                gx = cenC - wx;
                gy = cenR - wy;
                gl = Math.hypot(gx, gy) || 1;
              }
              ldx = -gx / gl;
              ldy = -gy / gl;
              wx += ldx * 1.5;
              wy += ldy * 1.5;
            }
            tx += (wx + ldx * 2.5 - pcf) * (mRect.width / mw);
            ty += (wy + ldy * 2.5 - prf) * (mRect.height / mh);
          } else {
            const v = field[pr * mw + pc];
            if (v > .02) {
              const gx = field[pr * mw + Math.min(mw - 1, pc + 2)] - field[pr * mw + Math.max(0, pc - 2)];
              const gy = field[Math.min(mh - 1, pr + 2) * mw + pc] - field[Math.max(0, pr - 2) * mw + pc];
              const gl = Math.hypot(gx, gy);
              if (gl > .01) {
                const s = Math.min(1, v * 2.5);
                tx -= gx / gl * MPUSH * s;
                ty -= gy / gl * MPUSH * s;
              }
            }
          }
        }
        if (cull) gone[i] = Math.min(1, gone[i] + dt / GONE_MS); else if (gone[i] > 0) gone[i] = Math.max(0, gone[i] - dt / GONE_MS);
        let vx = velX[i], vy = velY[i], ox = offX[i], oy = offY[i];
        if (tx === 0 && ty === 0 && f === 0 && gone[i] === 0 && vx === 0 && vy === 0 && ox === 0 && oy === 0) continue;
        vx += ((tx - ox) * SPRING - vx * DAMP + cvx * KICK * f) * dts;
        vy += ((ty - oy) * SPRING - vy * DAMP + cvy * KICK * f) * dts;
        ox += vx * dts;
        oy += vy * dts;
        if (f === 0 && tx === 0 && ty === 0 && gone[i] === 0 && Math.abs(vx) < .5 && Math.abs(vy) < .5 && Math.abs(ox) < .1 && Math.abs(oy) < .1) {
          vx = vy = ox = oy = 0;
        } else if (Math.abs(vx) < .05 && Math.abs(vy) < .05 && Math.abs(tx - ox) < .3 && Math.abs(ty - oy) < .3 && (gone[i] === 0 || gone[i] === 1)) {
          vx = 0;
          vy = 0;
          ox = tx;
          oy = ty;
        } else {
          active = true;
        }
        velX[i] = vx;
        velY[i] = vy;
        offX[i] = ox;
        offY[i] = oy;
      }
    }
    if (active || !calm) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.fillStyle = "#fff";
      for (let r = 0; r < ny; r++) {
        for (let c = 0; c < nx; c++) {
          const i = r * nx + c;
          const h = heat[i];
          const g = gone[i];
          if (g > .97) continue;
          const x = c * SP + SP / 2 + offX[i];
          const y = r * SP + SP / 2 + offY[i];
          ctx.globalAlpha = BASE_A + GROW_A * h;
          ctx.beginPath();
          ctx.arc(x, y, (BASE_R + GROW_R * h) * (1 - g), 0, 6.2832);
          ctx.fill();
        }
      }
      calm = !active;
    }
    requestAnimationFrame(tick);
  })(prev);
})();
