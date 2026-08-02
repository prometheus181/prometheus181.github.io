#!/usr/bin/env node
// Crossfade-loop builder. Input: raw rgb24 frames (full clip, fps-converted).
// Output: frames S..S+M-1, with the last K blended toward frames S-K..S-1,
// so the final output frame is (nearly) the natural predecessor of the first
// — the loop wrap becomes a true consecutive frame step.
// argv: W H S M K
const [W, H, S, M, K] = process.argv.slice(2).map(Number);
const FRAME = W * H * 3;

let t = 0, out = 0;
const preroll = [];   // frames S-K .. S-1
let pending = [], bytes = 0;

function emit(buf) {
  if (!process.stdout.write(buf)) {
    process.stdin.pause();
    process.stdout.once('drain', () => process.stdin.resume());
  }
}

process.stdin.on('data', (c) => {
  pending.push(c); bytes += c.length;
  while (bytes >= FRAME) {
    const b = pending.length === 1 ? pending[0] : Buffer.concat(pending);
    const f = Buffer.from(b.subarray(0, FRAME));
    const r = b.subarray(FRAME);
    pending = r.length ? [Buffer.from(r)] : [];
    bytes = r.length;

    if (t >= S - K && t < S) preroll.push(f);
    if (t >= S && out < M) {
      const i = t - S;
      if (i < M - K) {
        emit(f);
      } else {
        const k = i - (M - K);            // 0..K-1
        const x = (k + 1) / K;            // reaches exactly 1 on the last frame,
                                          // so the wrap is a true consecutive step
        const a = x * x * (3 - 2 * x);    // smoothstep: the dissolve fades in from
                                          // ~0 (no onset pop) and eases out to 1
        const p = preroll[k];
        const o = Buffer.alloc(FRAME);
        for (let j = 0; j < FRAME; j++) o[j] = (1 - a) * f[j] + a * p[j];
        emit(o);
      }
      out++;
    }
    t++;
  }
});
process.stdin.on('end', () => {
  process.stderr.write(`loop-blend: ${t} in, ${out} out (S=${S} M=${M} K=${K})\n`);
  process.stdout.end();
});
