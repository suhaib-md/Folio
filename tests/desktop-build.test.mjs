import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

test('desktop build writes index.html, app.js and app.css', () => {
  execFileSync(process.execPath, ['build.mjs', '--desktop']);
  for (const f of ['index.html', 'app.js', 'app.css']) {
    assert.ok(existsSync(`dist-desktop/${f}`), `dist-desktop/${f} missing`);
  }
  const html = readFileSync('dist-desktop/index.html', 'utf8');
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /href="\.\/app\.css"/);
  assert.doesNotMatch(html, /<script>/, 'no inline scripts (CSP)');
  const css = readFileSync('dist-desktop/app.css', 'utf8');
  assert.ok(css.includes(readFileSync('src/styles.css', 'utf8')));
  assert.ok(css.includes(readFileSync('src/desktop/app.css', 'utf8')));
});

test('desktop build splits on-demand code into chunks/ that all resolve', () => {
  execFileSync(process.execPath, ['build.mjs', '--desktop']);
  const chunks = readdirSync('dist-desktop/chunks');
  assert.ok(chunks.length > 0, 'no chunks');
  // Every relative import (static or dynamic) in app.js and the chunks
  // points at a file that exists, so lazy language loading can't 404.
  const files = ['dist-desktop/app.js', ...chunks.map((c) => `dist-desktop/chunks/${c}`)];
  const dynamic = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(import\(|from|import)\s*"(\.\.?\/[^"]+)"/g)) {
      const target = path.join(path.dirname(f), m[2]);
      assert.ok(existsSync(target), `${f} imports missing ${m[2]}`);
      if (m[1] === 'import(') dynamic.push(target);
    }
  }
  assert.ok(dynamic.some((p) => /python/i.test(readFileSync(p, 'utf8'))), 'language chunks not split out');
});

test('only backend.js imports @tauri-apps', () => {
  const files = readdirSync('src/desktop').filter((f) => f.endsWith('.js'));
  assert.ok(files.includes('backend.js'));
  for (const f of files) {
    if (f === 'backend.js') continue;
    const src = readFileSync(`src/desktop/${f}`, 'utf8');
    assert.doesNotMatch(src, /@tauri-apps/, `${f} imports @tauri-apps`);
  }
});

test('default build still produces dist/folio.html with one </body>', () => {
  execFileSync(process.execPath, ['build.mjs']);
  const html = readFileSync('dist/folio.html', 'utf8');
  assert.equal(html.match(/<\/body>/gi).length, 1);
});
