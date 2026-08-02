const COLS = 20;

const ROWS = 20;

const SPEED_MS = 110;

const EMPTY = "  ";

const BODY = "oo";

const HEAD = "@@";

const FOOD = "YC";

const screenEl = document.getElementById("screen");

const scoreEl = document.getElementById("score");

const bestEl = document.getElementById("best");

const msgEl = document.getElementById("msg");

const startBtn = document.getElementById("start");

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
  msgEl.textContent = score === 0 ? "rejected. zero batches consumed." : `devoured ${score} accelerator${score === 1 ? "" : "s"}.`;
  startBtn.textContent = "> again";
  render();
}

function render() {
  const rule = "+" + "-".repeat(COLS * 2) + "+";
  const cells = Array.from({
    length: ROWS
  }, () => Array(COLS).fill(EMPTY));
  cells[food.y][food.x] = FOOD;
  for (let i = snake.length - 1; i > 0; i--) cells[snake[i].y][snake[i].x] = BODY;
  cells[snake[0].y][snake[0].x] = HEAD;
  const lines = [ rule ];
  for (let y = 0; y < ROWS; y++) lines.push("|" + cells[y].join("") + "|");
  lines.push(rule);
  screenEl.innerHTML = lines.join("\n").replace(FOOD, `<span class="f">${FOOD}</span>`).replace(HEAD, `<span class="h">${HEAD}</span>`);
}

function frame(ts) {
  if (!running) return;
  if (!last) last = ts;
  acc += ts - last;
  last = ts;
  let stepped = false;
  while (acc >= SPEED_MS) {
    acc -= SPEED_MS;
    if (alive) {
      step();
      stepped = true;
    }
  }
  if (stepped && running) render();
  if (running) requestAnimationFrame(frame);
}

function start() {
  reset();
  msgEl.textContent = "eat the YC. do not eat yourself.";
  startBtn.textContent = "> restart";
  running = true;
  render();
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

screenEl.addEventListener("touchstart", e => {
  touchStart = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY
  };
}, {
  passive: true
});

screenEl.addEventListener("touchend", e => {
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

render();
