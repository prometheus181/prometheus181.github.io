# kenisbuilding.com

Static site, served by GitHub Pages straight from this repo's root. **This
repo is public** — anything committed here is readable by anyone, including
via view-source and DevTools on the live site.

## Edit `src/`, never the repo root

`src/` holds the working sources with all their comments. It is gitignored:
it stays on the machine, out of the public repo. The files at the repo root
(`index.html`, `css/`, `js/`, `games/`) are **generated** — comment-free
copies that GitHub Pages serves.

```
src/index.html      →  index.html
src/css/site.css    →  css/site.css
src/js/cursor.js    →  js/cursor.js
```

After changing anything in `src/`:

```
node tools/build.mjs
```

That strips the comments, writes the served copies, and stamps every
`?v=` asset link with one content hash so browsers and the CDN pick up the
change. The build prints the tag. Then commit and push as usual.

Editing a root file directly works until the next build silently reverts it.
The build warns when it is about to do that (it tracks output hashes in
`tools/.build-manifest.json`).

## Not generated

`js/ascii-face-data.js` (246 pre-rendered portrait frames, built by
`build-ascii-face.py`), `assets/`, `hero/`, and the `build-*.py` scripts are
committed as-is and have no `src/` counterpart.
