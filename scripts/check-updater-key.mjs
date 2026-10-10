// Release guard: a build without the updater public key ships installs that
// can never update. Run by the release job before the build.
import { readFileSync } from 'node:fs';

const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
if (!conf.plugins?.updater?.pubkey?.trim()) {
  console.error('::error::Commit the updater public key (docs/updater-setup.md) before tagging a release.');
  process.exit(1);
}
