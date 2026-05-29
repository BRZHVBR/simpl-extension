// src/popup/components/AssetIcon.tsx

type AssetIconProps = {
  ticker?: string | null;
  symbol?: string | null;
  logoURI?: string | null;
  size?: number;
  className?: string;
};

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

function hashTicker(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) & 0x7fffffff;
  }
  return h;
}

export function AssetIcon({ ticker, symbol, logoURI, size = 32, className }: AssetIconProps) {
  const key = (ticker ?? symbol ?? "").toUpperCase();
  const iconPath = TOKEN_ICONS[key];
  const imgSrc = iconPath ?? logoURI ?? null;

  if (imgSrc) {
    return (
      <img
        src={imgSrc}
        alt={key}
        width={size}
        height={size}
        className={`asset-token-icon__img${className ? ` ${className}` : ""}`}
        style={{ borderRadius: "50%", display: "block", flexShrink: 0 }}
      />
    );
  }

  const label = key.slice(0, 1) || "?";
  const palette = FALLBACK_PALETTE[hashTicker(key || "?") % FALLBACK_PALETTE.length];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 44 44"
      aria-hidden="true"
      className={`asset-token-icon__fallback${className ? ` ${className}` : ""}`}
      style={{ flexShrink: 0 }}
    >
      <circle cx="22" cy="22" r="22" fill={palette.bg} />
      <text
        x="22"
        y="22"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="17"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={palette.fg}
      >
        {label}
      </text>
    </svg>
  );
}
