# Releasing ClipCork

ClipCork ships signed & notarized macOS builds to GitHub Releases via
`.github/workflows/release.yml` (Apple Silicon + Intel). The workflow uses
`tauri-apps/tauri-action`, which builds, Developer-ID-signs, notarizes, staples,
publishes the `.dmg` installers, and publishes the signed updater manifest
(`latest.json`) that installed apps read to auto-update.

## One-time setup (already done for the first release)

Repository secrets on `beecork/clipcork` (values come from **CozyKey** — GitHub
secrets are write-only). Apple values are shared with the other Beecork apps
(same Developer ID identity, team `X3F4527AS7`); the updater key is unique to
ClipCork.

| Secret | Source |
|---|---|
| `APPLE_CERTIFICATE` | shared Developer ID cert (.p12 base64) — CozyKey |
| `APPLE_CERTIFICATE_PASSWORD` | CozyKey |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Levan Bakhia (X3F4527AS7)` |
| `APPLE_ID` | `wertiliio9@gmail.com` |
| `APPLE_PASSWORD` | app-specific password — CozyKey |
| `APPLE_TEAM_ID` | `X3F4527AS7` |
| `TAURI_SIGNING_PRIVATE_KEY` | **ClipCork's own** updater private key — CozyKey (`clipcork` slug) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | CozyKey (`clipcork` slug) |

The updater **public** key is baked into `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). **Never regenerate the updater keypair** — the public
key in the config must match the private key in secrets and in every installed
copy, or existing installs reject all future updates.

## Cutting a release

1. Bump the version in all five files to `X.Y.Z` (no `v`):
   `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, then run
   `npm install` (refreshes `package-lock.json` and `src-tauri/Cargo.lock`).
2. Commit, then tag (annotated) and push:
   ```bash
   git commit -am vX.Y.Z
   git tag -a vX.Y.Z -m vX.Y.Z
   git push --follow-tags
   ```
3. **Dispatch** the workflow (a tag push alone does not reliably start a run):
   ```bash
   gh workflow run release.yml --ref vX.Y.Z
   ```
4. Verify the release published with its assets:
   ```bash
   gh release view vX.Y.Z -R beecork/clipcork --json assets --jq '.assets[].name'
   ```
   Expect `ClipCork_X.Y.Z_aarch64.dmg`, `ClipCork_X.Y.Z_x64.dmg`, the
   `.app.tar.gz`(+`.sig`) updater payloads, and `latest.json`.

## Notes

- The `checks` job fails fast if the five version files disagree with the tag.
- The org enforces read-only default workflow permissions; the `release` job
  requests `contents: write` explicitly so it can create the release.
- ClipCork is macOS-only — there is intentionally no Windows/Linux build.
