// src/utils/token-logo-resolver.ts
import { getAddress } from "ethers";
import { findConfigAsset } from "@getsimpl/config";
import { getCachedRuntimeConfigSnapshot } from "../core/config/runtime-config.service";

// Slug used by the Trust Wallet asset CDN for each supported chain
const TRUST_WALLET_CHAIN_SLUGS: Record<number, string> = {
  1: "ethereum",
  56: "smartchain",
  8453: "base",
};

const LOGO_CACHE_KEY = "simple:tokenLogoCache";

type LogoCacheEntry = { logoURI: string; updatedAt: number };
type LogoCache = Record<string, LogoCacheEntry>;

function readLogoCache(): LogoCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOGO_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LogoCache;
  } catch {
    return {};
  }
}

function writeLogoCache(cache: LogoCache): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage is optional
  }
}

/** Returns true only for HTTPS URLs — rejects data:, javascript:, http:, etc. */
export function isSafeLogoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("https://");
}

/**
 * Builds a Trust Wallet CDN URL for EVM tokens on supported chains.
 * Uses assets.trustwalletapp.com — the canonical CDN domain.
 */
export function getTrustWalletLogoUrl(
  chainId: number,
  address: string,
): string | null {
  if (!address) return null;
  const slug = TRUST_WALLET_CHAIN_SLUGS[chainId];
  if (!slug) return null;
  try {
    const checksumAddr = getAddress(address);
    return `https://assets.trustwalletapp.com/blockchains/${slug}/assets/${checksumAddr}/logo.png`;
  } catch {
    return null;
  }
}

/**
 * Builds a 1inch token logo URL.
 * Works across EVM chains — matched by lowercase contract address.
 */
export function get1inchLogoUrl(address: string): string | null {
  if (!address) return null;
  try {
    // 1inch CDN keys by lowercase address
    return `https://tokens.1inch.io/${address.toLowerCase()}.png`;
  } catch {
    return null;
  }
}

/** Reads a previously cached logo URL from localStorage. */
export function getCachedTokenLogo(
  chainId: number,
  address: string,
): string | null {
  try {
    const cache = readLogoCache();
    const key = `${chainId}:${address.toLowerCase()}`;
    return cache[key]?.logoURI ?? null;
  } catch {
    return null;
  }
}

/** Persists a confirmed logo URL to localStorage for future renders. */
export function setCachedTokenLogo(
  chainId: number,
  address: string,
  logoURI: string,
): void {
  if (!isSafeLogoUrl(logoURI)) return;
  try {
    const cache = readLogoCache();
    const key = `${chainId}:${address.toLowerCase()}`;
    // Only update if URL changed, to avoid unnecessary writes
    if (cache[key]?.logoURI === logoURI) return;
    cache[key] = { logoURI, updatedAt: Date.now() };
    writeLogoCache(cache);
  } catch {
    // ignore write failures
  }
}

export type TokenLogoAsset = {
  symbol?: string | null;
  address?: string | null;
  contractAddress?: string | null;
  chainId?: number;
  logoURI?: string | null;
  logoUrl?: string | null;
};

/**
 * Returns an ordered list of external logo URL candidates for a token:
 *   1. Explicit logoURI / logoUrl from the asset object
 *   2. localStorage token logo cache (survives page reloads)
 *   3. Runtime-config catalog logo (Simpl Discover catalog, when available)
 *   4. Trust Wallet CDN (assets.trustwalletapp.com)
 *   5. 1inch token logo CDN (tokens.1inch.io)
 *
 * Does not include hardcoded local icons — AssetIcon handles those first
 * since they are UI-layer concerns that need no network request.
 */
export function resolveTokenLogoCandidates(asset: TokenLogoAsset): string[] {
  const candidates: string[] = [];
  const addr = asset.address ?? asset.contractAddress;

  const logo = asset.logoURI ?? asset.logoUrl;
  if (logo && isSafeLogoUrl(logo)) {
    candidates.push(logo);
  }

  if (addr && asset.chainId) {
    const cached = getCachedTokenLogo(asset.chainId, addr);
    if (cached && !candidates.includes(cached)) {
      candidates.push(cached);
    }
  }

  // Curated catalog logo from the runtime config, ahead of the generic CDNs.
  // The snapshot is synchronous and may be null on the very first render (the
  // config is still resolving) — then there is simply no catalog candidate.
  // isSafeLogoUrl keeps the https-only policy, exactly like every other source.
  if (asset.chainId) {
    const config = getCachedRuntimeConfigSnapshot();
    if (config) {
      const configLogo = findConfigAsset(config, asset.chainId, addr ?? null)?.logoUrl;
      if (configLogo && isSafeLogoUrl(configLogo) && !candidates.includes(configLogo)) {
        candidates.push(configLogo);
      }
    }
  }

  if (addr && asset.chainId) {
    const twUrl = getTrustWalletLogoUrl(asset.chainId, addr);
    if (twUrl && !candidates.includes(twUrl)) {
      candidates.push(twUrl);
    }

    const inchUrl = get1inchLogoUrl(addr);
    if (inchUrl && !candidates.includes(inchUrl)) {
      candidates.push(inchUrl);
    }
  }

  return candidates;
}
