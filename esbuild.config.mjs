import esbuild from 'esbuild';
import process from 'node:process';

const watch = process.argv[2] === 'watch';

const context = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  logLevel: 'info',
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
