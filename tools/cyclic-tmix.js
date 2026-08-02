#!/usr/bin/env node
// Cyclic temporal motion blur: each output frame is the average of W
// neighboring frames with CYCLIC indexing, so the blur wraps around the
// loop seamlessly. Static content (the rest pose) stays sharp — blur
// appears exactly where there is motion, like a real shutter.
// stdin/stdout raw rgb24. argv: W H WINDOW
const [W, H, WIN] = process.argv.slice(2).map(Number);
const FRAME = W * H * 3;
const HALF = (WIN - 1) / 2;

let frames = [];
let pending = [], bytes = 0;
process.stdin.on('data', (c) => {
  pending.push(c); bytes += c.length;
  while (bytes >= FRAME) {
    const b = pending.length === 1 ? pending[0] : Buffer.concat(pending);
    frames.push(Buffer.from(b.subarray(0, FRAME)));
    const r = b.subarray(FRAME);
    pending = r.length ? [Buffer.from(r)] : [];
    bytes = r.length;
  }
});
process.stdin.on('end', () => {
  const M = frames.length;
  const acc = new Float32Array(FRAME);
  for (let i = 0; i < M; i++) {
    acc.fill(0);
    for (let k = -HALF; k <= HALF; k++) {
      const f = frames[((i + k) % M + M) % M];
      for (let j = 0; j < FRAME; j++) acc[j] += f[j];
    }
    const o = Buffer.alloc(FRAME);
    for (let j = 0; j < FRAME; j++) o[j] = acc[j] / WIN;
    process.stdout.write(o);
  }
  process.stderr.write(`cyclic-tmix: ${M} frames, window ${WIN}\n`);
  process.stdout.end();
});
