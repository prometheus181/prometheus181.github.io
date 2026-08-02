#!/usr/bin/env node
// Publish step. src/ holds the working sources (kept out of this repo);
// this writes the served copies at the repo root with comments removed,
// then stamps every asset link with one content hash for cache busting.
//
//   node tools/build.mjs
//
// Never edit the served files directly — the next build overwrites them,
// and warns first if it is about to.

import { readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const MANIFEST = path.join(ROOT, 'tools', '.build-manifest.json');

const JS = ['js/ascii-face.js', 'js/cursor.js', 'js/intro.js', 'js/splash.js',
  'js/term-nav.js', 'js/hero.js', 'js/snake.js', 'js/flappy.js', 'js/2048.js'];
const CSS = ['css/site.css', 'css/tokens.css', 'css/game.css'];
const HTML = ['index.html', 'amoeba.html', 'arcade.html', 'contact.html',
  'games/2048.html', 'games/snake.html', 'games/flappy.html'];

// Files whose bytes decide the cache tag: everything the landing page
// loads. js/ascii-face-data.js is generated and has no source in src/.
const TAGGED = ['js/ascii-face-data.js', 'js/ascii-face.js', 'js/splash.js',
  'js/cursor.js', 'js/intro.js', 'js/term-nav.js', 'css/site.css'];

const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');

async function terser(file) {
  const { stdout } = await run('npx', ['--yes', 'terser', file,
    '--format', 'comments=false,beautify=true,indent_level=2'],
    { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

let tmpN = 0;
async function stripJsText(code) {
  const tmp = path.join(os.tmpdir(), `ksite-${process.pid}-${tmpN++}.js`);
  await writeFile(tmp, code);
  try {
    return await terser(tmp);
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

function stripCss(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\{\n\s*\n/g, '{\n')
    .replace(/\n\s*\n([ \t]*\})/g, '\n$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '');
}

// Whole-line comments take their line with them; inline ones (the ASCII
// fallback markers) are cut in place. Page text is otherwise untouched —
// the portrait's own blank lines and slashes are content, not formatting.
// Inline <style> and <script> bodies get the same treatment as their
// external counterparts.
async function stripHtml(text) {
  let out = text
    .replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*\r?\n/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi,
      (_, attrs, body) => `<style${attrs}>${body.includes('/*') ? stripCss(body) : body}</style>`);

  const blocks = [...out.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const b of blocks.reverse()) {
    if (!b[2].trim()) continue;
    const pad = (out.slice(0, b.index).match(/[ \t]*$/) || [''])[0] + '  ';
    const body = (await stripJsText(b[2])).trimEnd()
      .split('\n').map((l) => (l ? pad + l : l)).join('\n');
    out = out.slice(0, b.index) + `<script${b[1]}>\n${body}\n${pad.slice(2)}</script>` +
      out.slice(b.index + b[0].length);
  }
  return out;
}

const prev = JSON.parse(await readFile(MANIFEST, 'utf8').catch(() => '{}'));
for (const [rel, want] of Object.entries(prev)) {
  const now = await readFile(path.join(ROOT, rel)).then(sha1).catch(() => null);
  if (now && now !== want) {
    console.warn(`  ! ${rel} changed since the last build — if that edit was made`);
    console.warn(`    outside src/, it is about to be overwritten`);
  }
}

const built = {};
for (const rel of JS) {
  const out = await terser(path.join(SRC, rel));
  await writeFile(path.join(ROOT, rel), out);
  built[rel] = sha1(out);
}
for (const rel of CSS) {
  const out = stripCss(await readFile(path.join(SRC, rel), 'utf8'));
  await writeFile(path.join(ROOT, rel), out);
  built[rel] = sha1(out);
}

const hash = createHash('sha1');
for (const rel of TAGGED) hash.update(await readFile(path.join(ROOT, rel)));
const TAG = hash.digest('hex').slice(0, 8);

for (const rel of HTML) {
  const out = (await stripHtml(await readFile(path.join(SRC, rel), 'utf8')))
    .replaceAll('__TAG__', TAG);
  await writeFile(path.join(ROOT, rel), out);
  built[rel] = sha1(out);
}

await writeFile(MANIFEST, JSON.stringify(built, null, 2) + '\n');
console.log(`built ${Object.keys(built).length} files · cache tag ${TAG}`);
