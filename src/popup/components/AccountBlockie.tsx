// src/popup/components/AccountBlockie.tsx
//
// Deterministic account avatar rendered from an account ADDRESS using the
// canonical ethereum-blockies algorithm (ethereum-blockies-base64, which
// returns a PNG data URL). This is the single source of truth for every
// account avatar in the app — accounts list, details hero, home chip, and the
// receive account selector. It intentionally knows nothing about account
// label, type, or index: the address alone is the visual identity. Account
// status (active / imported / watch-only) is shown separately via pills/badges.

import { memo } from "react";
import makeBlockie from "ethereum-blockies-base64";

type AccountBlockieProps = {
  address: string;
  size?: number;
  className?: string;
};

// Data URLs are pure functions of the (normalized) address, so cache them
// across renders and across the whole app — important on the accounts list
// where many blockies render at once.
const blockieCache = new Map<string, string | null>();

function getBlockieDataUrl(address: string | null | undefined): string | null {
  if (!address) return null;

  // Normalize casing so a checksummed and a lowercase form of the same address
  // always produce the same blockie.
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;

  const cached = blockieCache.get(normalized);
  if (cached !== undefined) return cached;

  let dataUrl: string | null = null;
  try {
    dataUrl = makeBlockie(normalized);
  } catch {
    dataUrl = null;
  }

  blockieCache.set(normalized, dataUrl);
  return dataUrl;
}

function AccountBlockieBase({
  address,
  size = 38,
  className,
}: AccountBlockieProps) {
  const dataUrl = getBlockieDataUrl(address);
  const radius = Math.max(4, Math.round(size * 0.22));
  const classes = `account-blockie${className ? ` ${className}` : ""}`;

  // Neutral placeholder if the address is missing/malformed — never crash.
  if (!dataUrl) {
    return (
      <div
        className={`${classes} account-blockie--placeholder`}
        style={{ width: size, height: size, minWidth: size, borderRadius: radius }}
        aria-hidden="true"
      />
    );
  }

  return (
    <img
      className={classes}
      src={dataUrl}
      width={size}
      height={size}
      style={{ width: size, height: size, minWidth: size, borderRadius: radius }}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}

// Memoize: re-render only when address/size/className change.
export const AccountBlockie = memo(AccountBlockieBase);

export default AccountBlockie;
