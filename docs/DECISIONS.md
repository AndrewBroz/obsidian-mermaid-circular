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
| after (Pele 1.13) | 187,521 | 74,024 |

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
  now 1.15.0.
- A diagram's mermaid `theme:` and `look:` (such as `handDrawn`) are
  ignored, as they are for every diagram Obsidian draws. Pele has no
  hand-drawn look.

Checked in a sandboxed Obsidian 1.15.1 with `sandbox-fixtures/`:
both rings draw as circles in reading view and live preview, in the
dark and light themes. A theme switch recolors them. The plain
flowchart is drawn by Obsidian's Pele. Editing a block from circular
to another layout and back switches renderers in place, and
disabling the plugin hands the rings back to Obsidian's Pele.
