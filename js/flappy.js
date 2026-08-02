const W = 400;

const H = 600;

const GRAVITY = 1500;

const FLAP = -430;

const SPEED = 165;

const GAP = 168;

const PIPE_W = 68;

const SPAWN_X = 230;

const BIRD_R = 20;

const canvas = document.getElementById("game");

const ctx = canvas.getContext("2d");

canvas.width = W;

canvas.height = H;

const scoreEl = document.getElementById("score");

const bestEl = document.getElementById("best");

const overlay = document.getElementById("overlay");

const overlayTitle = document.getElementById("overlay-title");

const overlayBody = document.getElementById("overlay-body");

const startBtn = document.getElementById("start");

const bird = new Image;

bird.src = "../assets/faces/flappy.png";

const BEST_KEY = "ken-flappy-best";

let best = Number(localStorage.getItem(BEST_KEY) || 0);

bestEl.textContent = best;

let y, vy, rot, pipes, score, running, alive, last;

function reset() {
  y = H * .42;
  vy = 0;
  rot = 0;
  score = 0;
  alive = true;
  last = 0;
  pipes = [];
  for (let i = 0; i < 3; i++) pipes.push(makePipe(W + 120 + i * SPAWN_X));
  scoreEl.textContent = "0";
}

function makePipe(x) {
  const margin = 70;
  const gapY = margin + Math.random() * (H - GAP - margin * 2);
  return {
    x: x,
    gapY: gapY,
    scored: false
  };
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
  overlayTitle.textContent = score === 0 ? "Immediate." : "Grounded.";
  overlayBody.textContent = score === 0 ? "You did not clear a single pipe. Incredible." : `Cleared ${score} pipe${score === 1 ? "" : "s"}.`;
  startBtn.textContent = "Again";
  overlay.hidden = false;
}

function update(dt) {
  vy += GRAVITY * dt;
  y += vy * dt;
  rot = Math.max(-.5, Math.min(1.1, vy / 700));
  for (const p of pipes) p.x -= SPEED * dt;
  if (pipes.length && pipes[0].x + PIPE_W < 0) {
    pipes.shift();
    pipes.push(makePipe(pipes[pipes.length - 1].x + SPAWN_X));
  }
  const bx = W * .28;
  for (const p of pipes) {
    if (!p.scored && p.x + PIPE_W < bx - BIRD_R) {
      p.scored = true;
      score += 1;
      scoreEl.textContent = score;
    }
    const withinX = bx + BIRD_R > p.x && bx - BIRD_R < p.x + PIPE_W;
    if (withinX && (y - BIRD_R < p.gapY || y + BIRD_R > p.gapY + GAP)) return die();
  }
  if (y + BIRD_R > H || y - BIRD_R < 0) die();
}

function drawPipe(p) {
  const grad = ctx.createLinearGradient(p.x, 0, p.x + PIPE_W, 0);
  grad.addColorStop(0, "#3f9a4a");
  grad.addColorStop(.5, "#66c46f");
  grad.addColorStop(1, "#2f7a39");
  ctx.fillStyle = grad;
  ctx.fillRect(p.x, 0, PIPE_W, p.gapY);
  ctx.fillRect(p.x, p.gapY + GAP, PIPE_W, H - p.gapY - GAP);
  ctx.fillStyle = "#2f7a39";
  ctx.fillRect(p.x - 4, p.gapY - 16, PIPE_W + 8, 16);
  ctx.fillRect(p.x - 4, p.gapY + GAP, PIPE_W + 8, 16);
}

function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#4aa8e0");
  sky.addColorStop(1, "#9fd8f5");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  for (const p of pipes) drawPipe(p);
  ctx.fillStyle = "#7cc46f";
  ctx.fillRect(0, H - 12, W, 12);
  const bx = W * .28;
  ctx.save();
  ctx.translate(bx, y);
  ctx.rotate(rot);
  if (bird.complete && bird.naturalWidth) {
    ctx.drawImage(bird, -BIRD_R - 4, -BIRD_R - 4, (BIRD_R + 4) * 2, (BIRD_R + 4) * 2);
  } else {
    ctx.fillStyle = "#ffd93d";
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function frame(ts) {
  if (!running) return;
  if (!last) last = ts;
  const dt = Math.min((ts - last) / 1e3, .033);
  last = ts;
  update(dt);
  draw();
  if (running) requestAnimationFrame(frame);
}

function start() {
  reset();
  overlay.hidden = true;
  running = true;
  vy = FLAP * .6;
  requestAnimationFrame(frame);
}

startBtn.addEventListener("click", start);

window.addEventListener("keydown", e => {
  if (e.key === " " || e.key === "ArrowUp") {
    e.preventDefault();
    running ? flap() : start();
  }
});

canvas.addEventListener("pointerdown", e => {
  e.preventDefault();
  running ? flap() : start();
});

reset();

draw();
