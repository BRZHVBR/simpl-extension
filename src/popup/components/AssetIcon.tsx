// src/popup/components/AssetIcon.tsx

import { useState } from "react";
import {
  resolveTokenLogoCandidates,
  setCachedTokenLogo,
} from "../../utils/token-logo-resolver";
import { getNetworkIconUrl } from "./NetworkIcon";

const TOKEN_ICONS: Record<string, string> = {
  BNB: "/token-icons/bnb.png",
  WBNB: "/token-icons/bnb.png",
  USDT: "/token-icons/usdt.png",
  USDC: "/token-icons/usdc.png",
  CAKE: "/token-icons/cake.png",
  ETH: "/token-icons/eth.png",
  WETH: "/token-icons/eth.png",
  BTC: "/token-icons/btc.png",
  WBTC: "/token-icons/btc.png",
  SOL: "/token-icons/sol.png",
  MATIC: "/token-icons/matic.png",
  POL: "/token-icons/matic.png",
};

const FALLBACK_PALETTE = [
  { bg: "#E8F0FE", fg: "#2B63D9" },
  { bg: "#FEF0E8", fg: "#D96B2B" },
  { bg: "#E8FEF0", fg: "#1DA85A" },
  { bg: "#F8E8FE", fg: "#A32BD9" },
  { bg: "#F0E8FE", fg: "#6A2BD9" },
  { bg: "#E8F8FE", fg: "#2BB5D9" },
  { bg: "#FEF8E8", fg: "#C49B00" },
  { bg: "#E8FEFC", fg: "#2BD9C4" },
];

// Module-level cache of URLs that failed to load — persists across component instances for the session
const failedUrls = new Set<string>();

function hashTicker(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

type AssetIconProps = {
  ticker?: string | null;
  symbol?: string | null;
  logoURI?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  contractAddress?: string | null;
  chainId?: number;
  size?: number;
  className?: string;
};

export function AssetIcon({
  ticker,
  symbol,
  logoURI,
  logoUrl,
  address,
  contractAddress,
  chainId,
  size = 32,
  className,
}: AssetIconProps) {
  const key = (ticker ?? symbol ?? "").toUpperCase();
  const [, setFailTick] = useState(0);

  const resolvedAddress = address ?? contractAddress ?? null;

  // Build ordered priority list of image URLs to try
  const sources: string[] = [];

  // 1. Local hardcoded icons — always fast, no network request
  const hardcoded = TOKEN_ICONS[key];
  if (hardcoded) sources.push(hardcoded);

  // 2. External sources: logoURI prop → logo cache → Trust Wallet CDN → 1inch CDN
  const externalCandidates = resolveTokenLogoCandidates({
    address: resolvedAddress,
    chainId,
    logoURI: logoURI ?? logoUrl,
  });
  for (const url of externalCandidates) {
    if (!sources.includes(url)) sources.push(url);
  }

  // 3. Native assets (no contract address) fall back to their network icon, so
  // chains without a dedicated token PNG (e.g. native TRX on TRON) show the
  // chain art instead of initials. Only used when an explicit logo and the
  // hardcoded token icon above didn't already provide one — so ETH/BNB/Base
  // native icons are unaffected.
  if (resolvedAddress === null && chainId != null) {
    const networkIcon = getNetworkIconUrl(chainId);
    if (networkIcon && !sources.includes(networkIcon)) {
      sources.push(networkIcon);
    }
  }

  if (import.meta.env.DEV) {
    console.debug("[AssetIcon]", {
      symbol: key,
      chainId,
      address: resolvedAddress,
      logoURI: logoURI ?? logoUrl ?? null,
      candidates: sources,
    });
  }

  // First source not known to have failed
  const activeSrc = sources.find((src) => !failedUrls.has(src)) ?? null;

  if (activeSrc) {
    return (
      <img
        src={activeSrc}
        alt={key || "token"}
        width={size}
        height={size}
        className={`asset-icon asset-icon-image${className ? ` ${className}` : ""}`}
        style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}
        onLoad={() => {
          // Persist successful external URL to localStorage so future renders skip other candidates
          if (resolvedAddress && chainId && !activeSrc.startsWith("/")) {
            setCachedTokenLogo(chainId, resolvedAddress, activeSrc);
          }
        }}
        onError={() => {
          if (import.meta.env.DEV) {
            console.debug("[AssetIcon] failed:", activeSrc, "symbol:", key);
          }
          failedUrls.add(activeSrc);
          setFailTick((n) => n + 1);
        }}
      />
    );
  }

  // Fallback avatar — up to 2 characters with stable pastel background
  const label = key.length >= 2 ? key.slice(0, 2) : key.slice(0, 1) || "?";
  const palette =
    FALLBACK_PALETTE[hashTicker(key || "?") % FALLBACK_PALETTE.length];
  const fontSize = label.length === 2 ? 14 : 17;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      className={`asset-icon asset-icon-fallback${className ? ` ${className}` : ""}`}
      style={{ flexShrink: 0 }}
    >
      <circle cx="22" cy="22" r="22" fill={palette.bg} />
      <text
        x="22"
        y="22"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={palette.fg}
      >
        {label}
      </text>
    </svg>
  );
}
