// Bundles src/ into one self-contained dist/md-viewer.html.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  target: 'es2020',
  write: false,
  legalComments: 'none',
});

// Keep the HTML parser from ending the inline script early. "\x21" is "!"
// and stays valid inside strings and unicode regexes ("\!" is not).
const js = result.outputFiles[0].text
  .replace(/<\/script/gi, '<\\/script')
  .replace(/<!--/g, '<\\x21--');
const css = await readFile('src/styles.css', 'utf8');
const template = await readFile('src/index.html', 'utf8');

// Function replacers so "$" sequences in the bundle are left alone.
const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

await mkdir('dist', { recursive: true });
await writeFile('dist/md-viewer.html', html);
console.log(`dist/md-viewer.html  ${(html.length / 1024).toFixed(0)} KB`);
