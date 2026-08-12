/**
 * IndiaCharts desktop — the Electron shell.
 *
 * This is not a browser pointed at a website. The whole Next.js application,
 * API routes included, runs inside the packaged app: on launch the main process
 * spawns Next's standalone server on localhost and loads it into a window. That
 * matters because the broker credentials live in those API routes — an access
 * token that can place orders never belongs in a renderer, on the desktop any
 * more than on the web.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 *   1. The server is forked with ELECTRON_RUN_AS_NODE, so Electron's own Node
 *      runs it. The user does not need Node installed.
 *   2. The port is pinned to 3040, because Kite Connect matches the redirect URL
 *      character for character against what is registered on the developer
 *      console. A port that drifts is a login that silently fails.
 *   3. Writable state (SQLite, the Kite session, saved analyses) is redirected
 *      into userData. Everything shipped inside the app is read-only once it
 *      lands in Program Files.
 */

const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { fork } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PREFERRED_PORT = Number(process.env.INDIACHARTS_PORT || 3040);
const isDev = !app.isPackaged;

let serverProcess = null;
let mainWindow = null;
let loginWindow = null;
let resolvedPort = PREFERRED_PORT;

// Two copies would fight over port 3040 and over the SQLite file. The second
// instance hands its argv to the first and exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// ---------------------------------------------------------------- paths ---

/** Where the built server lives: unpacked resources when packaged, repo when not. */
function serverRoot() {
  return isDev
    ? path.join(__dirname, "..", "dist-desktop", "server")
    : path.join(process.resourcesPath, "server");
}

/**
 * Writable per-user state. The database ships as a seed and is copied out on
 * first launch — writing to the copy inside resources fails on any real install.
 */
function prepareUserData() {
  const dir = app.getPath("userData");
  mkdirSync(dir, { recursive: true });

  const analyses = path.join(dir, "wave-analyses");
  mkdirSync(analyses, { recursive: true });

  const database = path.join(dir, "indiacharts.db");
  if (!existsSync(database)) {
    const seed = isDev
      ? path.join(__dirname, "..", "prisma", "dev.db")
      : path.join(process.resourcesPath, "seed", "dev.db");
    if (existsSync(seed)) {
      try {
        copyFileSync(seed, database);
      } catch (error) {
        console.error("[desktop] could not seed the database:", error.message);
      }
    }
  }

  return { dir, database, analyses };
}

// ----------------------------------------------------------------- port ---

function portIsFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * 3040 or nothing, nearly. Kite rejects a redirect URL that does not match the
 * registered one, so moving ports quietly trades a startup error for a login
 * failure the user cannot diagnose. If 3040 is taken we still start, but we say
 * plainly what broke and what it costs.
 */
async function choosePort() {
  if (await portIsFree(PREFERRED_PORT)) return { port: PREFERRED_PORT, moved: false };
  for (let port = PREFERRED_PORT + 1; port <= PREFERRED_PORT + 12; port += 1) {
    if (await portIsFree(port)) return { port, moved: true };
  }
  throw new Error(`No free port between ${PREFERRED_PORT} and ${PREFERRED_PORT + 12}.`);
}

// --------------------------------------------------------------- server ---

/** Resolves once the server answers, so the window never shows a connection error. */
function waitForServer(port, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`Server did not start within ${timeoutMs / 1000}s.`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startServer() {
  const { port, moved } = await choosePort();
  resolvedPort = port;

  const paths = prepareUserData();
  const entry = path.join(serverRoot(), "server.js");
  if (!existsSync(entry)) {
    throw new Error(
      `The application server is missing at ${entry}.\n\n` +
        (isDev ? "Run `npm run desktop:prepare` first." : "This build is incomplete — please reinstall.")
    );
  }

  serverProcess = fork(entry, [], {
    cwd: serverRoot(),
    // Electron's bundled Node runs the server; nothing extra to install.
    execPath: process.execPath,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: `file:${paths.database}`,
      // Both already support an env override; point them somewhere writable.
      KITE_SESSION_FILE: path.join(paths.dir, "kite-session.json"),
      WAVE_ANALYSIS_DIR: paths.analyses,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  serverProcess.stdout?.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  serverProcess.stderr?.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code !== 0 && !app.isQuiting) {
      dialog.showErrorBox("IndiaCharts stopped", `The application server exited unexpectedly (code ${code}).`);
      app.quit();
    }
  });

  await waitForServer(port);

  if (moved) {
    dialog.showMessageBox({
      type: "warning",
      title: "Port 3040 was busy",
      message: `IndiaCharts is running on port ${port} instead of 3040.`,
      detail:
        "Everything works except the Zerodha login, which needs the redirect URL to match your " +
        "Kite developer console exactly. Either close whatever is using port 3040 and restart, " +
        `or register http://localhost:${port}/api/kite/callback as the redirect URL.`,
    });
  }

  return port;
}

