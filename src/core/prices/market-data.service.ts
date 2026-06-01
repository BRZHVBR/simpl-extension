// src/core/prices/market-data.service.ts
//
// Per-asset market data for the AssetDetails screen: spot price, 24h price
// change and 24h (market) volume — all resolved through the SAME shared price
// identity used by spot prices and the chart, so they can never disagree about
// which CoinGecko asset they describe. This is intentionally separate from the
// portfolio spot-price path (token-price / native-price services): it is only
// consulted when an asset detail screen is open, and it never feeds wallet
// balance/value math.
//
// The 24h volume returned by CoinGecko (`usd_24h_vol`) is the coin's global
// market volume, not on-chain/DEX or wallet volume — the UI labels it simply
// "24h volume". No data is fabricated: a field is omitted when the provider
// doesn't return it.

import {
  priceDebug,
  priceWarn,
  resolvePriceIdentity,
} from "./price-identity";

export type AssetMarketData = {
  priceUsd?: number;
  priceChange24hPct?: number;
  volume24hUsd?: number;
  // Provider identity used (coin id or "contract") — for diagnostics.
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

type RawEntry = {
  usd?: number;
  usd_24h_change?: number;
  usd_24h_vol?: number;
};

// Pull the optional fields out of a CoinGecko entry. Only finite numbers are
// kept — anything missing is simply omitted (no zeros, no fakes).
function toMarketData(entry: RawEntry | undefined, source: string): AssetMarketData {
  const data: AssetMarketData = { source, updatedAt: Date.now() };
  if (typeof entry?.usd === "number" && Number.isFinite(entry.usd)) {
    data.priceUsd = entry.usd;
  }
  if (
    typeof entry?.usd_24h_change === "number" &&
    Number.isFinite(entry.usd_24h_change)
  ) {
    data.priceChange24hPct = entry.usd_24h_change;
  }
  if (
    typeof entry?.usd_24h_vol === "number" &&
    Number.isFinite(entry.usd_24h_vol)
  ) {
    data.volume24hUsd = entry.usd_24h_vol;
  }
  return data;
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

    const url = new URL("https://api.coingecko.com/api/v3/simple/price");
    let source: string;

    if (identity.coinGeckoId) {
      // Native / pegged / wrapped — resolve by coin id.
      url.searchParams.set("ids", identity.coinGeckoId);
      source = identity.coinGeckoId;
    } else if (identity.address && identity.platform) {
      // Plain ERC-20 — resolve by contract address.
      url.pathname = `/api/v3/simple/token_price/${identity.platform}`;
      url.searchParams.set("contract_addresses", identity.address);
      source = "contract";
    } else {
      return cached;
    }

    url.searchParams.set("vs_currencies", "usd");
    url.searchParams.set("include_24hr_change", "true");
    url.searchParams.set("include_24hr_vol", "true");

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        priceWarn("market fetch failed", {
          chainId: input.chainId,
          address: input.address,
          status: response.status,
        });
        return cached;
      }

      const json = (await response.json()) as Record<string, RawEntry>;
      const entry = identity.coinGeckoId
        ? json[identity.coinGeckoId]
        : (json[identity.address ?? ""] ??
          json[(identity.address ?? "").toLowerCase()]);

      if (!entry || typeof entry.usd !== "number") {
        return cached;
      }

      const data = toMarketData(entry, source);
      writeCache(input.chainId, input.address, data);
      priceDebug("market ok", {
        chainId: input.chainId,
        address: input.address,
        source,
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
