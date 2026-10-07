// Bundles src/ into one self-contained dist/folio.html.
// With --desktop: bundles the desktop app shell into dist-desktop/ instead.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

if (process.argv.includes('--desktop')) {
  await buildDesktop();
} else {
  await buildWeb();
}

// dist-desktop/: index.html + app.js (ES module) + app.css. Served as
// separate files (Tauri's CSP allows 'self' scripts, no inline ones).
async function buildDesktop() {
  await mkdir('dist-desktop', { recursive: true });
  await build({
    entryPoints: ['src/desktop/main.js'],
    outfile: 'dist-desktop/app.js',
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2022',
    legalComments: 'none',
  });
  const css = [
    await readFile('src/styles.css', 'utf8'),
    await readFile('src/desktop/app.css', 'utf8'),
  ].join('\n');
  await writeFile('dist-desktop/app.css', css);
  await copyFile('src/desktop/index.html', 'dist-desktop/index.html');
  console.log('dist-desktop/  index.html, app.js, app.css');
}

async function buildWeb() {
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
}
