import {
  canResolveChart,
  getCoinGeckoPlatform,
  getPriceIdentityKey,
  priceDebug,
  priceWarn,
  resolveCoinGeckoId,
} from "./price-identity";

// Historical price points for the AssetDetailsPage chart. Uses the shared
// price identity (chainId + native marker / contract address) so the chart
// resolves to the exact same source as the spot price. Returns null when no
// history is available so the chart can be hidden gracefully.

export type PricePoint = {
  timestamp: number;
  price: number;
};

export type PriceHistoryRange = "1D" | "7D" | "1M";

// History changes slowly — a longer TTL also blunts CoinGecko rate-limiting
// (429s) on repeat views.
const CACHE_TTL_MS = 15 * 60_000; // 15 minutes

function rangeToDays(range: PriceHistoryRange): number {
  if (range === "1D") return 1;
  if (range === "7D") return 7;
  return 30;
}

type HistoryInput = {
  chainId: number;
  // ERC-20 contract address, or null for the chain's native asset.
  address: string | null;
  range: PriceHistoryRange;
};

function cacheKey(input: HistoryInput): string {
  return `simple:priceHistory:${getPriceIdentityKey(input.chainId, input.address)}:${input.range}`;
}

type CacheEnvelope = { updatedAt: number; points: PricePoint[] };

function readCacheEnvelope(input: HistoryInput): CacheEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(input));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (!parsed || !Array.isArray(parsed.points)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readFreshCache(input: HistoryInput): PricePoint[] | null {
  const envelope = readCacheEnvelope(input);
  if (!envelope) return null;
  if (Date.now() - envelope.updatedAt > CACHE_TTL_MS) return null;
  return envelope.points;
}

// Stale cache is served only when a live fetch fails (e.g. a 429) so the chart
// survives rate-limiting instead of disappearing.
function readStaleCache(input: HistoryInput): PricePoint[] | null {
  return readCacheEnvelope(input)?.points ?? null;
}

function writeCache(input: HistoryInput, points: PricePoint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(input),
      JSON.stringify({ updatedAt: Date.now(), points }),
    );
  } catch {
    // optional
  }
}

function normalizePrices(raw: unknown): PricePoint[] | null {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { prices?: unknown }).prices)
  ) {
    return null;
  }

  const prices = (raw as { prices: unknown[] }).prices;
  const points: PricePoint[] = [];

  for (const entry of prices) {
    if (
      Array.isArray(entry) &&
      typeof entry[0] === "number" &&
      typeof entry[1] === "number"
    ) {
      points.push({ timestamp: entry[0], price: entry[1] });
    }
  }

  return points.length >= 2 ? points : null;
}

// Resolve the CoinGecko market_chart URL using the shared price identity:
// native / pegged / wrapped tokens resolve via coin id; other ERC-20s use the
// platform + contract endpoint.
function buildHistoryUrl(input: HistoryInput): URL | null {
  const coinId = resolveCoinGeckoId(input.chainId, input.address);
  if (coinId) {
    return new URL(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart`,
    );
  }

  if (input.address) {
    const platform = getCoinGeckoPlatform(input.chainId);
    if (!platform) return null;
    return new URL(
      `https://api.coingecko.com/api/v3/coins/${platform}/contract/${input.address.toLowerCase()}/market_chart`,
    );
  }

  // Native with no coin id (e.g. an unmapped chain).
  return null;
}

export class PriceHistoryService {
  async getAssetPriceHistory(input: HistoryInput): Promise<PricePoint[] | null> {
    // Skip assets where a chart isn't meaningful (stablecoins, unmapped chains)
    // so we never render a flat/empty chart or fire a doomed request.
    if (!canResolveChart(input.chainId, input.address)) {
      priceDebug("history skip", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
      });
      return null;
    }

    const fresh = readFreshCache(input);
    if (fresh) {
      priceDebug("history cache", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        points: fresh.length,
      });
      return fresh;
    }

    const url = buildHistoryUrl(input);
    if (!url) return null;

    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("days", String(rangeToDays(input.range)));

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        priceWarn("history fetch failed", {
          chainId: input.chainId,
          address: input.address,
          range: input.range,
          status: response.status,
        });
        // Survive rate-limiting / outages by reusing stale cache when present.
        return readStaleCache(input);
      }

      const points = normalizePrices(await response.json());
      if (!points) {
        priceDebug("history empty", {
          chainId: input.chainId,
          address: input.address,
          range: input.range,
        });
        return readStaleCache(input);
      }

      writeCache(input, points);
      priceDebug("history ok", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        points: points.length,
      });
      return points;
    } catch (error) {
      priceWarn("history error", {
        chainId: input.chainId,
        address: input.address,
        range: input.range,
        error: String(error),
      });
      return readStaleCache(input);
    }
  }
}

export const priceHistoryService = new PriceHistoryService();
