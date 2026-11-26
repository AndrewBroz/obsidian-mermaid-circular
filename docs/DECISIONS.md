# Decisions

Append-only. Each entry is dated and says what was decided and why.

## 2026-11-25: Pele inside, not mermaid

The plugin now bundles Pele's flowchart, wrapped with
`pele-layout-circular`, instead of its own mermaid plus
`mermaid-layout-circular`. A circular diagram is mounted on the
plugin's private Pele; every other diagram still goes to Obsidian's.

Why: Obsidian draws every diagram with Pele. The plugin used to draw
circular ones with mermaid and then dress mermaid up to look like
Pele: it read the `--pele-*` palette, resolved each color through a
canvas, fed mermaid's base theme, and patched the geometry with
theme CSS. Drawing with Pele itself makes all of that unnecessary.
Circular diagrams now take Obsidian's palette, fonts, zoom and theme
redraws the same way any other diagram does.

What went:

- mermaid, `mermaid-layout-circular`, and the esbuild plugin that
  stubbed mermaid's unreachable lazy chunks.
- The palette reader, color resolver, theme variables and theme CSS.
- The render queue and per-instance id prefix. mermaid's config was
  global and its renders looked elements up by id; Pele's mount has
  neither problem.

The plugin imports `pele/core` and `pele/diagrams/flowchart`, not
the full `pele` entry. The plugin only draws flowcharts, and the
full entry carries every diagram type, about 880 KB minified against
about 173 KB for the flowchart alone. It uses `mount` from
`pele/core` rather than `render`, because Obsidian hands the plugin
mount calls and expects a mount controller back.

`main.js`, minified, with gzip at its default level:

| | bytes | gzipped |
| --- | --- | --- |
| before (mermaid 12.3) | 3,163,104 | 860,568 |
| after (Pele 1.13) | 187,553 | 74,052 |

The plugin awaits `loadMermaid()` before it looks for `window.pele`.
Obsidian loads Pele on first use. Without that call, the sandbox
started with Obsidian's own mount in place and the circular diagrams
drawn by Obsidian's Pele; the wrapped mount took hold only after a
plugin reload. The mermaid-era plugin made the same call first.

Costs:

- Obsidian 1.13 and 1.14 are no longer supported. They bundled
  mermaid, not Pele, and the plugin registered
  `mermaid-layout-circular` with that mermaid. Without mermaid in
  the plugin there is nothing to register, so `minAppVersion` is
  now 1.15.0. The owner chose to require 1.15. This ships as
  0.10.0, and versions.json keeps 0.9.0 as the last release for
  Obsidian 1.13 and 1.14.
- A diagram's mermaid `theme:` and `look:` (such as `handDrawn`) are
  ignored, as they are for every diagram Obsidian draws. Pele has no
  hand-drawn look.

Checked in a sandboxed Obsidian 1.15.1 with `sandbox-fixtures/`:
both rings draw as circles in reading view and live preview, in the
dark and light themes. A theme switch recolors them. The plain
flowchart is drawn by Obsidian's Pele. Editing a block from circular
to another layout and back switches renderers in place, and
disabling the plugin hands the rings back to Obsidian's Pele.

## 2026-11-25: bump pele-layout-circular to a2439d0

The lockfile now resolves pele-layout-circular `a2439d0` (was `c5c8010`).
It lays out edges into collapsed subgraphs instead of dropping them, and
gives edges that cross a filled group Pele's halo. `main.js` grew from
187,553 to 190,609 bytes (74,052 to 75,254 gzipped). Checked in a
sandboxed Obsidian, reading view and live preview, light and dark: the
existing rings are unchanged, the collapsed subgraph draws as a node with
its edges, and the filled-group diagram draws its edges. Edges that run
inside a filled group, on a light custom fill in dark mode, are low
contrast. Pele recolors an edge that runs over a fill; the wrapper keeps
the color from Pele's own layout, a gap pele-layout-circular lists as
open. Added `sandbox-fixtures/Groups.md` for both cases.

## 2026-11-25: pele-layout-circular 0.2.0 from npm

