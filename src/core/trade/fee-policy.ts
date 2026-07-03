// src/core/trade/fee-policy.ts
//
// Fee enforcement matrix — the single source of truth for HOW and WHERE the
// simpl swap/bridge fee is enforced per provider, and what happens if it cannot
// be. Pure. Consumed by docs + check:proxy/check:trade.
//
// Principle: in production a fee must never depend on client-only logic where it
// affects monetization/compliance. It must be enforced by the provider (0x
// swapFeeBps) or by the Simpl backend proxy (LI.FI integrator, Jupiter, etc.).

import type { TradeKind, TradeProvider } from "./quote-model";

export type FeeEnforcementMode =
  | "backend_authoritative" // Simpl proxy / getsimpl-api injects & enforces the fee
  | "provider_enforced" // the provider collects the fee from a request param (e.g. 0x swapFeeBps)
  | "client_display_only" // client can only DISPLAY a fee; not authoritative → not a monetized prod route
  | "unsupported"; // no fee mechanism for this provider

export type FeePolicy = {
  provider: TradeProvider;
  kind: TradeKind;
  defaultBps: number;
  maxBps: number;
  enforcement: FeeEnforcementMode;
  requiresProxy: boolean;
  allowProduction: boolean;
  notes?: string;
};

// Default simpl fee range (basis points). The active value comes from
// VITE_SIMPLE_SWAP_FEE_BPS at build; these bound what is acceptable.
export const SIMPL_FEE_DEFAULT_BPS = 50; // 0.5%
export const SIMPL_FEE_MIN_BPS = 0;
export const SIMPL_FEE_MAX_BPS = 100; // 1% — anything higher is rejected by policy

export const FEE_MATRIX: readonly FeePolicy[] = [
  {
    provider: "zeroex",
    kind: "swap",
    defaultBps: SIMPL_FEE_DEFAULT_BPS,
    maxBps: SIMPL_FEE_MAX_BPS,
    // 0x collects the fee via the swapFeeBps request param; in production the
    // request goes through the Simpl proxy (Stage 5). Either way the fee is not
    // client-authoritative in a way that can be tampered post-quote.
    enforcement: "provider_enforced",
    requiresProxy: true,
    allowProduction: true,
    notes: "swapFeeBps honoured by 0x; production routes via api.getsimpl.io proxy.",
  },
  {
    provider: "lifi",
    kind: "bridge",
    defaultBps: SIMPL_FEE_DEFAULT_BPS,
    maxBps: SIMPL_FEE_MAX_BPS,
    // The getsimpl-api gateway injects the integrator + fee server-side and may
    // strip client fee params. The client VITE_LIFI_FEE is a hint only.
    enforcement: "backend_authoritative",
    requiresProxy: true,
    allowProduction: true,
    notes:
      "Fee is NOT client-authoritative: enforced by the getsimpl-api gateway (integrator/fee injected server-side). See getsimpl-api follow-up.",
  },
  {
    provider: "jupiter",
    kind: "swap",
    defaultBps: SIMPL_FEE_DEFAULT_BPS,
    maxBps: SIMPL_FEE_MAX_BPS,
    // Routed through the Simpl gateway; fee (platformFeeBps) is applied/enforced
    // server-side. Quote reports requestedFeeBps/actualFeeBps.
    enforcement: "backend_authoritative",
    requiresProxy: true,
    allowProduction: true,
    notes: "Fee applied server-side via the Simpl Jupiter proxy; quote returns actualFeeBps.",
  },
  {
    provider: "pancake",
    kind: "swap",
    defaultBps: 0,
    maxBps: 0,
    // The V2 fallback router has no simpl-fee mechanism. It must therefore NOT be
    // used as a silent monetized production route: surface a fallback warning and
    // do not imply a simpl fee is collected.
    enforcement: "unsupported",
    requiresProxy: false,
    allowProduction: true,
    notes:
      "Fallback only. No simpl fee collected — must be surfaced (not silent) and never claim a monetized route.",
  },
];

export function getFeePolicy(
  provider: TradeProvider,
  kind: TradeKind,
): FeePolicy | null {
  return FEE_MATRIX.find((p) => p.provider === provider && p.kind === kind) ?? null;
}

// A configured simpl fee (bps) is valid only within the policy bounds.
export function isSimplFeeBpsValid(bps: number): boolean {
  return Number.isInteger(bps) && bps >= SIMPL_FEE_MIN_BPS && bps <= SIMPL_FEE_MAX_BPS;
}

// True when a provider may collect a simpl fee in production without relying on
// client-only logic. Pancake (unsupported) returns false → not a monetized route.
export function feeIsProductionSafe(policy: FeePolicy): boolean {
  if (!policy.allowProduction) return false;
  return policy.enforcement === "provider_enforced" || policy.enforcement === "backend_authoritative";
}
