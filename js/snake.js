const CELL = 24;

const COLS = 20;

const ROWS = 20;

const SPEED_MS = 110;

const canvas = document.getElementById("game");

const ctx = canvas.getContext("2d");

canvas.width = COLS * CELL;

canvas.height = ROWS * CELL;

const scoreEl = document.getElementById("score");

const bestEl = document.getElementById("best");

const overlay = document.getElementById("overlay");

const overlayTitle = document.getElementById("overlay-title");

const overlayBody = document.getElementById("overlay-body");

const startBtn = document.getElementById("start");

const head = new Image;

head.src = "../assets/faces/snake-head.png";

const BEST_KEY = "ken-snake-best";

let best = Number(localStorage.getItem(BEST_KEY) || 0);

bestEl.textContent = best;

let snake, dir, nextDir, food, score, alive, running, acc, last;

function reset() {
  const mid = Math.floor(COLS / 2);
  snake = [ {
    x: mid,
    y: mid
  }, {
    x: mid - 1,
    y: mid
  }, {
    x: mid - 2,
    y: mid
  } ];
  dir = {
    x: 1,
    y: 0
  };
  nextDir = dir;
  score = 0;
  alive = true;
  acc = 0;
  last = 0;
  placeFood();
  scoreEl.textContent = "0";
}

function placeFood() {
  let spot;
  do {
    spot = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS)
    };
  } while (snake.some(s => s.x === spot.x && s.y === spot.y));
  food = spot;
}

function step() {
  dir = nextDir;
  const next = {
    x: snake[0].x + dir.x,
    y: snake[0].y + dir.y
  };
  const hitWall = next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS;
  const hitSelf = snake.some(s => s.x === next.x && s.y === next.y);
  if (hitWall || hitSelf) return die();
  snake.unshift(next);
  if (next.x === food.x && next.y === food.y) {
    score += 1;
    scoreEl.textContent = score;
    placeFood();
  } else {
    snake.pop();
  }
}

function die() {
  alive = false;
  running = false;
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    bestEl.textContent = best;
  }
  overlayTitle.textContent = score >= 10 ? "Devoured." : "Rejected.";
  overlayBody.textContent = score === 0 ? "Zero batches consumed. Brutal." : `You ate ${score} startup accelerator${score === 1 ? "" : "s"}.`;
  startBtn.textContent = "Again";
  overlay.hidden = false;
}

function drawGrid() {
  ctx.fillStyle = "#14141c";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL + .5, 0);
    ctx.lineTo(i * CELL + .5, canvas.height);
    ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * CELL + .5);
    ctx.lineTo(canvas.width, i * CELL + .5);
    ctx.stroke();
  }
}

function drawYC(cx, cy, size) {
  const r = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = "#ff6600";
  ctx.beginPath();
  ctx.roundRect(-r, -r, size, size, size * .16);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(2, size * .11);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const top = -r * .44;
  const mid = r * .02;
  const bot = r * .5;
  ctx.beginPath();
  ctx.moveTo(-r * .34, top);
  ctx.lineTo(0, mid);
  ctx.lineTo(r * .34, top);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(0, bot);
  ctx.stroke();
  ctx.restore();
}

function draw() {
  drawGrid();
  drawYC(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, CELL * .78);
  for (let i = snake.length - 1; i > 0; i--) {
    const s = snake[i];
    const t = 1 - i / snake.length;
    ctx.fillStyle = `rgba(79, 195, 247, ${.35 + t * .5})`;
    ctx.beginPath();
    ctx.roundRect(s.x * CELL + 2, s.y * CELL + 2, CELL - 4, CELL - 4, 6);
    ctx.fill();
  }
  const h = snake[0];
  if (head.complete && head.naturalWidth) {
    ctx.drawImage(head, h.x * CELL - 3, h.y * CELL - 3, CELL + 6, CELL + 6);
  } else {
    ctx.fillStyle = "#4fc3f7";
    ctx.beginPath();
    ctx.arc(h.x * CELL + CELL / 2, h.y * CELL + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function frame(ts) {
  if (!running) return;
  if (!last) last = ts;
  acc += ts - last;
  last = ts;
  while (acc >= SPEED_MS) {
    acc -= SPEED_MS;
    if (alive) step();
  }
  draw();
  if (running) requestAnimationFrame(frame);
}

function start() {
  reset();
  overlay.hidden = true;
  running = true;
  requestAnimationFrame(frame);
}

const KEYS = {
  ArrowUp: {
    x: 0,
    y: -1
  },
  ArrowDown: {
    x: 0,
    y: 1
  },
  ArrowLeft: {
    x: -1,
    y: 0
  },
  ArrowRight: {
    x: 1,
    y: 0
  },
  w: {
    x: 0,
    y: -1
  },
  s: {
    x: 0,
    y: 1
  },
  a: {
    x: -1,
    y: 0
  },
  d: {
    x: 1,
    y: 0
  }
};

function turn(d) {
  if (d.x === -dir.x && d.y === -dir.y) return;
  nextDir = d;
}

window.addEventListener("keydown", e => {
  const d = KEYS[e.key];
  if (d) {
    e.preventDefault();
    if (running) turn(d);
  }
  if (e.key === " " && !running) {
    e.preventDefault();
    start();
  }
});

startBtn.addEventListener("click", start);

let touchStart = null;

canvas.addEventListener("touchstart", e => {
  touchStart = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY
  };
}, {
  passive: true
});

canvas.addEventListener("touchend", e => {
  if (!touchStart || !running) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  turn(Math.abs(dx) > Math.abs(dy) ? {
    x: Math.sign(dx),
    y: 0
  } : {
    x: 0,
    y: Math.sign(dy)
  });
  touchStart = null;
}, {
  passive: true
});

reset();

draw();
