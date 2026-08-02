const track = document.querySelector(".hero-track");

const stage = document.querySelector(".hero-stage");

const frames = Array.from(document.querySelectorAll(".hero-subject img"));

const cta = document.querySelector(".hero-cta");

const STEP = 1 / frames.length;

let ticking = false;

let current = -1;

function progress() {
  const rect = track.getBoundingClientRect();
  const scrollable = track.offsetHeight - stage.offsetHeight;
  if (scrollable <= 0) return 0;
  return Math.min(1, Math.max(0, -rect.top / scrollable));
}

function renderRotation(p) {
  const index = Math.min(frames.length - 1, Math.floor(p / STEP));
  if (index === current) return;
  current = index;
  frames.forEach((img, i) => img.classList.toggle("active", i === index));
}

function update() {
  const p = progress();
  renderRotation(p);
  const root = document.documentElement;
  root.style.setProperty("--hero-bg-opacity", String(1 - p * .65));
  root.style.setProperty("--hero-name-opacity", String(Math.max(0, 1 - p * 2.2)));
  root.style.setProperty("--hero-nudge-opacity", String(Math.max(0, 1 - p * 4)));
  const revealed = p > .88;
  root.style.setProperty("--hero-cta-opacity", revealed ? "1" : "0");
  root.style.setProperty("--hero-cta-y", revealed ? "0px" : "14px");
  root.style.setProperty("--hero-cta-events", revealed ? "auto" : "none");
  ticking = false;
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(update);
}

window.addEventListener("scroll", onScroll, {
  passive: true
});

window.addEventListener("resize", onScroll);

update();
