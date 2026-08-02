const faceEl = document.getElementById("ascii-face");

const FACE = window.ASCII_FACE;

const HEAD_EASE = .45;

const BLINK_MS = 140;

const BLINK_GAP = [ 2e3, 4e3 ];

const SWEEP_S = 9;

function initAsciiFace() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("rm");
  const noHover = window.matchMedia("(hover: none)").matches;
  const frames = FACE.frames;
  const gridCols = FACE.gridCols || frames.length;
  const gridRows = FACE.gridRows || 1;
  const cells = FACE.cells || null;
  const padded = frames.map(f => f.grid.map(r => r.padEnd(FACE.cols)));
  const centerCol = FACE.center % gridCols;
  const centerRow = Math.floor(FACE.center / gridCols);
  faceEl.textContent = "";
  const rowEls = [];
  const lastRows = [];
  for (let r = 0; r < FACE.rows; r++) {
    const el = document.createElement("div");
    el.className = "arow";
    faceEl.appendChild(el);
    rowEls.push(el);
    lastRows.push(null);
  }
  function paint(rows) {
    for (let r = 0; r < rowEls.length; r++) {
      const raw = rows[r] || "";
      if (raw === lastRows[r]) continue;
      lastRows[r] = raw;
      const clipped = raw.replace(/\s+$/, "");
      const trimmed = clipped.replace(/^ +/, "");
      rowEls[r].style.paddingLeft = clipped.length - trimmed.length + "ch";
      rowEls[r].textContent = trimmed;
    }
  }
  let targetCol = centerCol, currentCol = centerCol;
  let targetRow = centerRow, currentRow = centerRow;
  let shownCol = centerCol, shownRow = centerRow;
  let blinkUntil = 0;
  let running = false;
  let lastKey = "";
  let lastPointerAt = 0;
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }
  function selectionOnFace() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    return faceEl.contains(sel.anchorNode) || faceEl.contains(sel.focusNode);
  }
  function compose() {
    if (window.__faceHold) return;
    if (Math.abs(currentCol - shownCol) > .55) shownCol = Math.round(currentCol);
    if (Math.abs(currentRow - shownRow) > .55) shownRow = Math.round(currentRow);
    const col = clamp(shownCol, 0, gridCols - 1);
    const row = clamp(shownRow, 0, gridRows - 1);
    const ci = row * gridCols + col;
    const fi = cells ? cells[ci] : ci;
    const blinking = Date.now() < blinkUntil;
    const key = fi + "|" + blinking;
    if (key === lastKey || selectionOnFace()) return;
    lastKey = key;
    if (!blinking) {
      paint(padded[fi]);
      return;
    }
    const rows = padded[fi].slice();
    for (const e of frames[fi].eyes) {
      if (!e.vis) continue;
      for (let r = e.r; r < e.r + e.h; r++) {
        const fill = r === e.r + Math.floor(e.h / 2) ? "-".repeat(e.w - 2) : e.lid.repeat(e.w - 2);
        rows[r] = rows[r].slice(0, e.c + 1) + fill + rows[r].slice(e.c + 1 + fill.length);
      }
    }
    paint(rows);
  }
  function tick(now) {
    if (noHover && now - lastPointerAt > 2500) {
      const t = now / 1e3;
      targetCol = (Math.sin(t * 2 * Math.PI / SWEEP_S) * .5 + .5) * (gridCols - 1);
      targetRow = gridRows > 1 ? (Math.sin(t * .7 + 1) * .35 + .5) * (gridRows - 1) : centerRow;
    }
    currentCol += (targetCol - currentCol) * HEAD_EASE;
    currentRow += (targetRow - currentRow) * HEAD_EASE;
    if (Math.abs(targetCol - currentCol) < .01) currentCol = targetCol;
    if (Math.abs(targetRow - currentRow) < .01) currentRow = targetRow;
    compose();
    const settled = currentCol === targetCol && currentRow === targetRow && Date.now() >= blinkUntil && !noHover;
    if (settled) {
      running = false;
      return;
    }
    requestAnimationFrame(tick);
  }
  function wake() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }
  function onPointerMove(ev) {
    lastPointerAt = performance.now();
    targetCol = ev.clientX / window.innerWidth * (gridCols - 1);
    targetRow = gridRows > 1 ? ev.clientY / window.innerHeight * (gridRows - 1) : centerRow;
    wake();
  }
  function scheduleBlink() {
    const wait = BLINK_GAP[0] + Math.random() * (BLINK_GAP[1] - BLINK_GAP[0]);
    setTimeout(() => {
      blinkUntil = Date.now() + BLINK_MS;
      wake();
      if (Math.random() < .2) {
        setTimeout(() => {
          blinkUntil = Date.now() + BLINK_MS;
          wake();
        }, BLINK_MS + 120);
      }
      scheduleBlink();
    }, wait);
  }
  compose();
  window.__faceWake = wake;
  if (reduceMotion) return;
  window.addEventListener("pointermove", onPointerMove, {
    passive: true
  });
  document.addEventListener("selectionchange", () => {
    if (!selectionOnFace()) wake();
  });
  scheduleBlink();
  if (noHover) wake();
}

if (faceEl && FACE && FACE.frames && FACE.frames.length) initAsciiFace();
