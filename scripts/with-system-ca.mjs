#!/usr/bin/env node
/**
 * Runs a command with Node's `--use-system-ca` flag prepended to NODE_OPTIONS.
 *
 * Why this exists: local TLS-inspecting security software (Avast's
 * `aswMonFltProxy` on this machine) re-signs HTTPS traffic with a root CA that
 * lives in the Windows certificate store. Node ships its own bundled CA list
 * and does not consult that store, so every server-side fetch to Supabase dies
 * with UNABLE_TO_VERIFY_LEAF_SIGNATURE. `--use-system-ca` makes Node trust the
 * OS store as well, which is exactly what the browser already does.
 *
 * A wrapper rather than an inline `NODE_OPTIONS=... next dev` prefix because
 * npm runs scripts through cmd.exe on Windows, where that POSIX syntax is a
 * parse error. Child processes inherit the env, so `next dev` and every worker
 * it forks pick the flag up.
 *
 * Harmless where the flag is unnecessary; requires Node >= 22.15.
 */
import { spawn } from "node:child_process";

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-system-ca.mjs <command> [args...]");
  process.exit(1);
}

const existing = process.env.NODE_OPTIONS ?? "";
const NODE_OPTIONS = existing.includes("--use-system-ca")
  ? existing
  : `--use-system-ca ${existing}`.trim();

// One pre-joined string rather than (command, args, {shell:true}): the latter
// triggers Node's DEP0190 warning on every start. shell:true is still needed
// so `next` resolves via the node_modules/.bin shim on Windows.
const child = spawn([command, ...args].join(" "), {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NODE_OPTIONS },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
