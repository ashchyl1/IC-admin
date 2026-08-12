/**
 * Preload — deliberately almost empty.
 *
 * The renderer is the same Next.js app that runs in a browser, and it talks to
 * its own API routes over HTTP. It needs no privileged bridge, so it gets none:
 * every capability exposed here would also be reachable by anything the page
 * loads. All that is published is a marker the UI can read to know it is running
 * in the desktop shell.
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("indiacharts", {
  desktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
