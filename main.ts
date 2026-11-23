import { loadMermaid, MarkdownView, Notice, Plugin } from 'obsidian';
import type { Mermaid } from 'mermaid';
import circularLayouts from 'mermaid-layout-circular';

/**
 * Adds the circular layout to mermaid flowcharts in Obsidian.
 * A diagram opts in with frontmatter inside the mermaid fence:
 *
 *   ```mermaid
 *   ---
 *   config:
 *     layout: circular
 *   ---
 *   flowchart LR
 *     A --> B --> C --> A
 *   ```
 *
 * layout: circular-ccw runs the same ring counter-clockwise.
 *
 * Two eras of Obsidian need two seams:
 *
 * - Before 1.15, Obsidian bundled mermaid itself, and loadMermaid()
 *   returned it. The layout registers with that instance and mermaid
 *   does the rest.
 *
 * - From 1.15, Obsidian draws diagrams with Pele, its own renderer,
 *   which has no pluggable layouts. loadMermaid() returns a shim over
 *   Pele. So the plugin carries its own mermaid and intercepts
 *   window.pele.mount, the call both reading view and live preview
 *   make for each mermaid block. Diagrams that ask for a circular
 *   layout are drawn by that mermaid; everything else goes straight
 *   through to Pele, untouched. pele.mount is not a documented plugin
 *   API, so a future Obsidian release may move it; the plugin then
 *   says so instead of failing silently.
 */
export default class MermaidCircularPlugin extends Plugin {
  private restoreMount?: () => void;

  override async onload() {
    const host = await loadMermaid();
    const global = window as { pele?: Pele };
    const pele = global.pele;

    if (pele) {
      if (typeof pele.mount !== 'function') {
        new Notice(
          'Mermaid Circular Layout: this Obsidian build draws diagrams in a ' +
            'way the plugin does not recognize. The plugin is inactive.'
        );
        return;
      }
      // pele is a bundler's export object: its members are getters
      // that cannot be reassigned. Obsidian reaches it through the
      // global binding, so swap the whole object for a copy whose
      // mount is wrapped, and put the original back on unload.
      global.pele = {
        ...pele,
        mount: interceptMount(pele, pele.mount, new CircularRenderer()),
      };
      this.restoreMount = () => {
        global.pele = pele;
      };
      // Enabled mid-session: diagrams already on screen were drawn by
      // Pele, and Obsidian redraws a block only when its source
      // changes. On startup the layout is not ready yet and nothing
      // has been drawn, so there is nothing to redo.
      if (this.app.workspace.layoutReady) this.redrawCircularNotes();
      return;
    }

    if (typeof host?.registerLayoutLoaders === 'function') {
      // mermaid has no unregister call; after the plugin is disabled
      // the layout stays available until Obsidian restarts, which is
      // harmless.
      host.registerLayoutLoaders(circularLayouts);
      return;
    }

    new Notice(
      'Mermaid Circular Layout: this Obsidian build bundles a mermaid ' +
        'without pluggable layouts. The plugin is inactive.'
    );
  }

  override onunload() {
    if (!this.restoreMount) return;
    this.restoreMount();
    // Hand the circular diagrams on screen back to Pele.
    this.redrawCircularNotes();
  }

  /**
   * Rebuilds every open markdown view whose note holds a circular
   * diagram, so reading view and live preview both mount it afresh.
   * rebuildView is not in Obsidian's typings; without it the diagrams
   * on screen simply wait for the note to be reopened.
   */
  private redrawCircularNotes() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !CIRCULAR_MENTION.test(view.getViewData())) continue;
      const rebuild = (leaf as { rebuildView?: () => Promise<void> }).rebuildView;
      void rebuild?.call(leaf);
    }
  }
}