// --------------------------------------------------------------- windows ---

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#ffffff",
    title: "IndiaCharts",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => (mainWindow = null));

  // A trading chart is unreadable at a tiny window size; keep zoom sane.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 3);

  attachNavigationRules(mainWindow);
  mainWindow.loadURL(`http://127.0.0.1:${port}/wave-lab`);
  return mainWindow;
}

/**
 * Keep the app window on the app.
 *
 * Allowed to proceed, a navigation to kite.zerodha.com would replace the whole
 * application with a login page and leave no way back to it. Zerodha's login
 * goes to a dedicated window instead, which closes itself the moment Zerodha
 * redirects to our own callback — at which point the local server has the token
 * and the app only needs a refresh.
 *
 * `will-redirect` matters as much as `will-navigate` here, and is the easier of
 * the two to forget. The sign-in button navigates to `/api/kite/login`, which is
 * same-origin and therefore allowed; that route then answers **302 to Zerodha**.
 * A redirect does not raise `will-navigate`, so guarding only that event lets
 * the hop through and loses the app — the exact failure this function exists to
 * prevent.
 */
function attachNavigationRules(window) {
  const isLocal = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    } catch {
      return false;
    }
  };

  const isZerodha = (url) => /(^|\/\/)([^/]*\.)?(zerodha\.com|kite\.trade)/.test(url);

  const divert = (event, url) => {
    if (isLocal(url)) return;
    event.preventDefault();
    if (isZerodha(url)) openLoginWindow(url);
    else shell.openExternal(url);
  };

  window.webContents.on("will-navigate", divert);
  window.webContents.on("will-redirect", divert);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isZerodha(url)) {
      openLoginWindow(url);
      return { action: "deny" };
    }
    if (!isLocal(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

function openLoginWindow(url) {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    loginWindow.loadURL(url);
    return;
  }

  loginWindow = new BrowserWindow({
    width: 500,
    height: 720,
    parent: mainWindow ?? undefined,
    modal: false,
    title: "Sign in to Zerodha",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    // A real login page in a window with no preload and no Node.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "persist:kite" },
  });

  const finish = (navigatedTo) => {
    if (!navigatedTo.includes("/api/kite/callback")) return;
    // The callback has reached our own server; the token is stored there.
    setTimeout(() => {
      if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
      mainWindow?.webContents.reload();
    }, 900);
  };

  loginWindow.webContents.on("did-navigate", (_event, navigatedTo) => finish(navigatedTo));
  loginWindow.webContents.on("did-redirect-navigation", (_event, navigatedTo) => finish(navigatedTo));
  loginWindow.on("closed", () => (loginWindow = null));

  loginWindow.loadURL(url);
}

// ------------------------------------------------------------------ menu ---

function buildMenu(port) {
  const go = (route) => () => mainWindow?.loadURL(`http://127.0.0.1:${port}${route}`);

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          { label: "Wave Lab", accelerator: "CmdOrCtrl+1", click: go("/wave-lab") },
          { label: "Paper Trading", accelerator: "CmdOrCtrl+2", click: go("/paper-trading") },
          { label: "Scalper", accelerator: "CmdOrCtrl+3", click: go("/scalper") },
          { label: "Recommendations", accelerator: "CmdOrCtrl+4", click: go("/recommendations") },
          { type: "separator" },
          {
            label: "Open Data Folder",
            click: () => shell.openPath(app.getPath("userData")),
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { label: "Edit", submenu: [{ role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "forceReload" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
          { role: "toggleDevTools" },
        ],
      },
      {
        label: "Help",
        submenu: [
          {
            label: "About IndiaCharts",
            click: () =>
              dialog.showMessageBox({
                type: "info",
                title: "IndiaCharts",
                message: `IndiaCharts ${app.getVersion()}`,
                detail:
                  `Elliott Wave analysis terminal.\n\n` +
                  `Running on http://localhost:${port}\n` +
                  `Data folder: ${app.getPath("userData")}`,
              }),
          },
          { label: "Open in Browser", click: () => shell.openExternal(`http://localhost:${port}/wave-lab`) },
        ],
      },
    ])
  );
}

// ----------------------------------------------------------- app lifecycle ---

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    const port = await startServer();
    buildMenu(port);
    createWindow(port);
  } catch (error) {
    dialog.showErrorBox("IndiaCharts could not start", String(error?.message ?? error));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(resolvedPort);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Kill the server with the app; an orphan holds port 3040 and blocks the next launch.
app.on("before-quit", () => {
  app.isQuiting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});

process.on("exit", () => serverProcess?.kill());
