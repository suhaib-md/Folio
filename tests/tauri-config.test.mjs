import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const conf = JSON.parse(
  readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);

const CSP =
  "default-src 'self'; img-src 'self' asset: http://asset.localhost https: data:; style-src 'self' 'unsafe-inline'; connect-src ipc: http://ipc.localhost";

test('identity', () => {
  assert.equal(conf.identifier, 'com.suhaib.folio');
  assert.equal(conf.productName, 'Folio');
  assert.equal(conf.version, '0.2.0');
});

test('bundle', () => {
  assert.deepEqual(conf.bundle.targets, ['nsis']);
  assert.equal(conf.bundle.windows.nsis.installMode, 'currentUser');
  const fa = conf.bundle.fileAssociations[0];
  assert.deepEqual(fa.ext, ['md', 'markdown']);
  assert.equal(fa.name, 'Markdown document');
  assert.equal(fa.role, 'Editor');
});

test('frontend', () => {
  assert.equal(conf.build.frontendDist, '../dist-desktop');
  assert.equal(conf.build.beforeBuildCommand, 'npm run build:desktop');
});

test('security', () => {
  const sec = conf.app.security;
  assert.equal(sec.csp, CSP);
  assert.equal(sec.assetProtocol.enable, true);
  const scope = sec.assetProtocol.scope;
  assert.ok(scope.includes('**/*.png'));
  assert.ok(scope.includes('**/*.svg'));
  const exts = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i;
  for (const s of scope) assert.match(s, exts, `scope entry without image extension: ${s}`);
});
