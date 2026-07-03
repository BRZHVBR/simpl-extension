// scripts/check-store-docs.ts
//
// Guards store/compliance docs against overclaim and drift from the code.
// Fails on: networks claimed that aren't in the registry, "nativeMessaging"
// described as active while absent from the manifest, "no sensitive logging"
// claims without the check:privacy gate, or missing required release docs /
// privacy-policy sections. Run: npm run check:store-docs

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const read = (p: string) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : "");

console.log("START STORE-DOCS CONSISTENCY CHECK\n");

// Networks NOT in src/core/networks/chain-registry.ts — must not appear in any
// user-facing listing / README.
const FORBIDDEN_NETWORKS = [
  "polygon",
  "arbitrum",
  "optimism",
  "avalanche",
  "fantom",
  "gnosis",
  "celo",
  "cronos",
  "linea",
  "scroll",
  "zksync",
  "blast",
  "mantle",
];
const listingDocs = [
  "docs/store-listing.md",
  "docs/chrome-store-listing.md",
  "docs/store-listing.ru.md",
  "README.md",
  "readme.md",
];

console.log("No overclaimed networks in listing/README:");
for (const doc of listingDocs) {
  const text = read(doc).toLowerCase();
  if (!text) continue;
  const found = FORBIDDEN_NETWORKS.filter((n) => text.includes(n));
  check(`${doc} claims no networks outside the registry`, found.length === 0, found.join(", "));
}

// nativeMessaging must not be described as an active/shipped permission (it is
// absent from the manifest). Allowed only in "removed / absent / not shipped"
// context — approximate by requiring the word to co-occur with a negation nearby.
console.log("\nnativeMessaging not described as active:");
const manifest = JSON.parse(read("public/manifest.json") || "{}");
const nativeInManifest = (manifest.permissions ?? []).includes("nativeMessaging");
check("manifest has no nativeMessaging", !nativeInManifest);
for (const doc of ["docs/chrome-store-permissions.md", "docs/chrome-store-reviewer-notes.md", "docs/store-listing.md"]) {
  const text = read(doc);
  if (!text || !/nativeMessaging/.test(text)) {
    check(`${doc}: no active nativeMessaging claim`, true);
    continue;
  }
  // Every mention must sit near a negation (removed/absent/no/without/not shipped).
  const ok = text
    .split(/\n/)
    .filter((l) => /nativeMessaging/.test(l))
    .every((l) => /(no|removed|absent|without|not shipped|no native)/i.test(l));
  check(`${doc}: nativeMessaging only mentioned as absent`, ok);
}

// "no sensitive logging"-style claims require the check:privacy gate to exist.
console.log("\nLogging claims are backed by a check:");
const pkg = JSON.parse(read("package.json") || "{}");
const hasPrivacyCheck = Boolean(pkg.scripts?.["check:privacy"]);
for (const doc of ["docs/privacy-policy.md", "docs/store-listing.md", "docs/security-review.md"]) {
  const text = read(doc).toLowerCase();
  if (!text) continue;
  const claimsNoLogging = /no sensitive (payload|logging|logs)|do not log sensitive|does not log sensitive/.test(text);
  check(
    `${doc}: any "no sensitive logging" claim is backed by check:privacy`,
    !claimsNoLogging || hasPrivacyCheck,
  );
}

// Required release docs exist.
console.log("\nRequired release docs present:");
for (const doc of [
  "docs/store-listing.md",
  "docs/privacy-policy.md",
  "docs/chrome-store-permissions.md",
  "docs/chrome-store-reviewer-notes.md",
  "docs/store-assets-plan.md",
  "docs/release-checklist.md",
  "docs/endpoint-inventory.md",
]) {
  check(`${doc} exists`, existsSync(resolve(root, doc)));
}

// Privacy policy covers the required topics + the key non-custody statement.
console.log("\nPrivacy policy content:");
const privacy = read("docs/privacy-policy.md").toLowerCase();
check("privacy: mentions local storage", /stored locally|local(ly)? on your device/.test(privacy));
check("privacy: mentions network providers", /network providers?|rpc/.test(privacy));
check(
  "privacy: states seed/private keys are local-only (not sent to servers)",
  /recovery phrase and private keys are never sent|never leave your device|not sent to simpl servers/.test(privacy),
);
check("privacy: mentions user controls", /revoke|lock the wallet|remove the extension/.test(privacy));

console.log("");
if (failures > 0) {
  console.log(`STORE-DOCS CONSISTENCY CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("STORE-DOCS CONSISTENCY CHECK PASSED");
