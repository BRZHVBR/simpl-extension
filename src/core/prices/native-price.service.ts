import { getNativeCoinId, priceDebug, priceWarn } from "./price-identity";

export type NativeAssetQuote = {
  chainId: number;
  symbol: string;
  priceUsd: number;
  priceEur: number;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;

function getNativePriceCacheKey(chainId: number): string {
  return `simple:nativePrice:${chainId}`;
}

function readCachedQuote(chainId: number): NativeAssetQuote | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getNativePriceCacheKey(chainId));

    if (!raw) return null;

    const parsed = JSON.parse(raw) as NativeAssetQuote;

    if (
      !parsed ||
      parsed.chainId !== chainId ||
      typeof parsed.symbol !== "string" ||
      typeof parsed.priceUsd !== "number" ||
      typeof parsed.priceEur !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isFreshQuote(quote: NativeAssetQuote): boolean {
  return Date.now() - quote.updatedAt < CACHE_TTL_MS;
}

function writeCachedQuote(quote: NativeAssetQuote): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      getNativePriceCacheKey(quote.chainId),
      JSON.stringify(quote),
    );
  } catch {
    // Price cache is optional.
  }
}

export class NativePriceService {
  getCachedNativeQuote(chainId: number): NativeAssetQuote | null {
    return readCachedQuote(chainId);
  }

  async getNativeQuote(input: {
    chainId: number;
    symbol: string;
  }): Promise<NativeAssetQuote | null> {
    const coinId = getNativeCoinId(input.chainId);

    if (!coinId) {
      priceWarn("native not found", {
        chainId: input.chainId,
        symbol: input.symbol,
      });
      return null;
    }

    const cached = readCachedQuote(input.chainId);

    if (cached && isFreshQuote(cached)) {
      return cached;
    }

    const url = new URL("https://api.coingecko.com/api/v3/simple/price");

    url.searchParams.set("ids", coinId);
    url.searchParams.set("vs_currencies", "usd,eur");

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });

      if (!response.ok) {
        priceWarn("native fetch failed", {
          chainId: input.chainId,
          coinId,
          status: response.status,
        });
        return cached;
      }

      const data = (await response.json()) as Record<
        string,
        {
          usd?: number;
          eur?: number;
        }
      >;

      const priceUsd = data[coinId]?.usd;
      const priceEur = data[coinId]?.eur;

      if (typeof priceUsd !== "number" || typeof priceEur !== "number") {
        return cached;
      }

      const quote: NativeAssetQuote = {
        chainId: input.chainId,
        symbol: input.symbol,
        priceUsd,
        priceEur,
        updatedAt: Date.now(),
      };

      writeCachedQuote(quote);
      priceDebug("native ok", {
        chainId: input.chainId,
        coinId,
        priceUsd,
      });

      return quote;
    } catch (error) {
      priceWarn("native error", {
        chainId: input.chainId,
        coinId,
        error: String(error),
      });
      return cached;
    }
  }
}

export const nativePriceService = new NativePriceService();