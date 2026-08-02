const SIZE = 4;

const START_TILES = 2;

const boardEl = document.getElementById("board");

const scoreEl = document.getElementById("score");

const bestEl = document.getElementById("best");

const overlay = document.getElementById("overlay");

const overlayTitle = document.getElementById("overlay-title");

const overlayBody = document.getElementById("overlay-body");

const startBtn = document.getElementById("start");

const BEST_KEY = "ken-2048-best";

let best = Number(localStorage.getItem(BEST_KEY) || 0);

bestEl.textContent = best;

let grid;

let score;

let uid;

let running;

let reachedGoal;

function blank() {
  return Array.from({
    length: SIZE
  }, () => Array(SIZE).fill(null));
}

function spawn() {
  const free = [];
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (!grid[r][c]) free.push([ r, c ]);
  if (!free.length) return;
  const [r, c] = free[Math.floor(Math.random() * free.length)];
  grid[r][c] = {
    id: ++uid,
    value: Math.random() < .9 ? 2 : 4,
    born: true
  };
}

function reset() {
  grid = blank();
  score = 0;
  uid = 0;
  reachedGoal = false;
  running = true;
  for (let i = 0; i < START_TILES; i++) spawn();
  scoreEl.textContent = "0";
  overlay.hidden = true;
  render();
}

function collapse(line) {
  const tiles = line.filter(Boolean);
  const out = [];
  let gained = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
      const value = tiles[i].value * 2;
      out.push({
        id: tiles[i].id,
        value: value,
        merged: true
      });
      gained += value;
      if (value === 2048) reachedGoal = true;
      i++;
    } else {
      out.push({
        id: tiles[i].id,
        value: tiles[i].value
      });
    }
  }
  while (out.length < SIZE) out.push(null);
  return {
    line: out,
    gained: gained
  };
}

function readLine(dir, i) {
  const line = [];
  for (let j = 0; j < SIZE; j++) {
    if (dir === "left") line.push(grid[i][j]); else if (dir === "right") line.push(grid[i][SIZE - 1 - j]); else if (dir === "up") line.push(grid[j][i]); else line.push(grid[SIZE - 1 - j][i]);
  }
  return line;
}

function writeLine(dir, i, line) {
  for (let j = 0; j < SIZE; j++) {
    if (dir === "left") grid[i][j] = line[j]; else if (dir === "right") grid[i][SIZE - 1 - j] = line[j]; else if (dir === "up") grid[j][i] = line[j]; else grid[SIZE - 1 - j][i] = line[j];
  }
}

function move(dir) {
  if (!running) return;
  const before = serialize();
  let gained = 0;
  for (let i = 0; i < SIZE; i++) {
    const {line: line, gained: g} = collapse(readLine(dir, i));
    gained += g;
    writeLine(dir, i, line);
  }
  if (serialize() === before) return;
  score += gained;
  scoreEl.textContent = score;
  spawn();
  render();
  if (reachedGoal) return win();
  if (!hasMoves()) return lose();
}

function serialize() {
  return grid.map(row => row.map(t => t ? t.value : 0).join(",")).join("|");
}

function hasMoves() {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!grid[r][c]) return true;
      const v = grid[r][c].value;
      if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === v) return true;
      if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === v) return true;
    }
  }
  return false;
}

function finish(title, body) {
  running = false;
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    bestEl.textContent = best;
  }
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  startBtn.textContent = "Again";
  overlay.hidden = false;
}

function win() {
  finish("Final form.", `You assembled the last Kenneth. ${score} points.`);
}

function lose() {
  finish("Stuck.", `No moves left. ${score} points.`);
}

function render() {
  boardEl.querySelectorAll(".tile").forEach(el => el.remove());
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c];
      if (!t) continue;
      const el = document.createElement("div");
      el.className = "tile";
      if (t.born) el.classList.add("is-new");
      if (t.merged) el.classList.add("is-merged");
      el.style.setProperty("--row", r);
      el.style.setProperty("--col", c);
      el.style.backgroundImage = `url(../assets/faces/tile-${t.value}.png)`;
      el.innerHTML = `<span>${t.value}</span>`;
      boardEl.appendChild(el);
      delete t.born;
      delete t.merged;
    }
  }
}

const KEYS = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  a: "left",
  d: "right",
  w: "up",
  s: "down"
};

window.addEventListener("keydown", e => {
  const dir = KEYS[e.key];
  if (dir) {
    e.preventDefault();
    move(dir);
  }
});

startBtn.addEventListener("click", reset);

let touch = null;

boardEl.addEventListener("touchstart", e => {
  touch = {
    x: e.touches[0].clientX,
    y: e.touches[0].clientY
  };
}, {
  passive: true
});

boardEl.addEventListener("touchend", e => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x;
  const dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 26 && Math.abs(dy) < 26) return;
  move(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? "right" : "left" : dy > 0 ? "down" : "up");
}, {
  passive: true
});

reset();

overlay.hidden = false;

overlayTitle.textContent = "2048";

overlayBody.textContent = "Merge matching Kenneths. He gets worse.";

startBtn.textContent = "Play";
