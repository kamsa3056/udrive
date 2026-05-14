import { build } from 'esbuild';

await build({
  entryPoints: ['src/cf.js'],
  bundle: true,
  outfile: 'dist/_worker.js',
  format: 'esm',
  target: 'es2022',
  platform: 'neutral',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:crypto', 'node:util'],
  sourcemap: true,
  minify: true
});

console.log('Built dist/_worker.js');
