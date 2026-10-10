import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync('src/styles.css', 'utf8');
const app = readFileSync('src/desktop/app.css', 'utf8');

// Custom-property declarations inside the first block that follows `opener`.
function vars(css, opener) {
  const start = css.indexOf(opener);
  assert.ok(start >= 0, `${opener} not found`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test('forced-dark variables (app.css) equal the system-dark variables (styles.css)', () => {
  const system = vars(styles, ':root:not([data-theme="light"])');
  const forced = vars(app, ':root[data-theme="dark"]');
  assert.ok(Object.keys(system).length > 20);
  assert.deepEqual(forced, system);
});

test('every variable the dark blocks set has a light default', () => {
  const light = { ...vars(styles, ':root {'), ...vars(app, ':root {') };
  for (const name of Object.keys(vars(app, ':root[data-theme="dark"]'))) assert.ok(name in light, name);
});

test('desktop chrome has no unguarded prefers-color-scheme rules', () => {
  assert.doesNotMatch(app, /prefers-color-scheme/);
});