The devDependency is now `pele-layout-circular@^0.2.0` from npm, in
place of `github:AndrewBroz/pele-layout-circular`. The lockfile
resolves the registry tarball. 0.2.0 is GitHub main `b9c8b92` plus the
version bump: `main.js` built from either is byte-identical. A
registry dependency needs no git checkout or prepare script at
install time.

It brings straight edges with `flowchart.curve: linear`, with opposite
pairs as parallel lines and their labels stepping aside; chords that
are always straight; edge ink that follows the circle over filled
groups; and group shapes placed by layout-circular: tight boxes, the
ring turned the least that clears them, bands for groups spanning half
the ring or more, and box titles at the bottom when edges cross the
top. `main.js` grew from 190,609 to 209,558 bytes (75,254 to 83,120
gzipped).

Added fixtures: a straight-edge triangle with a labeled opposite pair
in `Circular.md` (the daily cycle with its "skip the day" chord was
already there), and in `Groups.md` a filled group over six of eight
ring nodes, which draws as a band, and the wheel with a two-node group,
whose title sits at the bottom. Checked in a sandboxed Obsidian 1.15.1,
reading view and live preview, dark and light: every fixture draws as
described, the plain flowchart's drawing is the same with the plugin
on and off, and disabling the plugin hands every circular diagram back
to Obsidian's Pele. The sandbox window renders nothing while macOS
reports it hidden; turning off the window's background throttling over
CDP fixed that for the check. Limits are listed under "Not handled
yet" in the pele-layout-circular README, which the plugin README links.

## 2026-11-25: The README shows the plugin, then explains it

The README now opens with what the plugin does and an Obsidian
screenshot, then usage and install. Examples, what carries over, limits
and how the plugin hooks into Obsidian follow. The family table ("Which
package to use") comes after "How it works", since a reader here
already uses Obsidian. The wording follows the family's docs plan and
`layout-circular/docs/DOCS-STYLE.md`.

Pictures live in `docs/media/` and the README loads them by absolute
`raw.githubusercontent.com/.../main/` URL. Obsidian's community plugin
browser shows this README too, and absolute URLs work there whatever it
does with relative paths. `obsidian-note.png` is a 2x screenshot
of `sandbox-fixtures/The water cycle.md` in reading view: sandboxed
Obsidian 1.15.1, default theme, light mode, sidebars collapsed, window
560x540. The crop keeps the tab bar, ribbon and view header, so it reads
as Obsidian, and stops above the status bar; it has a 1 px gray border.
The eight `.svg` examples are Pele renders of the docs catalog with the
plugin's own pele 1.13.0 and pele-layout-circular 0.2.0, on a white
card so they read on GitHub's dark theme. Every picture displays at
0.65 of its natural size, so text is the same size in all of them and
the widest table row (the groups pair) stays near 630 px. Pele is what draws
circular diagrams in Obsidian, so these match what a user sees, minus their
theme. Redraw them with pele-layout-circular's
`scripts/render-docs.ts --out ../obsidian-mermaid-circular/docs/media`.

`package.json`'s description now reads "Obsidian plugin that draws
mermaid flowcharts on a circle". `manifest.json` is unchanged until the
next release, so the repo and the released manifest agree.

## 2026-11-26: pele-layout-circular 0.2.2 reaches the plugin

The devDependency is `pele-layout-circular@^0.2.2`. It carries
layout-circular 0.3.0, which picks a group's shape by fit. A group is a
box when one clears, however much of the ring it covers. A box may put
its title below where the ring can't turn to fit it on top. A group is
a band only when no box fits. The owner picked this from renders; it is
provisional and may change.

The README groups pair is now `lifecycle-box.svg` beside `hub-band.svg`,
a band around a hub outside the group. `lifecycle-band.svg` is gone:
the six-of-eight Funded group is a box now. The README loads pictures
from `main`, and no released copy points elsewhere, so the old file
needn't wait. Both pictures display at 0.65 of their natural size, as
before. `sandbox-fixtures/Groups.md` gains the hub band.