/** A cheap pre-filter: a note that never says this cannot need a redraw. */
const CIRCULAR_MENTION = /layout['"]?\s*:\s*['"]?circular/;

// ---------------------------------------------------------------------------
// The Pele seam, as Obsidian 1.15 uses it. Only the members Obsidian
// touches are typed: it keeps the controller mount returns, reads
// .source, and calls .update(), .refresh() and .destroy() on it.

type MountOptions = Record<string, unknown> & {
  onRender?: (result: unknown) => void;
  onError?: (error: unknown) => void;
};

interface PeleController {
  readonly source: string;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly zoom?: unknown;
  update(source: string, options?: MountOptions): void;
  refresh(): void;
  destroy(): void;
}

interface Pele {
  mount(el: HTMLElement, source: string, options?: MountOptions): PeleController;
}

const FRONTMATTER = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/;
const LAYOUT_LINE = /^[ \t]*layout[ \t]*:[ \t]*(['"]?)circular(?:-ccw)?\1[ \t]*(?:#.*)?$/m;
const INIT_DIRECTIVE = /%%\{[\s\S]*?['"]?layout['"]?\s*:\s*['"]circular(?:-ccw)?['"][\s\S]*?\}%%/;

/** Whether a mermaid source asks for one of this plugin's layouts. */
export function asksForCircular(source: string): boolean {
  const front = FRONTMATTER.exec(source);
  if (front && LAYOUT_LINE.test(front[1]!)) return true;
  return INIT_DIRECTIVE.test(source);
}

/**
 * Wraps pele.mount. Every controller it returns can switch between
 * Pele and mermaid on update(): Obsidian recycles rendered blocks, and
 * may hand a block that held one kind of diagram the source of the
 * other.
 */
function interceptMount(
  pele: Pele,
  original: Pele['mount'],
  renderer: CircularRenderer
): Pele['mount'] {
  return function mount(el, initialSource, initialOptions = {}) {
    let source = initialSource;
    let options = initialOptions;
    let delegate: PeleController | undefined;
    let circular = false;
    let generation = 0;
    let destroyed = false;
    let error: unknown;
    let result: unknown;
    let drawnTheme: string | undefined;

    const drawCircular = () => {
      const mine = ++generation;
      const theme = renderer.theme(el);
      void renderer.render(source, el).then(
        (svg) => {
          if (destroyed || mine !== generation) return;
          showSvg(el, svg);
          drawnTheme = theme;
          error = undefined;
          result = { svg };
          options.onRender?.(result);
        },
        (failure: unknown) => {
          if (destroyed || mine !== generation) return;
          console.error('Mermaid Circular Layout:', failure);
          error = failure;
          showError(el, failure);
          options.onError?.(failure);
        }
      );
    };

    const show = () => {
      if (asksForCircular(source)) {
        delegate?.destroy();
        delegate = undefined;
        circular = true;
        drawCircular();
        return;
      }
      generation++; // abandon any circular render still in flight
      circular = false;
      if (delegate) delegate.update(source, options);
      else delegate = original.call(pele, el, source, options);
    };

    show();

    return {
      get source() {
        return source;
      },
      get result() {
        return circular ? result : delegate?.result;
      },
      get error() {
        return circular ? error : delegate?.error;
      },
      get zoom() {
        return circular ? undefined : delegate?.zoom;
      },
      update(next, nextOptions = options) {
        source = next;
        options = nextOptions;
        show();
      },
      refresh() {
        // Obsidian refreshes every diagram when the theme, accent or
        // fonts change. Mermaid bakes its colors into the svg, so a
        // circular diagram redraws only when its palette has changed.
        if (!circular) delegate?.refresh();
        else if (drawnTheme !== renderer.theme(el)) drawCircular();
      },
      destroy() {
        destroyed = true;
        delegate?.destroy();
        delegate = undefined;
      },
    };
  };
}

/**
 * Lazily loads the plugin's own mermaid and draws with it, dressed
 * the way Obsidian dresses Pele.
 *
 * Obsidian sets its palette on every .mermaid container as --pele-*
 * variables, and Pele paints from them: nodes on the surface color
 * with a hairline border, 1px lines with small arrowheads, 14px edge
 * labels on the page background, translucent subgraph boxes. Mermaid's
 * base theme is fed the same values, resolved to concrete colors
 * (mermaid derives shades from them, and the hand-drawn look paints
 * with them directly), and a little theme CSS matches the geometry.
 * A diagram that names its own theme keeps it.
 */
class CircularRenderer {
  private mermaid?: Promise<Mermaid>;
  private configuredFor?: string;
  private count = 0;
  // mermaid looks its working elements up by id. Reloading the plugin
  // brings a second renderer while diagrams from the first may still
  // redraw, so each instance numbers its renders under its own prefix.
  private readonly prefix = `mermaid-circular-${Math.random().toString(36).slice(2, 8)}`;
  private queue: Promise<unknown> = Promise.resolve();

  /** A key that changes whenever the colors a diagram is drawn in would. */
  theme(el: HTMLElement): string {
    return JSON.stringify(readPalette(el));
  }

  render(source: string, el: HTMLElement): Promise<string> {
    // mermaid's configuration is global, so a render and the
    // configuration it was drawn with go through one at a time.
    const run = this.queue.then(() => this.renderNow(source, el));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderNow(source: string, el: HTMLElement): Promise<string> {
    const mermaid = await (this.mermaid ??= this.load());
    const palette = readPalette(el);
    const config = namesOwnTheme(source)
      ? {
          startOnLoad: false,
          securityLevel: 'strict' as const,
          theme: palette.dark ? ('dark' as const) : ('default' as const),
          ...(palette.font && { fontFamily: palette.font }),
        }
      : {
          startOnLoad: false,
          securityLevel: 'strict' as const,
          theme: 'base' as const,
          // mermaid 12's default "neo" look adds drop shadows; Pele is
          // flat. A diagram's own look: still wins.
          look: 'classic' as const,
          ...(palette.font && { fontFamily: palette.font }),
          themeVariables: themeVariables(palette),
          themeCSS: themeCSS(palette),
        };
    const key = JSON.stringify(config);
    if (key !== this.configuredFor) {
      mermaid.initialize(config);
      this.configuredFor = key;
    }
    const { svg } = await mermaid.render(`${this.prefix}-${++this.count}`, source);
    return svg;
  }

  private async load(): Promise<Mermaid> {
    const { default: mermaid } = await import('mermaid');
    mermaid.registerLayoutLoaders(circularLayouts);
    return mermaid;
  }
}

// ---------------------------------------------------------------------------
// Obsidian's diagram palette, as Pele reads it.

interface Palette {
  dark: boolean;
  bg: string;
  fg: string;
  muted: string;
  line: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  radius: string;
  font: string;
}

/** Pele's own fallbacks, for a container that defines none of these. */
const PALETTE_VARS = {
  bg: ['--pele-bg', '#ffffff'],
  fg: ['--pele-fg', '#1f1f1f'],
  muted: ['--pele-muted', '#6e6e6e'],
  line: ['--pele-line', '#1f1f1f'],
  surface: ['--pele-surface', '#f3f3f3'],
  surfaceAlt: ['--pele-surface-alt', '#e6e6e6'],
  border: ['--pele-border', '#8a8a8a'],
} as const;

function readPalette(el: HTMLElement): Palette {
  const doc = el.ownerDocument;
  const style = getComputedStyle(el.isConnected ? el : doc.body);
  const colors = {} as Record<keyof typeof PALETTE_VARS, string>;
  for (const [name, [variable, fallback]] of Object.entries(PALETTE_VARS)) {
    colors[name as keyof typeof PALETTE_VARS] = resolveColor(doc, `var(${variable}, ${fallback})`, fallback);
  }
  const radius = style.getPropertyValue('--pele-radius').trim();
  return {
    dark: doc.body.classList.contains('theme-dark'),
    ...colors,
    radius: /^\d+(\.\d+)?px$/.test(radius) ? radius : '4px',
    font: style.getPropertyValue('--pele-font').trim(),
  };
}

let probeCanvas: CanvasRenderingContext2D | null | undefined;

/**
 * A CSS color, as rgba() mermaid can parse. Obsidian's colors may be
 * written with hsl(var(...)), color-mix() and the like, which mermaid's
 * color math cannot read, so the browser resolves the value and paints
 * it, and the pixel is read back.
 */
function resolveColor(doc: Document, css: string, fallback: string): string {
  const probe = doc.createElement('span');
  probe.style.color = css;
  probe.style.display = 'none';
  doc.body.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  probeCanvas ??= Object.assign(doc.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', {
    willReadFrequently: true,
  });
  if (!probeCanvas) return computed || fallback;
  probeCanvas.clearRect(0, 0, 1, 1);
  probeCanvas.fillStyle = fallback;
  probeCanvas.fillStyle = computed;
  probeCanvas.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probeCanvas.getImageData(0, 0, 1, 1).data as unknown as number[];
  return `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 255) / 255) * 1000) / 1000})`;
}

function themeVariables(p: Palette): Record<string, string | boolean> {
  return {
    darkMode: p.dark,
    background: p.bg,
    ...(p.font && { fontFamily: p.font }),
    fontSize: '16px',
    primaryColor: p.surface,
    primaryTextColor: p.fg,
    primaryBorderColor: p.border,
    secondaryColor: p.surfaceAlt,
    tertiaryColor: p.surfaceAlt,
    mainBkg: p.surface,
    nodeBorder: p.border,
    nodeTextColor: p.fg,
    textColor: p.fg,
    titleColor: p.muted,
    lineColor: p.line,
    arrowheadColor: p.line,
    clusterBkg: p.surfaceAlt,
    clusterBorder: p.border,
    edgeLabelBackground: p.bg,
  };
}

/** Pele's geometry: hairlines, its corner radius, smaller edge labels. */
function themeCSS(p: Palette): string {
  return [
    `.node rect, .node circle, .node ellipse, .node polygon, .node path { stroke-width: 1px; }`,
    `.node rect.basic { rx: ${p.radius}; ry: ${p.radius}; }`,
    `.flowchart-link { stroke-linecap: round; }`,
    `.edge-thickness-normal { stroke-width: 1px; }`,
    `.edge-thickness-thick { stroke-width: 2.5px; }`,
    `.edge-pattern-dotted { stroke-dasharray: 3 4; }`,
    `.edgeLabel { font-size: 14px; }`,
    `.edgeLabel p, .edgeLabel .labelBkg, .labelBkg { background-color: ${p.bg}; border-radius: 3px; }`,
    `.cluster rect { fill-opacity: 0.5; rx: ${p.radius}; ry: ${p.radius}; }`,
    `.cluster-label, .cluster-label .nodeLabel { color: ${p.muted}; fill: ${p.muted}; }`,
  ].join('\n');
}

/** Whether a diagram picks its own mermaid theme in its config. */
function namesOwnTheme(source: string): boolean {
  const front = FRONTMATTER.exec(source);
  if (front && /^[ \t]*theme(Variables)?[ \t]*:/m.test(front[1]!)) return true;
  return /%%\{[\s\S]*?['"]?theme(Variables)?['"]?\s*:[\s\S]*?\}%%/.test(source);
}

function showSvg(el: HTMLElement, svg: string) {
  // mermaid's strict security level has already sanitized the labels;
  // parsing as an inert document runs no scripts on the way in.
  const parsed = new DOMParser().parseFromString(svg, 'text/html');
  const root = parsed.body.firstElementChild;
  el.replaceChildren(...(root ? [el.ownerDocument.adoptNode(root)] : []));
}

function showError(el: HTMLElement, failure: unknown) {
  const message = failure instanceof Error ? failure.message : String(failure);
  const box = el.ownerDocument.createElement('div');
  box.className = 'pele pele-error';
  box.textContent = `Mermaid Circular Layout: ${message}`;
  el.replaceChildren(box);
}
