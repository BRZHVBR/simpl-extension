// src/core/config/feature-gate.ts
//
// Remote feature gates for EXISTING wallet surfaces (Swap / Bridge buttons).
// Fail-open by design: with no runtime config yet, or with the embedded
// fallback config (gateway unreachable), every surface stays enabled — the
// wallet behaves exactly as it does today. Only a config that actually came
// from the server (meta.source "db"/"seed") may turn a surface off.

import { isFeatureEnabled, type SimplRuntimeConfig } from "@getsimpl/config";
import { getCachedRuntimeConfigSnapshot } from "./runtime-config.service";

/** Flags the extension gates on today. */
export type RemoteFeatureFlag = "swaps" | "bridge";

/**
 * Pure decision helper (unit-tested by scripts/check-runtime-config.ts):
 * null / embedded-fallback config → enabled (safe default); otherwise the
 * server flag decides, with `true` as the missing-flag default because these
 * gates cover existing surfaces (see isFeatureEnabled docs).
 */
export function isRemoteFeatureEnabledFor(
  config: SimplRuntimeConfig | null,
  flag: RemoteFeatureFlag,
): boolean {
  if (!config || config.meta.source === "fallback") return true;
  return isFeatureEnabled(config, flag, true);
}

/** Gate an existing surface on the current runtime-config snapshot. */
export function isRemoteFeatureEnabled(flag: RemoteFeatureFlag): boolean {
  return isRemoteFeatureEnabledFor(getCachedRuntimeConfigSnapshot(), flag);
}
