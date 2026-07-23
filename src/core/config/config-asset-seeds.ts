// src/core/config/config-asset-seeds.ts
//
// Stage 3b of the runtime-config rollout: the admin catalog is not only a
// FILTER over locally-discovered tokens — it is itself a token SOURCE. An
// asset the admin swap/bridge-enabled carries everything a picker row needs
// (chainId, address, decimals, symbol, name, logo), so it is seeded into the
// swap/bridge pickers even when the LI.FI catalog doesn't list it and the
// user doesn't hold it (exactly like the existing TRON registry seed).
// Provider rows win on merge; seeds only fill gaps.
//
// Safety rails: seeds come ONLY from a published server config (meta.source
// === "db") — offline/fallback/seed behavior is unchanged; only chains the
// caller's surface actually supports are seeded (a config can never add a
// chain); natives are represented exactly like the LI.FI catalog represents
// them (EVM zero-address, wSOL mint, TRX base58 sentinel) so rows dedupe
// cleanly and the allowlist's sentinel matching applies unchanged.

import type { SimplRuntimeConfig } from "@getsimpl/config";
import { SOLANA_MAINNET_CHAIN_ID, TRON_MAINNET_CHAIN_ID } from "../networks/chain-registry";
import {
  LIFI_NATIVE_ADDRESS,
  LIFI_SOLANA_CHAIN_ID,
  LIFI_SOLANA_NATIVE_MINT,
  LIFI_TRON_NATIVE_ADDRESS,
} from "../bridge/lifi-constants";

export type ConfigAssetSeed = {
  /** Picker (LI.FI) chain-id space. */
  chainId: number;
  /** Picker-space address (native sentinels for native assets). */
  address: string;
  /** LI.FI catalog convention: true only for the EVM zero-address rows. */
  isNative: boolean;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
};

/** Registry/config chain-id space → picker (LI.FI) space. */
export function toPickerChainId(configChainId: number): number {
  return configChainId === SOLANA_MAINNET_CHAIN_ID ? LIFI_SOLANA_CHAIN_ID : configChainId;
}

/**
 * Picker rows for every admin swap/bridge-enabled config asset on a supported
 * chain. Pure (unit-tested by scripts/check-runtime-config.ts).
 */
export function configAssetSeeds(
  config: SimplRuntimeConfig | null | undefined,
  supportedPickerChainIds: readonly number[],
): ConfigAssetSeed[] {
  if (!config || config.meta.source !== "db") return [];

  const supported = new Set(supportedPickerChainIds);
  const seeds: ConfigAssetSeed[] = [];
  const seen = new Set<string>();

  for (const asset of config.assets) {
    if (asset.enabled === false) continue;
    if (asset.features?.swap !== true && asset.features?.bridge !== true) continue;
    if (typeof asset.chainId !== "number") continue;
    if (typeof asset.decimals !== "number" || !Number.isFinite(asset.decimals)) continue;

    const chainId = toPickerChainId(asset.chainId);
    if (!supported.has(chainId)) continue;

    const isNativeAsset = asset.address == null || asset.isNative === true;
    const address = isNativeAsset
      ? chainId === LIFI_SOLANA_CHAIN_ID
        ? LIFI_SOLANA_NATIVE_MINT
        : chainId === TRON_MAINNET_CHAIN_ID
          ? LIFI_TRON_NATIVE_ADDRESS
          : LIFI_NATIVE_ADDRESS
      : asset.address;
    if (!address) continue;

    const key = `${chainId}:${address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    seeds.push({
      chainId,
      address,
      isNative: address === LIFI_NATIVE_ADDRESS,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      logoUrl: asset.logoUrl ?? null,
    });
  }

  return seeds;
}
