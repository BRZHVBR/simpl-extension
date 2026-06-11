import { getNativeCoinId, priceDebug, priceWarn } from "./price-identity";
import { getSpotPrice } from "./simpl-market-api.service";

export type NativeAssetQuote = {
  chainId: number;
  symbol: string;
  priceUsd: number;
  // EUR comes from the gateway (`vs=eur`) and is normally present. It stays
  // optional so a transient EUR failure degrades to "no rate" instead of
  // assuming USD parity — consumers must treat a missing EUR as "no EUR rate".
  priceEur?: number;
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

    // Price comes from the Simpl API Gateway (never a provider directly). USD is
    // authoritative for value math; EUR (`vs=eur`) is fetched alongside it to
    // derive the global USD→EUR rate used by the EUR valuation toggle. Both go
    // through the gateway. The two calls are independent: a USD success with an
    // EUR failure still yields a usable quote (EUR simply omitted → "—").
    try {
      const [usd, eur] = await Promise.all([
        getSpotPrice({ chainId: input.chainId, address: null, vs: "usd" }),
        getSpotPrice({ chainId: input.chainId, address: null, vs: "eur" }),
      ]);

      const priceUsd = usd?.price;

      if (typeof priceUsd !== "number" || !Number.isFinite(priceUsd)) {
        return cached;
      }

      const quote: NativeAssetQuote = {
        chainId: input.chainId,
        symbol: input.symbol,
        priceUsd,
        updatedAt: Date.now(),
      };

      // Attach EUR when the gateway returned one (the normal case). On a rare
      // EUR failure it is omitted and the EUR toggle shows "—" rather than a
      // misleading USD-parity value.
      if (typeof eur?.price === "number" && Number.isFinite(eur.price)) {
        quote.priceEur = eur.price;
      }

      writeCachedQuote(quote);
      priceDebug("native ok", {
        chainId: input.chainId,
        coinId,
        priceUsd,
        source: usd?.source,
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