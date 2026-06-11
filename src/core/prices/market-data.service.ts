// src/core/prices/market-data.service.ts
//
// Per-asset market data for the AssetDetails screen: spot price, 24h price
// change and 24h (market) volume — all resolved through the SAME shared price
// identity used by spot prices and the chart, so they can never disagree about
// which asset they describe. This is intentionally separate from the portfolio
// spot-price path (token-price / native-price services): it is only consulted
// when an asset detail screen is open, and it never feeds wallet balance/value
// math.
//
// Price/change/volume all come from the Simpl API Gateway (never a provider
// directly); the `source` field on the response says which upstream answered.
// No data is fabricated: a field is omitted when the gateway doesn't return it.

import {
  priceDebug,
  priceWarn,
  resolvePriceIdentity,
} from "./price-identity";
import { getSpotPrice } from "./simpl-market-api.service";

export type AssetMarketData = {
  priceUsd?: number;
  priceChange24hPct?: number;
  volume24hUsd?: number;
  marketCapUsd?: number;
  // Provider identity used (price source / market-data source) — diagnostics.
  source?: string;
  updatedAt: number;
};

// Spot + volume move quickly; keep this short and aligned with the spot caches.
const CACHE_TTL_MS = 60_000;

type MarketDataInput = {
  chainId: number;
  // ERC-20 contract address, or null for the chain's native asset.
  address: string | null;
};

function cacheKey(chainId: number, address: string | null): string {
  const identity = resolvePriceIdentity(chainId, address);
  return `simple:marketData:${identity.key}`;
}

function readCacheEnvelope(
  chainId: number,
  address: string | null,
): AssetMarketData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(chainId, address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssetMarketData;
    if (!parsed || typeof parsed.updatedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(
  chainId: number,
  address: string | null,
  data: AssetMarketData,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(chainId, address),
      JSON.stringify(data),
    );
  } catch {
    // Cache is optional.
  }
}

function isFresh(data: AssetMarketData): boolean {
  return Date.now() - data.updatedAt < CACHE_TTL_MS;
}

export class MarketDataService {
  // Synchronous cached read for instant first paint (may be stale).
  getCachedAssetMarketData(input: MarketDataInput): AssetMarketData | null {
    return readCacheEnvelope(input.chainId, input.address);
  }

  // Resolve spot price + 24h change + 24h volume for one asset. Returns null
  // when the asset has no resolvable market identity (unknown token). On a
  // provider failure, returns stale cache when available so the UI doesn't
  // flicker to "—".
  async getAssetMarketData(
    input: MarketDataInput,
  ): Promise<AssetMarketData | null> {
    const identity = resolvePriceIdentity(input.chainId, input.address);

    if (!identity.hasMarketData) {
      return null;
    }

    const cached = readCacheEnvelope(input.chainId, input.address);
    if (cached && isFresh(cached)) {
      return cached;
    }

    try {
      const spot = await getSpotPrice({
        chainId: input.chainId,
        address: input.address,
        vs: "usd",
        // Ask for 24h volume / market cap enrichment — without this the gateway
        // returns price-only and volume24h is always null.
        includeMarket: true,
      });

      if (!spot || typeof spot.price !== "number" || !Number.isFinite(spot.price)) {
        // On a gateway failure / missing price, keep showing stale cache when
        // we have it rather than flickering to "—".
        return cached;
      }

      // Only finite numbers are kept — anything the gateway omits (e.g. volume)
      // is simply left off, never zero-filled.
      const data: AssetMarketData = {
        priceUsd: spot.price,
        source: spot.source,
        updatedAt: Date.now(),
      };
      if (
        typeof spot.change24h === "number" &&
        Number.isFinite(spot.change24h)
      ) {
        data.priceChange24hPct = spot.change24h;
      }
      if (
        typeof spot.volume24h === "number" &&
        Number.isFinite(spot.volume24h)
      ) {
        data.volume24hUsd = spot.volume24h;
      }
      if (
        typeof spot.marketCap === "number" &&
        Number.isFinite(spot.marketCap)
      ) {
        data.marketCapUsd = spot.marketCap;
      }

      // Volume / market cap enrichment (coingecko) is intermittent at the
      // gateway — a later price-only response would otherwise wipe a volume we
      // already showed, flapping it to "—". Carry forward the last real value
      // when this response omits it (no fabrication — it's a value we received).
      if (data.volume24hUsd == null && cached?.volume24hUsd != null) {
        data.volume24hUsd = cached.volume24hUsd;
      }
      if (data.marketCapUsd == null && cached?.marketCapUsd != null) {
        data.marketCapUsd = cached.marketCapUsd;
      }

      writeCache(input.chainId, input.address, data);
      priceDebug("market ok", {
        chainId: input.chainId,
        address: input.address,
        source: data.source,
        marketDataSource: spot.marketDataSource ?? null,
        hasVolume: data.volume24hUsd != null,
      });
      return data;
    } catch (error) {
      priceWarn("market error", {
        chainId: input.chainId,
        address: input.address,
        error: String(error),
      });
      return cached;
    }
  }
}

export const marketDataService = new MarketDataService();
