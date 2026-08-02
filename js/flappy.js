const COLS = 48;

const ROWS = 22;

const BIRD_COL = 13;

const GRAVITY = 55;

const FLAP = -15.8;

const SPEED = 19.8;

const GAP = 6;

const PIPE_W = 6;

const SPAWN = 26;

const screenEl = document.getElementById("screen");

const scoreEl = document.getElementById("score");

const bestEl = document.getElementById("best");

const msgEl = document.getElementById("msg");

const startBtn = document.getElementById("start");

const BEST_KEY = "ken-flappy-best";

let best = Number(localStorage.getItem(BEST_KEY) || 0);

bestEl.textContent = best;

let y, vy, pipes, score, running, alive, last;

function makePipe(x) {
  return {
    x: x,
    gapY: 2 + Math.floor(Math.random() * (ROWS - GAP - 4)),
    scored: false
  };
}

function reset() {
  y = ROWS * .42;
  vy = 0;
  score = 0;
  alive = true;
  last = 0;
  pipes = [];
  for (let i = 0; i < 3; i++) pipes.push(makePipe(COLS + 6 + i * SPAWN));
  scoreEl.textContent = "0";
}

function flap() {
  if (!running || !alive) return;
  vy = FLAP;
}

function die() {
  alive = false;
  running = false;
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    bestEl.textContent = best;
  }
  msgEl.textContent = score === 0 ? "immediate. not one pipe." : `grounded after ${score} pipe${score === 1 ? "" : "s"}.`;
  startBtn.textContent = "> again";
  render();
}

function update(dt) {
  vy += GRAVITY * dt;
  y += vy * dt;
  for (const p of pipes) p.x -= SPEED * dt;
  if (pipes.length && pipes[0].x + PIPE_W < 0) {
    pipes.shift();
    pipes.push(makePipe(pipes[pipes.length - 1].x + SPAWN));
  }
  const brow = Math.round(y);
  if (brow < 0 || brow >= ROWS) return die();
  for (const p of pipes) {
    const px = Math.round(p.x);
    if (!p.scored && px + PIPE_W <= BIRD_COL) {
      p.scored = true;
      score += 1;
      scoreEl.textContent = score;
    }
    const inColumn = BIRD_COL >= px && BIRD_COL < px + PIPE_W;
    if (inColumn && (brow < p.gapY || brow >= p.gapY + GAP)) return die();
  }
}

function render() {
  const rows = Array.from({
    length: ROWS
  }, () => Array(COLS).fill(" "));
  for (const p of pipes) {
    const px = Math.round(p.x);
    for (let c = px; c < px + PIPE_W; c++) {
      if (c < 0 || c >= COLS) continue;
      for (let r = 0; r < ROWS; r++) {
        if (r < p.gapY || r >= p.gapY + GAP) rows[r][c] = "#";
      }
    }
  }
  const glyph = vy < -4 ? "/" : vy > 7 ? "\\" : ">";
  const brow = Math.max(0, Math.min(ROWS - 1, Math.round(y)));
  rows[brow][BIRD_COL] = glyph;
  const rule = "+" + "-".repeat(COLS) + "+";
  const body = rows.map(r => "|" + r.join("") + "|").join("\n");
  screenEl.innerHTML = (rule + "\n" + body + "\n" + rule).replace(glyph, `<span class="f">${glyph === ">" ? "&gt;" : glyph}</span>`).replace(/#+/g, '<span class="p">$&</span>');
}

function frame(ts) {
  if (!running) return;
  if (!last) last = ts;
  const dt = Math.min((ts - last) / 1e3, .033);
  last = ts;
  update(dt);
  if (running) render();
  if (running) requestAnimationFrame(frame);
}

function start() {
  reset();
  msgEl.textContent = "space or click to flap.";
  startBtn.textContent = "> restart";
  running = true;
  vy = FLAP * .6;
  render();
  requestAnimationFrame(frame);
}

startBtn.addEventListener("click", e => {
  e.preventDefault();
  start();
});

window.addEventListener("keydown", e => {
  if (e.key === " " || e.key === "ArrowUp") {
    e.preventDefault();
    if (running) flap(); else start();
  }
});

screenEl.addEventListener("pointerdown", e => {
  e.preventDefault();
  if (running) flap(); else start();
});

reset();

render();
