#!/usr/bin/env node
// Fractional retimer: map entries are fractional input positions; each output
// frame is a linear mix of the two adjacent input frames. Kills the 1-vs-2
// frame alternation judder that integer sampling produces at fractional rates.
// Positions in [N-1, N) wrap-interpolate against input frame 0.
// argv: W H mapfile
const fs = require('fs');
const [W, H, MAPFILE] = process.argv.slice(2);
const FRAME = Number(W) * Number(H) * 3;
const { N, fmap } = JSON.parse(fs.readFileSync(MAPFILE, 'utf8'));

let t = 0, j = 0, out = 0;
let prevFrame = null, frame0 = null;
let pending = [], bytes = 0;
const mix = Buffer.alloc(FRAME);

function emit(buf) {
  if (!process.stdout.write(buf)) {
    process.stdin.pause();
    process.stdout.once('drain', () => process.stdin.resume());
  }
}

function interp(A, B, frac) {
  if (frac < 0.001) return Buffer.from(A);
  if (frac > 0.999) return Buffer.from(B);
  for (let i = 0; i < FRAME; i++) mix[i] = A[i] + (B[i] - A[i]) * frac;
  return Buffer.from(mix);
}

let keptA = null; // frame t-2
process.stdin.on('data', (c) => {
  pending.push(c); bytes += c.length;
  while (bytes >= FRAME) {
    const b = pending.length === 1 ? pending[0] : Buffer.concat(pending);
    const f = Buffer.from(b.subarray(0, FRAME));
    const r = b.subarray(FRAME);
    pending = r.length ? [Buffer.from(r)] : [];
    bytes = r.length;
    if (t === 0) frame0 = Buffer.from(f);
    keptA = prevFrame;
    prevFrame = f;
    t++;
    // outputs needing pair (t-2, t-1) i.e. floor(pos) === t-2
    while (j < fmap.length && Math.floor(fmap[j]) === t - 2) {
      emit(interp(keptA, prevFrame, fmap[j] - (t - 2)));
      j++; out++;
    }
  }
});
process.stdin.on('end', () => {
  // remaining positions: floor(pos) === N-1 → interpolate frame N-1 with frame 0
  while (j < fmap.length && Math.floor(fmap[j]) === N - 1) {
    emit(interp(prevFrame, frame0, fmap[j] - (N - 1)));
    j++; out++;
  }
  process.stderr.write(`retime-frac: ${t} in, ${out} out (${fmap.length} requested)\n`);
  process.stdout.end();
});
