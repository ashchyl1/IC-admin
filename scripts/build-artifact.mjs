/**
 * Bundle the Wave Lab into a single self-contained HTML fragment.
 *
 * Publishing target: a sandboxed page that may not fetch from any external
 * host, so React, Lightweight Charts and every application module are inlined,
 * and the market client is swapped for the in-browser generator in
 * `artifact/entry.tsx`.
 *
 *   node scripts/build-artifact.mjs [outfile]
 *
 * Emits a fragment (a <style>, a root <div> and a <script>), not a whole
 * document — the publishing step supplies <html>, <head> and <body>.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = process.argv[2] ?? path.join(root, "artifact", "wave-lab.html");

// ------------------------------------------------------------------- js ---

const bundle = await esbuild.build({
  entryPoints: [path.join(root, "artifact", "entry.tsx")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  jsx: "automatic",
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
    // Referenced by the Next-side modules that the components import.
    "process.env.NEXT_PUBLIC_SCALPER_FEED": '""',
  },
  loader: { ".ts": "ts", ".tsx": "tsx" },
  alias: { "@": path.join(root, "src") },
});

const js = bundle.outputFiles[0].text;

// ------------------------------------------------------------------ css ---

// Tailwind is scanned against the sources the bundle actually pulls in, so the
// emitted stylesheet carries only the utilities this page uses.
const work = mkdtempSync(path.join(tmpdir(), "wave-artifact-"));
const inputCss = path.join(work, "in.css");
const outputCss = path.join(work, "out.css");
const config = path.join(work, "tailwind.config.js");

writeFileSync(
  inputCss,
  `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`
);
writeFileSync(
  config,
  `module.exports = {
  content: [
    ${JSON.stringify(path.join(root, "src/components/wave/**/*.{ts,tsx}"))},
    ${JSON.stringify(path.join(root, "src/components/scalper/ui.tsx"))},
    ${JSON.stringify(path.join(root, "artifact/*.tsx"))},
  ],
  theme: { extend: {} },
  corePlugins: { preflight: true },
};\n`
);

execFileSync(
  process.execPath,
  [
    path.join(root, "node_modules", "tailwindcss", "lib", "cli.js"),
    "-c", config,
    "-i", inputCss,
    "-o", outputCss,
    "--minify",
  ],
  { stdio: ["ignore", "ignore", "inherit"], cwd: root }
);

const css = readFileSync(outputCss, "utf8");
rmSync(work, { recursive: true, force: true });

// ----------------------------------------------------------------- html ---

/**
 * The workspace is a fixed-height application shell, so the page gets an
 * explicit viewport-height frame rather than flowing with the document. The
 * dark palette is stated outright: this is a trading surface whose greens and
 * reds must not shift with the viewer's theme.
 */
const html = `<title>Wave Lab — Elliott Wave analysis</title>
<style>
${css}
:root { color-scheme: dark; }
html, body { height: 100%; margin: 0; background: #0b111b; }
#wave-lab-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #0b111b;
  color: #e2e8f0;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
<div id="wave-lab-root"></div>
<script>
${js}
</script>
`;

writeFileSync(outFile, html);

const kb = (value) => `${(value / 1024).toFixed(0)} KB`;
console.log(`wrote ${path.relative(root, outFile)}`);
console.log(`  js   ${kb(js.length)}`);
console.log(`  css  ${kb(css.length)}`);
console.log(`  page ${kb(html.length)}`);
