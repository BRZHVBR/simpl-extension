// scripts/check-ui.ts
//
// Lightweight component + chain-label smoke. Renders the shared UI primitives
// to static markup (no browser needed) and checks the registry-backed chain
// display helper — including unknown-chain safety. Run: npm run check:ui

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Button, Alert, Badge, EmptyState } from "../src/ui/primitives";
import {
  getChainLabel,
  getChainNamespace,
  formatChainBadge,
  isKnownChain,
} from "../src/core/networks/chain-display";
import { ETHEREUM_MAINNET_CHAIN_ID } from "../src/core/networks/chain-registry";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

console.log("START UI PRIMITIVES / CHAIN-LABEL CHECK\n");

// ── Button variants ──────────────────────────────────────────────────────
console.log("Button variants:");
for (const v of ["primary", "secondary", "ghost", "danger"] as const) {
  const out = html(createElement(Button, { variant: v }, "Go"));
  check(`variant ${v} → btn ${v} class`, out.includes(`btn ${v}`) && out.includes("Go"));
}
check("disabled button renders disabled", html(createElement(Button, { disabled: true }, "x")).includes("disabled"));
check(
  "loading button is disabled + aria-busy",
  (() => {
    const out = html(createElement(Button, { loading: true }, "x"));
    return out.includes("disabled") && out.includes('aria-busy="true"');
  })(),
);
check("full button adds full class", html(createElement(Button, { full: true }, "x")).includes("full"));

// ── Alert tones ──────────────────────────────────────────────────────────
console.log("\nAlert tones:");
check("danger alert has role=alert", html(createElement(Alert, { tone: "danger" }, "!")).includes('role="alert"'));
check("blocked alert has role=alert", html(createElement(Alert, { tone: "blocked" }, "!")).includes('role="alert"'));
check("info alert has role=status", html(createElement(Alert, { tone: "info" }, "ok")).includes('role="status"'));
check("alert renders title + body", (() => {
  const out = html(createElement(Alert, { tone: "warning", title: "Heads up" }, "body text"));
  return out.includes("Heads up") && out.includes("body text");
})());

// ── Badge / EmptyState ─────────────────────────────────────────────────────
console.log("\nBadge / EmptyState:");
check("badge renders content", html(createElement(Badge, { tone: "info" }, "EVM")).includes("EVM"));
check("empty state renders title + description",
  (() => { const out = html(createElement(EmptyState, { title: "Nothing here", description: "add one" })); return out.includes("Nothing here") && out.includes("add one"); })());

// ── Chain labels (registry-backed, unknown-safe) ───────────────────────────
console.log("\nChain labels:");
check("known chain has a real label", isKnownChain(ETHEREUM_MAINNET_CHAIN_ID) && getChainLabel(ETHEREUM_MAINNET_CHAIN_ID) !== "Unknown network");
check("known chain namespace is eip155", getChainNamespace(ETHEREUM_MAINNET_CHAIN_ID) === "eip155");
check("unknown chain → 'Unknown network' (no throw)", getChainLabel(9_999_999) === "Unknown network");
check("unknown chain namespace → 'unknown'", getChainNamespace(9_999_999) === "unknown");
check("formatChainBadge includes id for unknown", formatChainBadge(9_999_999).includes("9999999"));
check("unknown chain is not known", !isKnownChain(9_999_999));

console.log("");
if (failures > 0) {
  console.log(`UI PRIMITIVES / CHAIN-LABEL CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("UI PRIMITIVES / CHAIN-LABEL CHECK PASSED");
