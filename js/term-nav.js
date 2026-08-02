(function() {
  const hero = document.querySelector(".art-hero");
  const face = document.getElementById("ascii-face");
  if (!hero || !face) return;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  scrollTo(0, 0);
  const FACE_END = 480;
  const PAUSE = 60;
  const SPAN = 180;
  const PAGES = [ {
    cls: "tl",
    href: "amoeba.html",
    label: "amoeba/"
  }, {
    cls: "tr",
    href: "arcade.html",
    label: "arcade/"
  }, {
    cls: "br",
    href: "contact.html",
    label: "contact/"
  } ];
  const frame = face.closest(".face-frame") || face;
  const cue = document.createElement("div");
  cue.id = "scroll-cue";
  cue.setAttribute("aria-hidden", "true");
  const bob = document.createElement("span");
  bob.className = "bob";
  bob.textContent = "|\n|\nv";
  cue.appendChild(bob);
  hero.appendChild(cue);
  const corners = PAGES.map(function(p) {
    const el = document.createElement("div");
    el.className = "cnav " + p.cls;
    el.appendChild(document.createTextNode("> "));
    const a = document.createElement("a");
    a.href = p.href;
    a.tabIndex = -1;
    const typed = document.createElement("span");
    a.appendChild(typed);
    el.appendChild(a);
    const caret = document.createElement("span");
    caret.className = "term-caret";
    caret.textContent = "█";
    el.appendChild(caret);
    const rest = document.createElement("span");
    rest.className = "rest";
    rest.textContent = p.label;
    el.appendChild(rest);
    document.body.appendChild(el);
    return {
      el: el,
      a: a,
      typed: typed,
      rest: rest,
      label: p.label,
      k: -1,
      on: null
    };
  });
  const spacer = document.createElement("div");
  spacer.style.height = FACE_END + PAUSE + SPAN * PAGES.length + 120 + "px";
  spacer.setAttribute("aria-hidden", "true");
  document.body.appendChild(spacer);
  let CELL = 10;
  let START_Y = 0;
  let lastT = null;
  let cueOn = null;
  function apply() {
    const y = scrollY;
    const p = Math.min(1, Math.max(0, y / FACE_END));
    const ty = Math.round(START_Y * (1 - p) * (1 - p) / CELL) * CELL;
    const t = ty > 0 ? "translate3d(0," + ty + "px,0)" : "";
    if (t !== lastT) {
      lastT = t;
      frame.style.transform = t;
    }
    const c = y < CELL * 4;
    if (c !== cueOn) {
      cueOn = c;
      cue.classList.toggle("off", !c);
    }
    const locked = y >= FACE_END;
    const t0 = FACE_END + PAUSE;
    corners.forEach(function(cn, i) {
      if (cn.on !== locked) {
        cn.on = locked;
        cn.el.classList.toggle("show", locked);
      }
      const q = Math.min(1, Math.max(0, (y - t0 - i * SPAN) / (SPAN * .8)));
      const k = locked ? Math.round(q * cn.label.length) : 0;
      if (k === cn.k) return;
      cn.k = k;
      cn.typed.textContent = cn.label.slice(0, k);
      cn.rest.textContent = cn.label.slice(k);
      const done = k === cn.label.length;
      cn.el.classList.toggle("done", done);
      cn.a.tabIndex = done ? 0 : -1;
    });
  }
  function measure() {
    CELL = parseFloat(getComputedStyle(face).lineHeight) || 10;
    START_Y = Math.ceil(((innerHeight + frame.offsetHeight) / 2 + CELL * 2) / CELL) * CELL;
    lastT = null;
    apply();
  }
  addEventListener("scroll", apply, {
    passive: true
  });
  addEventListener("resize", measure);
  measure();
})();
