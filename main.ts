import { loadMermaid, Notice, Plugin } from 'obsidian';
import circularLayouts from 'mermaid-layout-circular';

/**
 * Registers the circular layout with Obsidian's bundled mermaid.
 * After that, any mermaid flowchart in a note can opt in per diagram:
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
 * mermaid keeps registered layouts in a module-level registry, so one
 * registration covers every render for the life of the app process.
 * mermaid has no unregister call; after the plugin is disabled the
 * layout stays available until Obsidian restarts, which is harmless.
 */
export default class MermaidCircularPlugin extends Plugin {
  override async onload() {
    const mermaid = await loadMermaid();
    if (typeof mermaid?.registerLayoutLoaders !== 'function') {
      new Notice(
        'Mermaid Circular Layout: this Obsidian build bundles a mermaid ' +
          'without pluggable layouts. The plugin is inactive.'
      );
      return;
    }
    mermaid.registerLayoutLoaders(circularLayouts);
  }
}
