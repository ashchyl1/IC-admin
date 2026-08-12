/**
 * Assemble the Next.js app into something Electron can ship.
 *
 *   node scripts/build-desktop.mjs
 *
 * `next build` with `output: "standalone"` traces the server and its real
 * dependencies into one folder — but it deliberately leaves out two things that
 * are served over HTTP rather than imported, so a standalone build that is
 * merely copied starts fine and then renders an unstyled page with no images:
 *
 *   - `<distDir>/static`  the JS and CSS chunks
 *   - `public/`           everything served from the site root
 *
 * Both are copied in here. Prisma's native query engine is handled too: it is
 * loaded by path at runtime, so tracing misses it, and its Windows build has to
 * be present or every database route fails on the user's machine with an error
 * about a missing engine.
 *
 * Output: dist-desktop/server — the `extraResources` payload for electron-builder.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const DIST_DIR = ".next-desktop"; // separate from .next so a dev server survives this
const staging = path.join(root, "dist-desktop", "server");

const step = (message) => console.log(`\n\x1b[1m▸ ${message}\x1b[0m`);
const ok = (message) => console.log(`  \x1b[32m✓\x1b[0m ${message}`);

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd: root,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\n\x1b[31m✗ ${command} ${args.join(" ")} failed (exit ${result.status}).\x1b[0m`);
    process.exit(result.status ?? 1);
  }
}

// ------------------------------------------------------------------ build ---

step("Generating the Prisma client (native + windows engines)");
run("npx", ["prisma", "generate"]);
ok("client generated");

step(`Building Next.js (standalone, distDir=${DIST_DIR})`);
run("npx", ["next", "build"], { NEXT_DIST_DIR: DIST_DIR, DESKTOP_BUILD: "1" });
ok("build complete");

// --------------------------------------------------------------- assemble ---

step("Assembling dist-desktop/server");

const standalone = path.join(root, DIST_DIR, "standalone");
if (!existsSync(standalone)) {
  console.error(
    `\n\x1b[31m✗ ${DIST_DIR}/standalone is missing.\x1b[0m\n` +
      `  next.config.mjs must set output: "standalone" when DESKTOP_BUILD=1.`
  );
  process.exit(1);
}

rmSync(path.join(root, "dist-desktop"), { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

cpSync(standalone, staging, { recursive: true });
ok("standalone server");

// The chunks. Without these the page loads and renders nothing.
const staticSrc = path.join(root, DIST_DIR, "static");
if (existsSync(staticSrc)) {
  cpSync(staticSrc, path.join(staging, DIST_DIR, "static"), { recursive: true });
  ok(`${DIST_DIR}/static`);
}

// Everything served from the site root.
const publicSrc = path.join(root, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, path.join(staging, "public"), { recursive: true, filter: (src) => !src.includes("uploads") });
  mkdirSync(path.join(staging, "public", "uploads"), { recursive: true });
  ok("public/");
}

// ----------------------------------------------------------------- prisma ---

step("Copying the Prisma query engines");

const prismaSrc = path.join(root, "node_modules", ".prisma", "client");
const prismaDest = path.join(staging, "node_modules", ".prisma", "client");
if (existsSync(prismaSrc)) {
  mkdirSync(prismaDest, { recursive: true });
  cpSync(prismaSrc, prismaDest, { recursive: true });

  const engines = readdirSync(prismaDest).filter((file) => /query[-_]engine/i.test(file));
  if (engines.length === 0) {
    console.warn("  \x1b[33m!\x1b[0m No query engine found — database routes will fail at runtime.");
  } else {
    for (const engine of engines) ok(engine);
    if (!engines.some((engine) => /windows|\.dll\.node$/i.test(engine))) {
      console.warn(
        "  \x1b[33m!\x1b[0m No Windows engine. Add `binaryTargets = [\"native\", \"windows\"]` to\n" +
          "    prisma/schema.prisma and re-run, or the Windows build cannot reach its database."
      );
    }
  }
} else {
  console.warn("  \x1b[33m!\x1b[0m node_modules/.prisma/client is missing; skipping.");
}

// ------------------------------------------------------------------ stamp ---

// The standalone package.json drives how Node resolves inside the bundle; make
// sure it does not carry a "build" script that electron-builder might re-run.
writeFileSync(
  path.join(staging, "BUILD_INFO.json"),
  JSON.stringify({ builtAt: new Date().toISOString(), distDir: DIST_DIR, node: process.version }, null, 2)
);

step("Done");
console.log(`  Server staged at dist-desktop/server`);
console.log(`  Next: \x1b[1mnpm run desktop:win\x1b[0m   (Windows installer + portable exe)`);
console.log(`        \x1b[1mnpm run desktop\x1b[0m       (run it locally in Electron)\n`);
