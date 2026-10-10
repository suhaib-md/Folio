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
  assert.equal(conf.version, '0.3.0');
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

const workflow = readFileSync(new URL('../.github/workflows/desktop.yml', import.meta.url), 'utf8');
const releaseJob = workflow.slice(workflow.indexOf('\n  release:'));

test('endpoint is the latest.json url', () => {
  const u = conf.plugins.updater;
  assert.deepEqual(u.endpoints, ['https://github.com/suhaib-md/Folio/releases/latest/download/latest.json']);
  // The minisign public key the release signing key pairs with (docs/updater-setup.md).
  assert.match(Buffer.from(u.pubkey, 'base64').toString(), /^untrusted comment: minisign public key: [0-9A-F]{16}\n\S+\n?$/);
  assert.equal(u.windows.installMode, 'passive');
});

test('updater artifacts are off in the file (non-tag builds have no signing key)', () => {
  assert.ok(!conf.bundle.createUpdaterArtifacts);
});

test('release job args enable updater artifacts', () => {
  assert.match(releaseJob, /^\s*args:\s*--config src-tauri\/tauri\.release\.conf\.json\s*$/m);
  const extra = JSON.parse(readFileSync(new URL('../src-tauri/tauri.release.conf.json', import.meta.url), 'utf8'));
  assert.deepEqual(extra, { bundle: { createUpdaterArtifacts: true } });
  assert.match(releaseJob, /includeUpdaterJson:\s*true/);
  assert.match(releaseJob, /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY\s*\}\}/);
  assert.match(releaseJob, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_SIGNING_PRIVATE_KEY_PASSWORD\s*\}\}/);
  assert.match(releaseJob, /releaseDraft:\s*true/);
});

test('release job needs test and windows', () => {
  assert.match(releaseJob, /needs:\s*\[\s*test\s*,\s*windows\s*\]/);
});

test('release job checks the updater key before building', () => {
  const check = releaseJob.indexOf('node scripts/check-updater-key.mjs');
  const action = releaseJob.indexOf('uses: tauri-apps/tauri-action');
  assert.ok(check > 0, 'release job runs the key check');
  assert.ok(check < action, 'key check runs before the tauri-action step');
});

test('frameless window with its own title bar controls', () => {
  assert.equal(conf.app.windows[0].decorations, false);
  const caps = JSON.parse(readFileSync(new URL('../src-tauri/capabilities/default.json', import.meta.url), 'utf8'));
  for (const p of ['minimize', 'toggle-maximize', 'internal-toggle-maximize', 'close', 'start-dragging', 'is-maximized']) {
    assert.ok(caps.permissions.includes(`core:window:allow-${p}`), p);
  }
});
