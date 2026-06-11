// src/chains/solana/solana.tokens.ts
//
// SPL token loading. Reads the owner's parsed token accounts and returns a
// unified balance list compatible with the wallet's Home/Assets surfaces. Token
// metadata for a handful of popular mints is seeded below for nice labels/logos;
// it is NOT the source of truth — any other mint still shows up, falling back to
// a shortened mint as its symbol/name so the list never blanks or crashes.

import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { SolanaChainConfig } from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import { formatTokenAmount } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { withSolanaRead } from "./solana.rpc";
import type { SolanaTokenBalance } from "./solana.types";

type KnownToken = {
  symbol: string;
  name: string;
  logoUrl: string | null;
};

// Seed metadata for popular mainnet SPL mints. Display-only; extend freely.
export const KNOWN_SPL_TOKENS: Record<string, KnownToken> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
    logoUrl: null,
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
    logoUrl: null,
  },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
    symbol: "JUP",
    name: "Jupiter",
    logoUrl: null,
  },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
    symbol: "BONK",
    name: "Bonk",
    logoUrl: null,
  },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: {
    symbol: "WIF",
    name: "dogwifhat",
    logoUrl: null,
  },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: {
    symbol: "PYTH",
    name: "Pyth Network",
    logoUrl: null,
  },
};

function shortenMint(mint: string): string {
  return mint.length <= 8 ? mint : `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

// Map a mint to its display metadata, falling back to a shortened mint when the
// mint is unknown (never throws, never returns empty labels).
export function resolveTokenMetadata(mint: string): {
  symbol: string;
  name: string;
  logoUrl: string | null;
  isVerified: boolean;
} {
  const known = KNOWN_SPL_TOKENS[mint];

  if (known) {
    return { ...known, isVerified: true };
  }

  const short = shortenMint(mint);
  return { symbol: short, name: short, logoUrl: null, isVerified: false };
}

type ParsedTokenAccountInfo = {
  mint?: string;
  tokenAmount?: {
    amount?: string;
    decimals?: number;
    uiAmount?: number | null;
  };
};

function readParsedInfo(account: unknown): ParsedTokenAccountInfo | null {
  const parsed = (
    account as {
      account?: { data?: { parsed?: { info?: ParsedTokenAccountInfo } } };
    }
  )?.account?.data?.parsed?.info;

  return parsed ?? null;
}

// Load the owner's SPL token balances. By default only positive balances are
// returned (the common wallet view); pass includeZero to keep empty accounts.
// Reads across the config's endpoints with fallback (solana.rpc).
export async function getSplTokenBalances(
  address: string,
  config: SolanaChainConfig,
  options: { includeZero?: boolean } = {},
): Promise<SolanaTokenBalance[]> {
  if (!isValidSolanaAddress(address)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  const owner = new PublicKey(address);

  const response = await withSolanaRead(config, (connection) =>
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
  );

  const balances: SolanaTokenBalance[] = [];

  for (const entry of response.value) {
    const info = readParsedInfo(entry);
    const mint = info?.mint;
    const amountRaw = info?.tokenAmount?.amount;
    const decimals = info?.tokenAmount?.decimals;

    if (!mint || amountRaw == null || decimals == null) {
      continue;
    }

    const rawAmount = BigInt(amountRaw);

    if (!options.includeZero && rawAmount <= 0n) {
      continue;
    }

    const metadata = resolveTokenMetadata(mint);

    balances.push({
      mint,
      symbol: metadata.symbol,
      name: metadata.name,
      decimals,
      rawAmount,
      formatted: formatTokenAmount(rawAmount, decimals),
      logoUrl: metadata.logoUrl,
      isVerified: metadata.isVerified,
    });
  }

  return balances;
}
