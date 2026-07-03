// scripts/check-package.ts
//
// Validates the built dist/ before it is zipped for the Chrome Web Store.
// Fails on shippable-package hazards: source/.env/junk artifacts, secrets or
// test seed data, remote code, forbidden permissions, or a manifest/version
// mismatch. Requires a prior `npm run build`. Run: npm run check:package

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

console.log("START CWS PACKAGE VALIDATION\n");

if (!existsSync(dist)) {
  console.log("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const files = walk(dist);
const rel = (f: string) => relative(root, f);

// ── forbidden files ──────────────────────────────────────────────────────
console.log("Package hygiene:");
const forbidden = files.filter((f) =>
  /(^|\/)\.DS_Store$|(^|\/)\.env|\.map$|\.ts$|\.tsx$|(^|\/)node_modules(\/|$)/.test(f),
);
check(
  "no source / .env / source-maps / junk in dist",
  forbidden.length === 0,
  forbidden.map(rel).slice(0, 8).join(", "),
);

// ── secrets / test seed data ───────────────────────────────────────────────
const textFiles = files.filter((f) => /\.(js|html|json|css)$/.test(f));
const BIP39_TEST_VECTORS = [
  "abandon abandon abandon",
  "test test test test test test",
  "zoo zoo zoo zoo",
];
const secretHits: string[] = [];
for (const f of textFiles) {
  const text = readFileSync(f, "utf8");
  if (BIP39_TEST_VECTORS.some((v) => text.includes(v))) secretHits.push(`${rel(f)} (test mnemonic)`);
  if (text.includes("-----BEGIN") && /PRIVATE KEY/.test(text)) secretHits.push(`${rel(f)} (PEM key)`);
}
check("no test seed phrases / PEM private keys shipped", secretHits.length === 0, secretHits.join(", "));

// ── remote code ────────────────────────────────────────────────────────────
console.log("\nNo remote code:");
const htmlFiles = files.filter((f) => extname(f) === ".html");
const remoteScript: string[] = [];
for (const f of htmlFiles) {
  const text = readFileSync(f, "utf8");
  if (/<script[^>]+src=["']https?:\/\//i.test(text)) remoteScript.push(rel(f));
}
check("no remote <script src> in shipped HTML", remoteScript.length === 0, remoteScript.join(", "));
const cdnImports = textFiles.filter((f) =>
  /(unpkg\.com|cdn\.jsdelivr|cdnjs\.cloudflare|esm\.sh)/.test(readFileSync(f, "utf8")),
);
check("no CDN import hosts in shipped JS/HTML", cdnImports.length === 0, cdnImports.map(rel).join(", "));

// ── manifest / icons / version ─────────────────────────────────────────────
console.log("\nManifest & icons:");
const manifestPath = join(dist, "manifest.json");
check("dist/manifest.json present", existsSync(manifestPath));
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  check(`manifest version matches package.json (${manifest.version})`, manifest.version === pkg.version);
  check("no nativeMessaging permission", !(manifest.permissions ?? []).includes("nativeMessaging"));
  check(
    "host_permissions has no <all_urls>",
    !(manifest.host_permissions ?? []).includes("<all_urls>"),
  );
  check(
    "CSP has no unsafe-eval / remote script sources",
    (() => {
      const csp = manifest.content_security_policy?.extension_pages ?? "";
      return !/unsafe-eval/.test(csp) && !/https?:\/\//.test(csp.replace(/img-src[^;]*/i, ""));
    })(),
  );
  for (const size of [16, 32, 48, 128]) {
    check(`icons/icon-${size}.png present`, existsSync(join(dist, `icons/icon-${size}.png`)));
  }
}

// ── size ──────────────────────────────────────────────────────────────────
console.log("\nPackage size:");
const totalBytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
const mb = totalBytes / (1024 * 1024);
console.log(`  dist total: ${mb.toFixed(1)} MB`);
check("package size under 30 MB (CWS practical limit)", mb < 30);

console.log("");
if (failures > 0) {
  console.log(`CWS PACKAGE VALIDATION FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("CWS PACKAGE VALIDATION PASSED");
