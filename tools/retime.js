#!/usr/bin/env node
// Streaming retimer: emits input frames according to a precomputed map
// (map[j] = input frame index for output frame j, monotone non-decreasing).
// Equalizes visual rotation speed by dropping oversampled slow-zone frames.
// argv: W H mapfile
const fs = require('fs');
const [W, H, MAPFILE] = process.argv.slice(2);
const FRAME = Number(W) * Number(H) * 3;
const { map } = JSON.parse(fs.readFileSync(MAPFILE, 'utf8'));

let t = 0, j = 0, out = 0;
let pending = [], bytes = 0;

process.stdin.on('data', (c) => {
  pending.push(c); bytes += c.length;
  while (bytes >= FRAME) {
    const b = pending.length === 1 ? pending[0] : Buffer.concat(pending);
    const f = Buffer.from(b.subarray(0, FRAME));
    const r = b.subarray(FRAME);
    pending = r.length ? [Buffer.from(r)] : [];
    bytes = r.length;
    while (j < map.length && map[j] === t) {
      if (!process.stdout.write(f)) {
        process.stdin.pause();
        process.stdout.once('drain', () => process.stdin.resume());
      }
      j++; out++;
    }
    t++;
  }
});
process.stdin.on('end', () => {
  process.stderr.write(`retime: ${t} in, ${out} out\n`);
  process.stdout.end();
});
