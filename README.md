# ClipCork

A menu-bar clipboard manager for macOS. ClipCork lives in your menu bar, keeps a
history of what you copy, and lets you save reusable snippets (email templates,
addresses, code, links) — all stored locally, no account, no server.

Part of the [Beecork](https://beecork.com) family of tools.

## Features

- **Clipboard history** — automatically records recent clipboard text (default 20
  entries, configurable 5/10/20/50 in Settings). Recording can be turned off from
  Settings, and copies marked concealed by password managers are never recorded.
- **Snippets** — save any text with a title and optional tag; instant search.
- **Paste into the focused app** — one click pastes a history entry or snippet
  straight into whatever app is in front (synthetic ⌘V).
- **Pin** — promote any clipboard entry to a saved snippet.
- **Menu-bar panel** — click the tray icon and the panel folds out beneath it,
  floating above fullscreen apps; click away to dismiss.
- **Local only** — the app makes no network requests.

## Requirements & permissions

- macOS 11 (Big Sur) or later. ClipCork is macOS-only.
- **Accessibility permission** is required for the *Paste* action, because it
  synthesizes a ⌘V keystroke. Grant it in System Settings → Privacy & Security →
  Accessibility. Copy and history work without it; only Paste needs it.

## Data storage

All data is stored locally as plaintext JSON in
`~/Library/Application Support/com.beecork.clipcork/`:

- `snippets.json` — your saved snippets
- `clipboard_history.json` — recent clipboard contents
- `settings.json` — your preferences

Files are written with owner-only permissions (`0600`). Because clipboard history
is recorded in plaintext, treat that folder as sensitive: exclude it from shared
backups if that matters to you, and use Settings → **Clear Clipboard History** or
turn recording **Off** when handling secrets. ClipCork honors the macOS
"concealed" pasteboard marker, so passwords copied from a password manager are
skipped, but text copied from a plain document carries no marker and would be
recorded while recording is on.

## Development

```bash
npm install
npm run dev      # run in development
npm run build    # build a release bundle
```

- **Framework**: Tauri 2 (Rust backend + a dependency-free HTML/CSS/JS frontend).
- **Frontend**: the served frontend is the `dist/` directory (see
  `src-tauri/tauri.conf.json` → `frontendDist`). Edit files there, not elsewhere.
- **Backend**: `src-tauri/src/lib.rs`. Run backend tests with
  `cd src-tauri && cargo test`.

## Releases

Signed & notarized macOS builds are published to GitHub Releases and auto-update
via the Tauri updater. See `RELEASING.md` for the release procedure.

## License

MIT — see [LICENSE](LICENSE).
