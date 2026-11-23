import esbuild from 'esbuild';
import process from 'node:process';

const watch = process.argv[2] === 'watch';

/**
 * The plugin's mermaid only ever draws diagrams that ask for a
 * circular layout. mermaid reaches the packages below solely through
 * lazily loaded chunks for other layouts (elk, cose-bilkent) and for
 * diagram types that need cytoscape (mindmap, architecture), none of
 * which this plugin hands to mermaid. Replacing them with a stub that
 * throws on use saves about 2 MB; if one were ever reached, the
 * diagram shows an error box instead of rendering.
 */
const UNREACHABLE = /^(elkjs|cytoscape|cytoscape-cose-bilkent|cytoscape-fcose|cose-base|layout-base)(\/|$)/;

const stubUnreachable = {
  name: 'stub-unreachable',
  setup(build) {
    build.onResolve({ filter: UNREACHABLE }, (args) => ({
      path: args.path,
      namespace: 'stub-unreachable',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-unreachable' }, (args) => ({
      contents:
        `const fail = () => { throw new Error(${JSON.stringify(
          `${args.path} is not bundled with Mermaid Circular Layout`
        )}); };\n` +
        'module.exports = new Proxy(fail, { get: (_, key) => key === "__esModule" ? false : fail, apply: fail, construct: fail });\n',
      loader: 'js',
    }));
  },
};

const context = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  treeShaking: true,
  logLevel: 'info',
  plugins: [stubUnreachable],
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
