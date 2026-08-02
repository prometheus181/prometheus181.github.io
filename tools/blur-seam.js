#!/usr/bin/env node
// Seam smoother for blur layers: CapCut's motion blur varies with motion,
// so the clip's tail (settled, sharp) pops against its head (blurred) at
// the loop. Dissolve the last K frames toward frame 0 — poses there are
// nearly identical (rest), so only the blur character ramps.
// stdin/stdout raw rgb24. argv: W H K
const [W, H, K] = process.argv.slice(2).map(Number);
const FRAME = W * H * 3;

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
  const first = frames[0];
  for (let i = 0; i < M; i++) {
    let out = frames[i];
    const k = i - (M - K);
    if (k >= 0) {
      const x = (k + 1) / (K + 1);      // tops out just below 1: no duplicate
      const a = x * x * (3 - 2 * x);    // smoothstep
      const o = Buffer.alloc(FRAME);
      for (let j = 0; j < FRAME; j++) o[j] = out[j] + (first[j] - out[j]) * a;
      out = o;
    }
    process.stdout.write(out);
  }
  process.stderr.write(`blur-seam: ${M} frames, last ${K} dissolved to head\n`);
  process.stdout.end();
});
