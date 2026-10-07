// Bundles src/ into one self-contained dist/folio.html.
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

// Keep closing tags out of the inline script: "</script" would end it early,
// and tools like VS Code Live Server inject at the first "</body>" they see.
// "\/" and "\x21" ("!") stay valid inside strings and unicode regexes ("\!"
// is not). Only named tags are escaped: a bare "</" can be a regex like /</g.
const js = result.outputFiles[0].text
  .replace(/<\/(script|body|head|html)/gi, '<\\/$1')
  .replace(/<!--/g, '<\\x21--');
const css = await readFile('src/styles.css', 'utf8');
const template = await readFile('src/index.html', 'utf8');

// Function replacers so "$" sequences in the bundle are left alone.
const html = template
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

await mkdir('dist', { recursive: true });
await writeFile('dist/folio.html', html);
console.log(`dist/folio.html  ${(html.length / 1024).toFixed(0)} KB`);
