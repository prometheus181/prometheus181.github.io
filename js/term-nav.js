(function() {
  const hero = document.querySelector(".art-hero");
  const face = document.getElementById("ascii-face");
  if (!hero || !face) return;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  scrollTo(0, 0);
  const FACE_END = 900;
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
  const FACE = window.ASCII_FACE;
  const rowEls = face.children;
  const GRID = FACE && FACE.frames ? FACE.frames[FACE.cells ? FACE.cells[FACE.center] : FACE.center].grid.map(function(s) {
    const clipped = s.replace(/\s+$/, "");
    const vis = clipped.replace(/^ +/, "");
    return {
      lead: clipped.length - vis.length,
      vis: vis
    };
  }) : [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("rm");
  if (reduced || !GRID.length || GRID.length !== rowEls.length) {
    corners.forEach(function(cn) {
      cn.typed.textContent = cn.label;
      cn.rest.textContent = "";
      cn.a.tabIndex = 0;
      cn.el.classList.add("show", "done");
    });
    return;
  }
  const cue = document.createElement("div");
  cue.id = "scroll-cue";
  cue.setAttribute("aria-hidden", "true");
  const bob = document.createElement("span");
  bob.className = "bob";
  bob.textContent = "|\n|\nv";
  cue.appendChild(bob);
  hero.appendChild(cue);
  const spacer = document.createElement("div");
  spacer.style.height = FACE_END + PAUSE + SPAN * PAGES.length + 120 + "px";
  spacer.setAttribute("aria-hidden", "true");
  document.body.appendChild(spacer);
  window.__faceHold = true;
  for (let r = 0; r < rowEls.length; r++) {
    rowEls[r].style.paddingLeft = GRID[r].lead + "ch";
    rowEls[r].textContent = "";
  }
  let CELL = 10;
  let cueOn = null;
  let lastI = -1;
  let lastK = -1;
  let faceDone = null;
  function print(p) {
    const f = p * GRID.length;
    const i = Math.min(GRID.length - 1, Math.floor(f));
    const vis = GRID[i].vis;
    const k = p >= 1 ? vis.length : Math.round((f - i) * vis.length);
    if (i !== lastI || k !== lastK) {
      if (i > lastI) {
        for (let r = Math.max(lastI, 0); r < i; r++) rowEls[r].textContent = GRID[r].vis;
      } else if (i < lastI) {
        for (let r = i + 1; r <= lastI; r++) rowEls[r].textContent = "";
      }
      rowEls[i].textContent = k >= vis.length ? vis : vis.slice(0, k) + "█";
      lastI = i;
      lastK = k;
    }
    const done = p >= 1;
    if (done === faceDone) return;
    faceDone = done;
    window.__faceHold = !done;
    if (done && window.__faceWake) window.__faceWake();
  }
  function apply() {
    const y = scrollY;
    print(Math.min(1, Math.max(0, y / FACE_END)));
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
    apply();
  }
  addEventListener("scroll", apply, {
    passive: true
  });
  addEventListener("resize", measure);
  measure();
})();
