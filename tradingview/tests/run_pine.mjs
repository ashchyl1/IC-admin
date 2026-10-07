// Runs a Pine script through Resin, an offline Pine v5/v6 compiler and runtime
// (https://github.com/nullarch/resin, npm @nullarch/resin), and prints its plots,
// plotshape conditions, line drawings and final `var` values as JSON.
//
// test_image_trend.py uses this to check re_imaged_trendlines.pine against
// image_trend.py. TradingView's own compiler cannot be called offline; Resin is
// the closest stand-in, and its output is compared, not trusted.
//
//   node --import <resin>/register.mjs run_pine.mjs <resin dir> <script.pine> <bars.json> [inputs.json]
//
// bars.json: {"open": [...], "high": [...], "low": [...], "close": [...], "volume": [...]}
// inputs.json: {"<input title>": value, ...}

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [resinDir, scriptPath, barsPath, inputsPath] = process.argv.slice(2);
if (!resinDir || !scriptPath || !barsPath) {
  console.error("usage: run_pine.mjs <resin dir> <script.pine> <bars.json> [inputs.json]");
  process.exit(64);
}

const { transpile, run } = await import(pathToFileURL(path.join(resinDir, "src/index.ts")).href);

// Resin 0.2.2 rejects display.pine_screener, which is valid v6 and only decides
// where TradingView lists a plot's values. Dropping it changes no value.
const source = readFileSync(scriptPath, "utf-8").replaceAll(" + display.pine_screener", "");
const compiled = transpile(source, { chartTf: "D" });
if (!compiled.ok) {
  console.error(compiled.errors.join("\n"));
  process.exit(2);
}

const bars = JSON.parse(readFileSync(barsPath, "utf-8"));
const inputs = inputsPath ? JSON.parse(readFileSync(inputsPath, "utf-8")) : {};
const out = run(compiled, bars, { inputs });

const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const plots = Object.fromEntries(out.plots.map((p) => [p.title, Array.from(p.values, finite)]));
const shapes = Object.fromEntries(
  out.viz.shapes.map((s) => [s.title, { condition: s.condition, colors: s.colors }]),
);
const lines = out.viz.drawings
  .filter((d) => d.kind === "line")
  .map((d) => ({ bar: d.bar, ...d.state }));
const vars = Object.fromEntries(
  Object.entries(out.finalVarState).filter(([, v]) => typeof v === "number"),
);

process.stdout.write(JSON.stringify({ plots, shapes, lines, vars }));
