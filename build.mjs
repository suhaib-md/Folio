// Bundles src/ into one self-contained dist/folio.html.
// With --desktop: bundles the desktop app shell into dist-desktop/ instead.
import { build } from 'esbuild';
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

// The small app icon as a data URI (both pages inline it as the favicon; the
// desktop title bar shows it too). Its <metadata> block is provenance only.
async function favicon() {
  const svg = (await readFile('assets/folio-icon-small.svg', 'utf8'))
    .replace(/<metadata>[\s\S]*?<\/metadata>/, '')
    .replace(/\s+xmlns:c2pa="[^"]*"/, '')
    .replace(/>\s+</g, '><')
    .trim();
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

if (process.argv.includes('--desktop')) {
  await buildDesktop();
} else {
  await buildWeb();
}

// dist-desktop/: index.html + app.js (ES module) + app.css, plus chunks/ for
// code loaded on demand (the editor's fenced-code languages). Served as
// separate files (Tauri's CSP allows 'self' scripts, no inline ones).
async function buildDesktop() {
  await rm('dist-desktop/chunks', { recursive: true, force: true });
  await mkdir('dist-desktop', { recursive: true });
  await build({
    entryPoints: { app: 'src/desktop/main.js' },
    outdir: 'dist-desktop',
    chunkNames: 'chunks/[name]-[hash]',
    splitting: true,
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
  const icon = await favicon();
  const page = (await readFile('src/desktop/index.html', 'utf8')).replaceAll('__FAVICON__', () => icon);
  await writeFile('dist-desktop/index.html', page);
  // Geist, Geist Mono and Newsreader (OFL), referenced by app.css.
  await rm('dist-desktop/fonts', { recursive: true, force: true });
  await cp('src/desktop/fonts', 'dist-desktop/fonts', { recursive: true });
  // KaTeX's stylesheet loads lazily (the first time maths renders); it refers
  // to fonts/ next to itself.
  await rm('dist-desktop/katex', { recursive: true, force: true });
  await mkdir('dist-desktop/katex', { recursive: true });
  await copyFile('node_modules/katex/dist/katex.min.css', 'dist-desktop/katex/katex.min.css');
  await cp('node_modules/katex/dist/fonts', 'dist-desktop/katex/fonts', { recursive: true });
  console.log('dist-desktop/  index.html, app.js, app.css, chunks/, fonts/, katex/');
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
  const icon = await favicon();

  // Function replacers so "$" sequences in the bundle are left alone.
  const html = template
    .replace('__FAVICON__', () => icon)
    .replace('/*__CSS__*/', () => css)
    .replace('/*__JS__*/', () => js);

  await mkdir('dist', { recursive: true });
  await writeFile('dist/folio.html', html);
  console.log(`dist/folio.html  ${(html.length / 1024).toFixed(0)} KB`);
}
