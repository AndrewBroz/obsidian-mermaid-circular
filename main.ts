import { loadMermaid, MarkdownView, Notice, Plugin } from 'obsidian';
import { mount as mountCircular, register, type Mounted, type MountOptions } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';
import { withCircularLayout } from 'pele-layout-circular';

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
 * Obsidian draws diagrams with Pele, its own renderer, which has no
 * pluggable layouts. So the plugin carries a private Pele that knows
 * only the flowchart, wrapped with the circular layout, and intercepts
 * window.pele.mount, the call both reading view and live preview make
 * for each mermaid block. Diagrams that ask for a circular layout are
 * mounted on the private Pele; everything else goes straight through
 * to Obsidian's, untouched. Both are Pele, so a circular diagram takes
 * Obsidian's palette, fonts, zoom and redraws exactly as any other
 * diagram does. pele.mount is not a documented plugin API, so a future
 * Obsidian release may move it; the plugin then says so instead of
 * failing silently.
 */
export default class MermaidCircularPlugin extends Plugin {
  private restoreMount?: () => void;

  override async onload() {
    // Obsidian loads Pele on first use. loadMermaid() is the public
    // call that loads it, and window.pele exists only after it.
    await loadMermaid();
    const global = window as { pele?: Pele };
    const pele = global.pele;

    if (typeof pele?.mount !== 'function') {
      new Notice(
        'Mermaid Circular Layout: this Obsidian build draws diagrams in a ' +
          'way the plugin does not recognize. The plugin is inactive.'
      );
      return;
    }

    register(withCircularLayout(flowchart));
    // pele is a bundler's export object: its members are getters that
    // cannot be reassigned. Obsidian reaches it through the global
    // binding, so swap the whole object for a copy whose mount is
    // wrapped, and put the original back on unload.
    global.pele = { ...pele, mount: interceptMount(pele) };
    this.restoreMount = () => {
      global.pele = pele;
    };
    // Enabled mid-session: diagrams already on screen were drawn by
    // Obsidian's Pele, and Obsidian redraws a block only when its
    // source changes. On startup nothing has been drawn yet, so there
    // is nothing to redo.
    if (this.app.workspace.layoutReady) this.redrawCircularNotes();
  }

  override onunload() {
    if (!this.restoreMount) return;
    this.restoreMount();
    // Hand the circular diagrams on screen back to Obsidian's Pele.
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

/** Obsidian's Pele, as the plugin uses it: only its mount. */
interface Pele {
  mount(el: HTMLElement, source: string, options?: MountOptions): Mounted;
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
 * Wraps Obsidian's pele.mount. Every controller it returns can switch
 * between Obsidian's Pele and the private one on update(): Obsidian
 * recycles rendered blocks, and may hand a block that held one kind of
 * diagram the source of the other.
 */
function interceptMount(pele: Pele): Pele['mount'] {
  const mountWith = (circular: boolean, el: HTMLElement, source: string, options?: MountOptions) =>
    circular ? mountCircular(el, source, options) : pele.mount(el, source, options);

  return function mount(el, initialSource, initialOptions) {
    let source = initialSource;
    let options = initialOptions;
    let circular = asksForCircular(source);
    let delegate = mountWith(circular, el, source, options);

    return {
      get source() {
        return source;
      },
      get result() {
        return delegate.result;
      },
      get error() {
        return delegate.error;
      },
      get zoom() {
        return delegate.zoom;
      },
      update(next, nextOptions = options) {
        source = next;
        options = nextOptions;
        const wantsCircular = asksForCircular(source);
        if (wantsCircular === circular) {
          delegate.update(source, options);
          return;
        }
        delegate.destroy();
        circular = wantsCircular;
        delegate = mountWith(circular, el, source, options);
      },
      refresh() {
        delegate.refresh();
      },
      destroy() {
        delegate.destroy();
      },
    };
  };
}
