# Daves Workspace

Working notes, tools and research. Each project is self-contained in its own folder with
its own README.

| Folder | What it is |
|---|---|
| [`dragons-logo/`](dragons-logo/) | Vectorizing the Dragons Elite Baseball Club logo from a low-res raster into a clean SVG, then into watertight, multi-colour STLs for a 3D printed keychain |
| [`photo-social-captions/`](photo-social-captions/) | Instagram captions for concert photography, weaving artists' song titles into the copy |
| [`tire-research/`](tire-research/) | Tire replacement analysis for a 2019 Accord Hybrid |
| [`.github/skills/`](.github/skills/) | Reusable Copilot skills distilled from the work above |

## Reading order

Projects that have a process worth reusing document it in two pieces:

- **`README.md`** — what it is and how to run it
- **`PROCESS.md`** — how it got there: what was tried, what was wrong, what was learned

`dragons-logo` has both. Start with its `PROCESS.md` if you want the reasoning rather
than the reference.

## Not in the repo

`node_modules/` and `dragons-logo/stl/` are generated and ignored. The STLs are ~47 MB
and are reproduced byte-for-byte by `node 8-build-stl.js`, so keeping them would add
that much to history on every rebuild.

`dragons-logo/build/` **is** committed. It is small, and the READMEs cite those images as
the evidence behind their claims.
