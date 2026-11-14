(function() {
  const hero = document.querySelector(".art-hero");
  const face = document.getElementById("ascii-face");
  if (!hero || !face) return;
  const FACE_END = 1e3;
  const PHASES = [ [ "white", 0 ], [ "off", 650 ], [ "white", 750 ], [ "off", 850 ], [ "real", FACE_END ] ];
  const PAUSE = 250;
  const SPAN = 500;
  const PAGES = [ {
    cls: "tl",
    href: "amoeba.html",
    label: "amoeba/"
  }, {
    cls: "tr",
    href: "resources.html",
    label: "resources/"
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
  window.__faceHold = true;
  for (let r = 0; r < rowEls.length; r++) {
    rowEls[r].style.paddingLeft = GRID[r].lead + "ch";
    rowEls[r].textContent = "";
  }
  const WHITE = GRID.map(function(g) {
    return "█".repeat(g.vis.length);
  });
  let shown = null;
  function show(state) {
    if (state === shown) return;
    shown = state;
    face.classList.toggle("white", state === "white");
    for (let r = 0; r < rowEls.length; r++) {
      rowEls[r].textContent = state === "real" ? GRID[r].vis : state === "white" ? WHITE[r] : "";
    }
    if (state === "real") {
      window.__faceHold = false;
      if (window.__faceWake) window.__faceWake();
    }
  }
  function phaseAt(y) {
    let state = PHASES[0][0];
    for (let n = 0; n < PHASES.length; n++) if (y >= PHASES[n][1]) state = PHASES[n][0];
    return state;
  }
  function apply(y) {
    show(phaseAt(y));
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
  function dragHint() {
    if (!matchMedia("(hover: none)").matches) return;
    const TRACK = 11;
    const el = document.createElement("div");
    el.id = "drag-hint";
    el.setAttribute("aria-hidden", "true");
    const bar = document.createElement("span");
    const label = document.createElement("span");
    label.className = "dim";
    label.textContent = "drag to look around";
    el.appendChild(bar);
    el.appendChild(document.createTextNode("\n"));
    el.appendChild(label);
    document.body.appendChild(el);
    let pos = 0, dir = 1;
    function draw() {
      bar.textContent = "<" + "·".repeat(pos) + "█" + "·".repeat(TRACK - 1 - pos) + ">";
      if (pos + dir < 0 || pos + dir >= TRACK) dir = -dir;
      pos += dir;
    }
    draw();
    const timer = setInterval(draw, 110);
    function dismiss(e) {
      if (e.pointerType === "mouse") return;
      removeEventListener("pointermove", dismiss);
      clearInterval(timer);
      el.classList.add("off");
      setTimeout(function() {
        el.remove();
      }, 500);
    }
    addEventListener("pointermove", dismiss, {
      passive: true
    });
  }
  const END = FACE_END + PAUSE + SPAN * PAGES.length;
  function play() {
    const t0 = performance.now();
    (function step(now) {
      const y = now - t0;
      apply(y);
      if (y < END) requestAnimationFrame(step); else dragHint();
    })(t0);
  }
  if (document.getElementById("splash")) addEventListener("intro:done", play, {
    once: true
  }); else play();
})();
