/**
 * electron-builder configuration.
 *
 * JavaScript rather than YAML for one reason: stamping a Windows executable
 * with its icon and version strings is done by `rcedit.exe`, which on a
 * non-Windows host only runs under Wine. Wine is not always available, and its
 * absence is a hard build failure rather than a degraded one — so the step is
 * switched off when cross-building and left on when building natively.
 *
 * The cost of skipping it is cosmetic and contained: the packaged
 * IndiaCharts.exe carries Electron's default icon and version metadata. The
 * installer, its shortcuts and the running window are unaffected, since NSIS
 * sets those from build/icon.png without Wine's help. Build on Windows, or with
 * Wine installed, for a fully branded executable.
 *
 * Override deliberately with FORCE_EXE_EDIT=1 (or 0).
 */

const nativeWindowsBuild = process.platform === "win32";
const forced = process.env.FORCE_EXE_EDIT;
const editExecutable = forced === undefined ? nativeWindowsBuild : forced === "1";

/**
 * Which Windows targets this host can actually produce.
 *
 * `portable` and `zip` are pure packaging and build anywhere. `nsis` is not: to
 * emit `Uninstall.exe`, NSIS has to *run* the compiled installer once, so a
 * non-Windows host needs Wine. Rather than let the whole build die on the last
 * target — after twenty minutes of packaging — the installer is only requested
 * where it can be built.
 *
 * Set WITH_NSIS=1 to ask for it anyway (a Linux host with Wine installed).
 */
const canBuildNsis = nativeWindowsBuild || process.env.WITH_NSIS === "1";

const windowsTargets = [
  ...(canBuildNsis ? [{ target: "nsis", arch: ["x64"] }] : []),
  { target: "portable", arch: ["x64"] },
  { target: "zip", arch: ["x64"] },
];

module.exports = {
  appId: "com.indiacharts.desktop",
  productName: "IndiaCharts",
  copyright: "IndiaCharts",

  // No `buildResources`: the icon is `electron/icon.png`, which ships in the asar
  // for the window anyway. A second copy under a gitignored build/ directory
  // would be one a fresh clone does not have.
  directories: { output: "release" },

  // Only the shell goes in the asar. The application itself — server,
  // node_modules, chunks — is staged by scripts/build-desktop.mjs and shipped as
  // a resource, so bundling the repo's dependencies here would ship every one of
  // them twice.
  files: [
    "electron/**/*",
    "package.json",
    "!node_modules/**/*",
    "!src/**/*",
    "!scripts/**/*",
    "!tests/**/*",
    "!prisma/**/*",
    "!supabase/**/*",
    "!.next*/**/*",
    "!dist-desktop/**/*",
    "!release/**/*",
  ],

  extraResources: [
    { from: "dist-desktop/server", to: "server" },
    // A seed database, copied to userData on first launch. What ships in
    // resources is read-only once installed under Program Files.
    { from: "prisma/dev.db", to: "seed/dev.db" },
  ],

  asar: true,
  // Native modules are dlopen'd by path and cannot be read from inside an asar.
  asarUnpack: ["**/*.node"],

  win: {
    target: windowsTargets,
    artifactName: "${productName}-${version}-setup.${ext}",
    icon: "electron/icon.png",
    signAndEditExecutable: editExecutable,
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "IndiaCharts",
    // The data folder holds saved analyses and the local database; an uninstall
    // should not be the thing that loses a year of wave counts.
    deleteAppDataOnUninstall: false,
  },

  portable: { artifactName: "${productName}-${version}-portable.${ext}" },

  // Useful for verifying the shell without a Windows machine.
  linux: { target: ["AppImage"], category: "Office", icon: "electron/icon.png" },
  mac: { target: ["dmg"], category: "public.app-category.finance" },
};
