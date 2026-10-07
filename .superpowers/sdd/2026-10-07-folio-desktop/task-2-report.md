# Task 2 report
- RED: test written before tauri.conf.json existed; `npm test` -> tauri-config tests failed (file missing).
- GREEN: `npm test` -> pass 21, fail 0. `cargo check` and `cargo clippy -D warnings` on src-tauri clean (tauri 2.12.1 in Cargo.lock). folio-core tests still pass.
- No Cargo workspace; folio-core stays standalone, path dep. dist-desktop/index.html is a throwaway (gitignored).
- Icon: `tauri icon` accepted the SVG. Pruned android/ios/Square*/StoreLogo/64x64; kept 32x32, 128x128, 128x128@2x, icon.ico, icon.icns, icon.png.
- single-instance plugin is a normal (not windows-only) dep so it compiles on Linux checks; always registered first.
- Asset scope has lower+UPPER case entries. src-tauri/gen/ added to .gitignore (generated schemas; capability $schema points there).
- recent store kept in memory behind Mutex, saved on each add/remove.

## Fix round 1
- Lib renamed to `folio_lib` (crate-type staticlib/cdylib/rlib); main.rs calls `folio_lib::run()`.
- recent_add/recent_remove: clone, mutate, save, then store in memory.
- Single-instance callback joins argv entries to the callback cwd before the exists() filter and emits the joined paths.
- Config test RED (tauri.conf.json moved aside): `npm test` -> `# Error: ENOENT: no such file or directory, open '.../src-tauri/tauri.conf.json'`, pass 17 fail 1. GREEN restored: pass 21 fail 0.
- `cargo check` and `cargo clippy -D warnings`: clean.
