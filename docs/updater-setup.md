# Updater setup (one time)

Folio updates itself from GitHub Releases, and update packages must be signed.
Until the steps below are done the updater stays off and **Check for
updates…** shows `Updates not configured`.

1. On your PC, generate a signing key pair:

   ```
   npx @tauri-apps/cli signer generate -w folio-updater.key
   ```

   Pick a password when asked. This writes `folio-updater.key` (private) and
   `folio-updater.key.pub` (public). Keep the private key out of the repo and
   out of chat.

2. On GitHub open **Settings → Secrets and variables → Actions → New
   repository secret** and add two secrets:

   - `TAURI_SIGNING_PRIVATE_KEY`: the full contents of `folio-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose

3. Put the contents of `folio-updater.key.pub` into `plugins.updater.pubkey`
   in `src-tauri/tauri.conf.json` and commit it (or send it to be committed).
   The public key is safe to publish.

Notes:

- The release job (tags `v*`) fails until both secrets exist, because it
  builds signed update packages.
- The release is created as a draft. The updater only sees **published**
  releases, so publish it (not a draft) after checking it.
