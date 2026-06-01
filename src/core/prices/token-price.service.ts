import {
  getCoinGeckoPlatform,
  priceDebug,
  priceWarn,
  resolveCoinGeckoId,
} from "./price-identity";

// ERC-20 spot price resolution by stable identity (chainId + lowercase
// contract address), NOT by symbol — symbols collide across chains (ETH/USDT/
// USDC exist on many networks). Uses CoinGecko's token_price endpoint, which is
// keyed by contract address, so pegged tokens (e.g. Binance-Peg ETH on BSC)
// resolve to their underlying market price automatically. Coin-id aliases for
// well-known pegged/wrapped tokens come from the shared price-identity layer.

export type TokenPrice = {
  priceUsd: number;
  priceEur: number;
  updatedAt: number;
};

const CACHE_TTL_MS = 60_000;

function priceCacheKey(chainId: number, address: string): string {
  return `simple:tokenPrice:${chainId}:${address.toLowerCase()}`;
}

function readCachedPrice(chainId: number, address: string): TokenPrice | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(priceCacheKey(chainId, address));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as TokenPrice;
    if (
      !parsed ||
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

function writeCachedPrice(
  chainId: number,
  address: string,
  price: TokenPrice,
): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      priceCacheKey(chainId, address),
      JSON.stringify(price),
    );
  } catch {
    // Price cache is optional.
  }
}

function isFresh(price: TokenPrice): boolean {
  return Date.now() - price.updatedAt < CACHE_TTL_MS;
}

type PriceMap = Record<string, TokenPrice>;

async function fetchTokenPricesByAddress(
  platform: string,
  addresses: string[],
): Promise<Record<string, { usd?: number; eur?: number }>> {
  const url = new URL(
    `https://api.coingecko.com/api/v3/simple/token_price/${platform}`,
  );
  url.searchParams.set("contract_addresses", addresses.join(","));
  url.searchParams.set("vs_currencies", "usd,eur");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`token_price ${response.status}`);
  }

  return (await response.json()) as Record<
    string,
    { usd?: number; eur?: number }
  >;
}

async function fetchPricesByCoinIds(
  coinIds: string[],
): Promise<Record<string, { usd?: number; eur?: number }>> {
  const url = new URL("https://api.coingecko.com/api/v3/simple/price");
  url.searchParams.set("ids", coinIds.join(","));
  url.searchParams.set("vs_currencies", "usd,eur");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`simple/price ${response.status}`);
  }

  return (await response.json()) as Record<
    string,
    { usd?: number; eur?: number }
  >;
}

export class TokenPriceService {
  // Synchronous cache read for instant first paint (may be stale).
  getCachedTokenPrices(chainId: number, addresses: string[]): PriceMap {
    const out: PriceMap = {};
    for (const address of addresses) {
      const cached = readCachedPrice(chainId, address);
      if (cached) out[address.toLowerCase()] = cached;
    }
    return out;
  }

  // Resolve USD/EUR prices for a batch of ERC-20 addresses on one chain.
  // Returns a map keyed by lowercase address. Missing/unknown tokens are simply
  // absent from the map (callers fall back to "No price").
  async getTokenPrices(input: {
    chainId: number;
    addresses: string[];
  }): Promise<PriceMap> {
    const { chainId } = input;
    const addresses = Array.from(
      new Set(input.addresses.map((a) => a.toLowerCase()).filter(Boolean)),
    );

    if (addresses.length === 0) return {};

    const result: PriceMap = {};
    const stale: string[] = [];

    // 1. Serve fresh cache; queue stale/missing for refetch.
    for (const address of addresses) {
      const cached = readCachedPrice(chainId, address);
      if (cached && isFresh(cached)) {
        result[address] = cached;
      } else {
        stale.push(address);
      }
    }

    if (stale.length === 0) return result;

    const now = Date.now();
    const platform = getCoinGeckoPlatform(chainId);
    const stillMissing = new Set(stale);

    // 2. Primary: CoinGecko token_price by contract address (covers pegged
    //    tokens and stables automatically).
    if (platform) {
      try {
        const data = await fetchTokenPricesByAddress(platform, stale);
        for (const address of stale) {
          const entry = data[address] ?? data[address.toLowerCase()];
          if (
            entry &&
            typeof entry.usd === "number" &&
            typeof entry.eur === "number"
          ) {
            const price: TokenPrice = {
              priceUsd: entry.usd,
              priceEur: entry.eur,
              updatedAt: now,
            };
            result[address] = price;
            writeCachedPrice(chainId, address, price);
            stillMissing.delete(address);
          }
        }
      } catch (error) {
        priceWarn("token_price lookup failed", { chainId, error: String(error) });
      }
    }

    // 3. Fallback: known pegged/wrapped tokens resolved by coin id.
    const aliasByAddress = new Map<string, string>();
    for (const address of stillMissing) {
      const coinId = resolveCoinGeckoId(chainId, address);
      if (coinId) aliasByAddress.set(address, coinId);
    }

    if (aliasByAddress.size > 0) {
      try {
        const coinIds = Array.from(new Set(aliasByAddress.values()));
        const data = await fetchPricesByCoinIds(coinIds);
        for (const [address, coinId] of aliasByAddress) {
          const entry = data[coinId];
          if (
            entry &&
            typeof entry.usd === "number" &&
            typeof entry.eur === "number"
          ) {
            const price: TokenPrice = {
              priceUsd: entry.usd,
              priceEur: entry.eur,
              updatedAt: now,
            };
            result[address] = price;
            writeCachedPrice(chainId, address, price);
            stillMissing.delete(address);
          }
        }
      } catch (error) {
        priceWarn("alias lookup failed", { chainId, error: String(error) });
      }
    }

    if (stillMissing.size > 0) {
      priceWarn("not found", { chainId, addresses: Array.from(stillMissing) });
    }

    // Serve any stale cache we still have for addresses that failed to refresh.
    for (const address of stillMissing) {
      const cached = readCachedPrice(chainId, address);
      if (cached) result[address] = cached;
    }

    priceDebug("token lookup", {
      chainId,
      requested: addresses.length,
      resolved: Object.keys(result).length,
    });

    return result;
  }
}

export const tokenPriceService = new TokenPriceService();
