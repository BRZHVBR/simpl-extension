// src/chains/bitcoin/bitcoin.fees.ts
//
// Fee estimation in sat/vB. Maps Esplora's /fee-estimates (a map of
// confirmation-target-in-blocks → sat/vB) onto slow/normal/fast presets, with
// hard-coded fallback rates if the provider is unavailable. When the fallback
// is used the quote is flagged so the UI can mark it as an estimate.

import type { BitcoinChainConfig } from "./bitcoin.config";
import { getFeeEstimates } from "./bitcoin.esplora";
import type {
  BitcoinFeePreset,
  BitcoinFeeQuote,
  BitcoinFeeQuotes,
} from "./bitcoin.types";

// Block target per preset (matches the spec): slow ~12 blocks, normal ~6, fast ~1-2.
const PRESET_BLOCK_TARGETS: Record<BitcoinFeePreset, number> = {
  slow: 12,
  normal: 6,
  fast: 2,
};

// Fallback sat/vB rates if the provider fails — conservative but usable.
const FALLBACK_RATES: Record<BitcoinFeePreset, number> = {
  slow: 3,
  normal: 8,
  fast: 15,
};

// Minimum relay rate; never quote below 1 sat/vB.
const MIN_SAT_PER_VB = 1;

function rateForTarget(
  estimates: Record<string, number>,
  blockTarget: number,
): number | null {
  // Esplora keys are stringified block targets. Pick the exact target if
  // present, else the closest available target that is <= our target (a lower
  // target = faster = higher fee, which is a safe upper bound), else any.
  const available = Object.keys(estimates)
    .map((key) => ({ target: Number(key), rate: estimates[key] }))
    .filter((entry) => Number.isFinite(entry.target) && entry.rate > 0)
    .sort((a, b) => a.target - b.target);

  if (available.length === 0) {
    return null;
  }

  const exact = available.find((entry) => entry.target === blockTarget);
  if (exact) return exact.rate;

  // Closest target not slower than requested (target <= blockTarget).
  const notSlower = available.filter((entry) => entry.target <= blockTarget);
  if (notSlower.length > 0) {
    return notSlower[notSlower.length - 1].rate;
  }

  // Otherwise the fastest available (smallest target).
  return available[0].rate;
}

function quoteFromRate(
  preset: BitcoinFeePreset,
  rate: number,
): BitcoinFeeQuote {
  return {
    preset,
    satPerVb: Math.max(MIN_SAT_PER_VB, Math.ceil(rate)),
    blockTarget: PRESET_BLOCK_TARGETS[preset],
  };
}

// Build the fallback quote set (used when the provider is unavailable).
export function getFallbackFeeQuotes(): BitcoinFeeQuotes {
  return {
    slow: quoteFromRate("slow", FALLBACK_RATES.slow),
    normal: quoteFromRate("normal", FALLBACK_RATES.normal),
    fast: quoteFromRate("fast", FALLBACK_RATES.fast),
    isFallback: true,
  };
}

// Map a raw Esplora estimates map to preset quotes. Pure — easy to unit test.
export function feeQuotesFromEstimates(
  estimates: Record<string, number>,
): BitcoinFeeQuotes {
  const presets: BitcoinFeePreset[] = ["slow", "normal", "fast"];
  const rates = presets.map((preset) =>
    rateForTarget(estimates, PRESET_BLOCK_TARGETS[preset]),
  );

  // If the provider returned nothing usable, fall back entirely.
  if (rates.every((rate) => rate == null)) {
    return getFallbackFeeQuotes();
  }

  const resolve = (preset: BitcoinFeePreset, index: number): BitcoinFeeQuote =>
    quoteFromRate(preset, rates[index] ?? FALLBACK_RATES[preset]);

  return {
    slow: resolve("slow", 0),
    normal: resolve("normal", 1),
    fast: resolve("fast", 2),
    isFallback: false,
  };
}

// Fetch fee quotes from the provider, falling back to fixed rates on any error.
// Never throws — fee estimation must not block the send form from rendering.
export async function getBitcoinFeeQuotes(
  config: BitcoinChainConfig,
): Promise<BitcoinFeeQuotes> {
  try {
    const estimates = await getFeeEstimates(config);
    return feeQuotesFromEstimates(estimates);
  } catch {
    return getFallbackFeeQuotes();
  }
}
