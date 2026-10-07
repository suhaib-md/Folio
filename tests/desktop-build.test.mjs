import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

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
