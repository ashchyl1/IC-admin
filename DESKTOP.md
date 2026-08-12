# IndiaCharts desktop (Windows .exe)

The whole application — Next.js server, API routes, Kite Connect integration —
packaged into a Windows executable. Not a browser pointed at a website: the
server runs inside the app, on localhost, spawned by Electron at launch.

## Why it runs a server instead of shipping static files

The broker credentials live in the API routes. A Kite access token can place
orders on a live account, so it never goes to a renderer — on the desktop no
more than on the web. Exporting the app as static HTML would mean moving the
Kite API secret into the browser bundle, which is not a trade worth making for a
smaller binary.

So the packaged app contains Next's standalone server output, and
`electron/main.js` forks it with `ELECTRON_RUN_AS_NODE=1` — Electron's own Node
runs it, and the user does not need Node installed.

## Building

On any platform with Node 20+:

```bash
npm install
npm run desktop:win
```

Output lands in `release/`:

| Artifact | What it is |
|---|---|
| `IndiaCharts-<version>-portable.exe` | One file, ~83 MB. Double-click to run; nothing is installed. |
| `IndiaCharts-<version>-setup.zip` | The unpacked app, ~128 MB. Extract anywhere, run `IndiaCharts.exe`. |
| `IndiaCharts-<version>-setup.exe` | The NSIS installer — **only built on Windows or with Wine.** See below. |

The steps, if you want them separately:

| Command | Does |
|---|---|
| `npm run desktop:prepare` | `prisma generate`, `next build` (standalone), stage `dist-desktop/server` |
| `npm run desktop` | Launch the staged build in Electron locally — no packaging |
| `npm run desktop:pack` | Package only, reusing the staged build |
| `npm run desktop:win` | Both of the above, for Windows x64 |
| `npm run desktop:linux` | An AppImage, useful for testing the shell |
| `npm run desktop:icon` | Regenerate `build/icon.png` |

### What cross-building from Linux or macOS does and doesn't give you

`portable` and `zip` build anywhere — they are packaging, nothing more. Both are
complete, runnable Windows applications.

The **NSIS installer needs Wine on a non-Windows host**, and not for signing: to
produce `Uninstall.exe`, NSIS has to *run* the compiled installer once. The
config detects this and simply does not request the target it cannot build,
rather than failing the run after packaging. To get the installer:

```bash
npm run desktop:win               # on Windows — includes nsis automatically
WITH_NSIS=1 npm run desktop:win   # on Linux with wine installed
```

The same constraint costs the packaged exe its icon and version metadata:
`rcedit.exe` stamps those, and it too needs Wine. `IndiaCharts.exe` therefore
carries Electron's default icon when cross-built. The window, the taskbar entry
and the installer shortcuts are unaffected — those come from `build/icon.png`.
Build on Windows, or set `FORCE_EXE_EDIT=1` with Wine present, for a fully
branded executable.

### Signing

Everything above is unsigned. On first launch Windows SmartScreen shows
*"Windows protected your PC"* — **More info → Run anyway**. To remove it
permanently you need an OV or EV code-signing certificate; set `CSC_LINK` and
`CSC_KEY_PASSWORD` and electron-builder signs automatically.

## Where the data lives

Everything writable moves to the per-user data folder, because an installed app
is read-only:

```
%APPDATA%\IndiaCharts\
  indiacharts.db        SQLite (seeded from the shipped copy on first launch)
  kite-session.json     Kite access token — a credential, written 0600-equivalent
  wave-analyses\        saved analyses, the ones Claude reads
```

**File → Open Data Folder** opens it. Uninstalling deliberately leaves it in
place; delete it by hand if you want a clean slate.

## The port, and why it is pinned

The app runs on **localhost:3040**, fixed.

This is not arbitrary. Kite Connect matches the redirect URL against what is
registered on your developer console character for character, so the app has to
come back to a predictable address. Register:

```
http://localhost:3040/api/kite/callback
```

If something else already holds 3040, the app starts on the next free port and
says so in a dialog — everything works except the Zerodha login, which needs the
redirect re-registered at the new port. Close the other process and restart is
usually the better fix.

## Signing in to Zerodha

Better on the desktop than in a browser, because the callback lands on a server
running inside the app:

1. Connection badge → **Sign in with Kite Connect**.
2. A separate window opens on Zerodha's login. It is a real browser window with
   no Node access and its own session partition.
3. On success Zerodha redirects to `localhost:3040/api/kite/callback`, the local
   server exchanges the request token, the login window closes itself, and the
   main window refreshes signed in.

The token never reaches the renderer. The main window is prevented from
navigating away from localhost at all — external links open in the system
browser instead.

## Configuration

The desktop app reads the same `.env` as the web app when running from the repo.
For an installed build, set the variables as Windows environment variables (User
scope is enough):

```
KITE_API_KEY, KITE_API_SECRET, MARKET_PROVIDER=kite-mcp
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_BRIDGE_KEY
```

`DATABASE_URL`, `KITE_SESSION_FILE` and `WAVE_ANALYSIS_DIR` are set by the shell
and should be left alone — they point into the data folder above.

## Menu

| | |
|---|---|
| `Ctrl+1..4` | Wave Lab / Paper Trading / Scalper / Recommendations |
| File → Open Data Folder | the folder above |
| Help → Open in Browser | same app, in your normal browser, same session |
| View → Toggle DevTools | Chromium devtools, for when something looks wrong |

## Known limits

- **Unsigned**, so SmartScreen warns once per machine. See above.
- **Not yet run on Windows.** The shell, the server bootstrap under Electron's
  Node, and the packaged contents were all verified — but on Linux, since that is
  where it was built. Launching it on Windows is the one check still outstanding.
- **x64 only.** ARM64 Windows runs it under emulation; add `arch: ["arm64"]` to
  `electron-builder.config.js` for a native build.
- **~180 MB installed.** Electron ships a Chromium. A Tauri port would be nearer
  15 MB but needs the Rust toolchain and a rewrite of the server bootstrap.
- **Auto-update is not wired up.** `electron-updater` works with the NSIS target
  if you have somewhere to publish to.
