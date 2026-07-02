// src/chains/solana/solana.portfolio-api.ts
//
// Client for the Simpl API Solana portfolio gateway:
//   POST /v1/solana/portfolio  → native SOL + SPL balances for an owner.
//
// Why: Chrome-extension direct browser calls to public Solana RPC
// (solana.drpc.org, api.mainnet-beta.solana.com, solana-rpc.publicnode.com)
// are blocked/rate-limited (400/403/cancelled) from the extension origin, which
// made imported SPL balances read 0. The gateway fronts a reliable RPC
// server-side. ONLY balance READS go through here — local Solana
// signing/send/swap-signing are untouched. Base58 owner/mint addresses are sent
// verbatim (never lowercased).

function resolveApiBaseUrl(): string {
  const candidate =
    (import.meta.env.VITE_SIMPL_API_URL as string | undefined) ??
    (import.meta.env.VITE_SIMPL_SWAP_PROXY_URL as string | undefined) ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();
const DEFAULT_TIMEOUT_MS = 15_000;

export type SolanaPortfolioNativeSol = {
  lamports: string;
  decimals: number;
  uiAmountString?: string | null;
};

export type SolanaPortfolioToken = {
  mint: string;
  tokenAccounts?: string[];
  programId?: string;
  amount: string;
  decimals: number;
  uiAmountString?: string | null;
  source?: string;
};

export type SolanaPortfolioResponse = {
  owner: string;
  nativeSol: SolanaPortfolioNativeSol;
  tokens: SolanaPortfolioToken[];
  missingImportedMints?: string[];
  warnings?: unknown[];
  source?: string;
};

// POST /v1/solana/portfolio. `importedMints` carries the user's locally-imported
// custom token mints so the backend can resolve their balances even when they
// aren't in its default scan. Throws on transport / non-2xx so the caller can
// decide how to degrade (the wallet keeps showing cached data on failure).
export async function fetchSolanaPortfolio(params: {
  owner: string;
  importedMints: string[];
}): Promise<SolanaPortfolioResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/v1/solana/portfolio`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        owner: params.owner,
        importedMints: params.importedMints,
      }),
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return (await response.json()) as SolanaPortfolioResponse;
  } finally {
    clearTimeout(timer);
  }
}
