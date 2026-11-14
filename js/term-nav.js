(function () {
  const hero = document.querySelector('.art-hero');
  const face = document.getElementById('ascii-face');
  if (!hero || !face) return;

  const FACE_END = 500;
  const PAUSE = 250;
  const SPAN = 500;

  const PAGES = [
    { cls: 'tl', href: 'amoeba.html', label: 'amoeba/' },
    { cls: 'tr', href: 'resources.html', label: 'resources/' },
    { cls: 'br', href: 'contact.html', label: 'contact/' }
  ];

  const corners = PAGES.map(function (p) {
    const el = document.createElement('div');
    el.className = 'cnav ' + p.cls;
    el.appendChild(document.createTextNode('> '));
    const a = document.createElement('a');
    a.href = p.href;
    a.tabIndex = -1;
    const typed = document.createElement('span');
    a.appendChild(typed);
    el.appendChild(a);
    const caret = document.createElement('span');
    caret.className = 'term-caret';
    caret.textContent = '█';
    el.appendChild(caret);
    const rest = document.createElement('span');
    rest.className = 'rest';
    rest.textContent = p.label;
    el.appendChild(rest);
    document.body.appendChild(el);
    return { el: el, a: a, typed: typed, rest: rest, label: p.label, k: -1, on: null };
  });

  const FACE = window.ASCII_FACE;
  const rowEls = face.children;
  const GRID = FACE && FACE.frames
    ? FACE.frames[FACE.cells ? FACE.cells[FACE.center] : FACE.center].grid.map(function (s) {
        const clipped = s.replace(/\s+$/, '');
        const vis = clipped.replace(/^ +/, '');
        return { lead: clipped.length - vis.length, vis: vis };
      })
    : [];

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduced || !GRID.length || GRID.length !== rowEls.length) {
    corners.forEach(function (cn) {
      cn.typed.textContent = cn.label;
      cn.rest.textContent = '';
      cn.a.tabIndex = 0;
      cn.el.classList.add('show', 'done');
    });
    return;
  }

  window.__faceHold = true;
  for (let r = 0; r < rowEls.length; r++) {
    rowEls[r].style.paddingLeft = GRID[r].lead + 'ch';
    rowEls[r].textContent = '';
  }

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
        for (let r = i + 1; r <= lastI; r++) rowEls[r].textContent = '';
      }
      rowEls[i].textContent = k >= vis.length ? vis : vis.slice(0, k) + '█';
      lastI = i;
      lastK = k;
    }
    const done = p >= 1;
    if (done === faceDone) return;
    faceDone = done;
    window.__faceHold = !done;
    if (done && window.__faceWake) window.__faceWake();
  }

  function apply(y) {
    print(Math.min(1, Math.max(0, y / FACE_END)));

    const locked = y >= FACE_END;
    const t0 = FACE_END + PAUSE;
    corners.forEach(function (cn, i) {
      if (cn.on !== locked) { cn.on = locked; cn.el.classList.toggle('show', locked); }
      const q = Math.min(1, Math.max(0, (y - t0 - i * SPAN) / (SPAN * 0.8)));
      const k = locked ? Math.round(q * cn.label.length) : 0;
      if (k === cn.k) return;
      cn.k = k;
      cn.typed.textContent = cn.label.slice(0, k);
      cn.rest.textContent = cn.label.slice(k);
      const done = k === cn.label.length;
      cn.el.classList.toggle('done', done);
      cn.a.tabIndex = done ? 0 : -1;
    });
  }

  function dragHint() {
    if (!matchMedia('(hover: none)').matches) return;
    const TRACK = 11;
    const el = document.createElement('div');
    el.id = 'drag-hint';
    el.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'dim';
    label.textContent = 'drag to look around';
    el.appendChild(bar);
    el.appendChild(document.createTextNode('\n'));
    el.appendChild(label);
    document.body.appendChild(el);

    let pos = 0, dir = 1;
    function draw() {
      bar.textContent = '<' + '·'.repeat(pos) + '█' + '·'.repeat(TRACK - 1 - pos) + '>';
      if (pos + dir < 0 || pos + dir >= TRACK) dir = -dir;
      pos += dir;
    }
    draw();
    const timer = setInterval(draw, 110);

    function dismiss(e) {
      if (e.pointerType === 'mouse') return;
      removeEventListener('pointermove', dismiss);
      clearInterval(timer);
      el.classList.add('off');
      setTimeout(function () { el.remove(); }, 500);
    }
    addEventListener('pointermove', dismiss, { passive: true });
  }

  const END = FACE_END + PAUSE + SPAN * PAGES.length;
  function play() {
    const t0 = performance.now();
    (function step(now) {
      const y = now - t0;
      apply(y);
      if (y < END) requestAnimationFrame(step);
      else dragHint();
    })(t0);
  }

  if (document.getElementById('splash')) addEventListener('intro:done', play, { once: true });
  else play();
})();
