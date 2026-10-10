# Updater setup (one time)

Folio updates itself from GitHub Releases, and update packages must be signed.
Until the steps below are done the updater stays off and **Check for
updates…** shows `Updates not configured`.

1. On your PC, generate a signing key pair:

   ```
   npx @tauri-apps/cli signer generate -w folio-updater.key
   ```

   It prompts for a password; pick one and remember it. This writes
   `folio-updater.key` (private) and `folio-updater.key.pub` (public).
   **Never commit the private key or the password, and never paste either
   into chat or an issue.** Back the private key up somewhere safe (a
   password manager): if it is lost, installed copies of Folio can't verify
   future updates and everyone must reinstall by hand.

2. On GitHub open **Settings → Secrets and variables → Actions → New
   repository secret** and add two secrets:

   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `folio-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose

3. Put the contents of `folio-updater.key.pub` into `plugins.updater.pubkey`
   in `src-tauri/tauri.conf.json` and commit it (or send the `.pub` contents
   to Claude to commit). The public key is safe to publish.

Notes:

- The release job (tags `v*`) fails until both secrets exist, because it
  builds signed update packages.
- The release is created as a draft. The updater only sees **published**
  releases, so publish it (not a draft) after checking it.

## Releasing and verifying

1. Bump the version everywhere (see **Releasing** in the README), commit, then
   `git tag v0.3.0` and `git push origin v0.3.0`.
2. CI builds the signed installer and update package and creates a **draft**
   release named `Folio v0.3.0`.
3. Open the draft on GitHub and check that its assets include the installer
   (`Folio_0.3.0_x64-setup.exe`), its `.sig` file and **`latest.json`**.
   `latest.json` is what installed copies read; without it there are no
   updates.
4. Publish the release. After that
   `https://github.com/suhaib-md/Folio/releases/latest/download/latest.json`
   returns the new version.
5. To test end to end, install 0.3.0, publish a test `v0.3.1`, and relaunch
   0.3.0: the update banner appears (see the 0.3 section of
   `docs/desktop-install-checklist.md`).
