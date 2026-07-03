// src/core/networks/chain-display.ts
//
// Single source for chain display metadata used by the UI (esp. approval
// screens), so labels/namespaces/badges are never hardcoded per-screen. Backed
// by chain-registry.ts. Unknown chains render safely as "Unknown network" +
// the raw id, never throwing.

import {
  getChainById,
  getChainFamily,
  getNetworkDisplayName,
  type ChainFamily,
} from "./chain-registry";

export type ChainNamespace = "eip155" | "tron" | "solana" | "bip122" | "ton" | "unknown";

const FAMILY_TO_NAMESPACE: Record<ChainFamily, ChainNamespace> = {
  evm: "eip155",
  tron: "tron",
  solana: "solana",
  bitcoin: "bip122",
  ton: "ton",
};

// Human label, e.g. "Ethereum", "BNB Smart Chain", "TRON", "Solana". Unknown →
// "Unknown network".
export function getChainLabel(chainId: number): string {
  if (getChainById(chainId)) {
    return getNetworkDisplayName(chainId);
  }
  return "Unknown network";
}

export function getChainNamespace(chainId: number): ChainNamespace {
  if (!getChainById(chainId)) return "unknown";
  return FAMILY_TO_NAMESPACE[getChainFamily(chainId)] ?? "unknown";
}

// A short glyph for a chain badge. Deliberately a plain letter/token, not an
// emoji, to keep the premium/minimalist style in risk & approval UIs.
export function getChainIcon(chainId: number): string {
  const label = getChainLabel(chainId);
  return label === "Unknown network" ? "?" : label.charAt(0).toUpperCase();
}

// A compact badge string, e.g. "Ethereum" or "Unknown network (12345)".
export function formatChainBadge(chainId: number): string {
  if (getChainById(chainId)) return getChainLabel(chainId);
  return `Unknown network (${chainId})`;
}

export function isKnownChain(chainId: number): boolean {
  return getChainById(chainId) !== null;
}
