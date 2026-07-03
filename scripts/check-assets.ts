// scripts/check-assets.ts
//
// Static asset budget + hygiene. Fails on oversized shipped images, junk
// artifacts (.DS_Store), and missing required extension icons. Scans the source
// static roots (public/, src/assets). Run: npm run check:assets

import { readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const HARD_IMAGE_LIMIT = 500 * 1024; // fail
const SOFT_IMAGE_LIMIT = 150 * 1024; // warn
const REQUIRED_ICON_SIZES = [16, 32, 48, 128];

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

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

console.log("START ASSET BUDGET CHECK\n");

const roots = ["public", "src/assets"].map((d) => resolve(root, d));
const files = roots.flatMap((r) => walk(r));

// ── junk artifacts ────────────────────────────────────────────────────────
const junk = files.filter((f) => /\.DS_Store$|Thumbs\.db$/.test(f));
check(
  "no .DS_Store / junk artifacts in shipped static roots",
  junk.length === 0,
  junk.map((f) => relative(root, f)).join(", "),
);

// ── oversized images ──────────────────────────────────────────────────────
console.log("\nImages:");
const images = files
  .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
  .map((f) => ({ rel: relative(root, f), size: statSync(f).size }))
  .sort((a, b) => b.size - a.size);

for (const img of images.slice(0, 8)) {
  console.log(`  ${img.rel.padEnd(44)} ${kb(img.size).padStart(12)}`);
}

const oversized = images.filter((i) => i.size > HARD_IMAGE_LIMIT);
check(
  `no image exceeds ${kb(HARD_IMAGE_LIMIT)}`,
  oversized.length === 0,
  oversized.map((i) => `${i.rel} ${kb(i.size)}`).join(", "),
);
const large = images.filter((i) => i.size > SOFT_IMAGE_LIMIT && i.size <= HARD_IMAGE_LIMIT);
if (large.length) {
  console.log("  ⚠ images over the soft budget (consider optimizing):");
  for (const i of large) console.log(`     ${i.rel} ${kb(i.size)}`);
}

// ── required extension icons ──────────────────────────────────────────────
console.log("\nExtension icons:");
for (const size of REQUIRED_ICON_SIZES) {
  const p = resolve(root, `public/icons/icon-${size}.png`);
  check(`icon-${size}.png present`, existsSync(p));
}

console.log("");
if (failures > 0) {
  console.log(`ASSET BUDGET CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("ASSET BUDGET CHECK PASSED");
