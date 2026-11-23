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
      const theme = renderer.theme();
      void renderer.render(source).then(
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
        // Obsidian refreshes every diagram when the theme or fonts
        // change. Mermaid bakes its colors into the svg, so a circular
        // diagram redraws only when the light/dark theme has flipped.
        if (!circular) delegate?.refresh();
        else if (drawnTheme !== renderer.theme()) drawCircular();
      },
      destroy() {
        destroyed = true;
        delegate?.destroy();
        delegate = undefined;
      },
    };
  };
}

/** Lazily loads the plugin's own mermaid and draws with it. */
class CircularRenderer {
  private mermaid?: Promise<Mermaid>;
  private configuredFor?: string;
  private count = 0;

  theme(): 'dark' | 'default' {
    return document.body.classList.contains('theme-dark') ? 'dark' : 'default';
  }

  async render(source: string): Promise<string> {
    const mermaid = await (this.mermaid ??= this.load());
    const theme = this.theme();
    const font = getComputedStyle(document.body).getPropertyValue('--font-mermaid').trim();
    const key = `${theme}|${font}`;
    if (key !== this.configuredFor) {
      // Frontmatter config in a diagram still overrides these.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        ...(font && { fontFamily: font, themeVariables: { fontFamily: font } }),
      });
      this.configuredFor = key;
    }
    const { svg } = await mermaid.render(`mermaid-circular-${++this.count}`, source);
    return svg;
  }

  private async load(): Promise<Mermaid> {
    const { default: mermaid } = await import('mermaid');
    mermaid.registerLayoutLoaders(circularLayouts);
    return mermaid;
  }
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
