// scripts/check-bundle.ts
//
// Bundle performance budget. Reads the built dist/assets JS chunks and enforces:
//   - the popup main chunk (App.js) stays under the initial-load budget (hard),
//   - no single chunk exceeds the runaway ceiling (hard),
//   - chunks between the soft and hard limits are reported as warnings.
// Known-heavy shared/offscreen chunks (crypto core, WC engine) are tracked as
// warnings, not failures — splitting them further is a documented follow-up.
//
// Requires a prior `npm run build`. Run: npm run check:bundle

import { readFileSync, readdirSync as readdir, existsSync as exists } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const assetsDir = resolve(root, "dist/assets");

// Budgets (raw bytes).
const POPUP_MAIN_BUDGET = 500 * 1024; // App.js — initial popup chunk
const SOFT_LIMIT = 500 * 1024; // warn above this
const HARD_CEILING = 3_000 * 1024; // fail above this (runaway)

// Chunks allowed to exceed the soft limit (tracked as warnings, not failures).
const HEAVY_ALLOWLIST = [/^wallet\.service/, /^walletconnectOffscreen/, /^runtime-overrides/];

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} kB`;
}

console.log("START BUNDLE BUDGET CHECK\n");

if (!exists(assetsDir)) {
  console.log("dist/assets not found — run `npm run build` first.");
  process.exit(1);
}

type Chunk = { name: string; raw: number; gzip: number };
const chunks: Chunk[] = readdir(assetsDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => {
    const buf = readFileSync(join(assetsDir, f));
    return { name: f, raw: buf.length, gzip: gzipSync(buf).length };
  })
  .sort((a, b) => b.raw - a.raw);

console.log("Top JS chunks (raw / gzip):");
for (const c of chunks.slice(0, 12)) {
  console.log(`  ${c.name.padEnd(38)} ${kb(c.raw).padStart(12)}  ${kb(c.gzip).padStart(12)}`);
}
console.log("");

// Popup main chunk budget.
const app = chunks.find((c) => /^App(-|\.)/.test(c.name) || c.name === "App.js");
check(
  `popup main chunk (App.js) under ${kb(POPUP_MAIN_BUDGET)}`,
  !!app && app.raw <= POPUP_MAIN_BUDGET,
  app ? `App.js is ${kb(app.raw)}` : "App.js chunk not found",
);

// Runaway ceiling — any chunk above HARD_CEILING fails.
const runaway = chunks.filter((c) => c.raw > HARD_CEILING);
check(
  `no chunk exceeds the runaway ceiling (${kb(HARD_CEILING)})`,
  runaway.length === 0,
  runaway.map((c) => `${c.name} ${kb(c.raw)}`).join(", "),
);

// Soft-limit warnings (non-failing), excluding the known-heavy allowlist.
const overSoft = chunks.filter(
  (c) => c.raw > SOFT_LIMIT && c.raw <= HARD_CEILING && !HEAVY_ALLOWLIST.some((re) => re.test(c.name)),
);
if (overSoft.length) {
  console.log("  ⚠ chunks over the soft limit (review before release):");
  for (const c of overSoft) console.log(`     ${c.name} ${kb(c.raw)}`);
} else {
  console.log("  ✓ no unexpected chunks over the soft limit");
}
const heavyTracked = chunks.filter((c) => HEAVY_ALLOWLIST.some((re) => re.test(c.name)) && c.raw > SOFT_LIMIT);
if (heavyTracked.length) {
  console.log("  • tracked heavy chunks (allowlisted; split = follow-up):");
  for (const c of heavyTracked) console.log(`     ${c.name} ${kb(c.raw)} (gzip ${kb(c.gzip)})`);
}

console.log("");
if (failures > 0) {
  console.log(`BUNDLE BUDGET CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("BUNDLE BUDGET CHECK PASSED");
