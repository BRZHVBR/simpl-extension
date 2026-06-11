// src/chains/solana/solana.config.ts
//
// Solana (Ed25519, account-based) network configuration. The app routes every
// chain by a single numeric `chainId` (see core/networks/chain-registry.ts);
// Solana has no canonical numeric id, so it uses the internal sentinel ids
// defined there. This module exposes the human "solana-mainnet" /
// "solana-devnet" cluster ids, the configurable JSON-RPC endpoints, the Solscan
// explorer URLs (mainnet vs the ?cluster=devnet query) and SOL constants used
// only by the Solana adapter. No EVM chainId is ever used for Solana.

import {
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
} from "../../core/networks/chain-registry";

export type SolanaNetworkId = "solana-mainnet" | "solana-devnet";

// Solana cluster moniker used for explorer ?cluster= queries. Mainnet uses no
// query (it is the default on Solscan).
export type SolanaCluster = "mainnet-beta" | "devnet";

export type SolanaChainConfig = {
  id: SolanaNetworkId;
  family: "solana";
  // Numeric routing key shared with the rest of the wallet.
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  cluster: SolanaCluster;
  // Primary JSON-RPC endpoint (first of `rpcUrls`). Kept for display/back-compat.
  rpcUrl: string;
  // Ordered JSON-RPC endpoints tried with fallback (see solana.rpc.ts). The
  // first that responds is used; later ones cover 403/429/outage. The public
  // `api.mainnet-beta.solana.com` is kept only as a low-priority fallback — it
  // rejects (403) many extension/browser origins, which is the root cause of the
  // "Couldn't refresh balances" error this list fixes.
  rpcUrls: string[];
  // Human-facing block explorer (Solscan) base — no trailing slash.
  explorerUrl: string;
  isTestnet: boolean;
};

// Optional build-time override (comma-separated). In production this should point
// at a backend/proxy so no provider API key ships in the extension bundle; in
// local dev it lets you swap in a private RPC. `import.meta.env` is statically
// replaced by Vite; it is undefined under tsx/node, where this yields [].
function envRpcUrls(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const env = import.meta.env as Record<string, string | undefined> | undefined;

// Public, browser/extension-CORS-friendly endpoints. publicnode is already the
// project's EVM RPC provider, so it is the primary here too. mainnet-beta is
// last because it commonly 403s from the extension origin.
const MAINNET_RPC_URLS: string[] = [
  ...envRpcUrls(env?.VITE_SOLANA_MAINNET_RPC_URLS),
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

const DEVNET_RPC_URLS: string[] = [
  ...envRpcUrls(env?.VITE_SOLANA_DEVNET_RPC_URLS),
  "https://api.devnet.solana.com",
];

export const SOLANA_MAINNET: SolanaChainConfig = {
  id: "solana-mainnet",
  family: "solana",
  chainId: SOLANA_MAINNET_CHAIN_ID,
  name: "Solana",
  symbol: "SOL",
  decimals: 9,
  cluster: "mainnet-beta",
  rpcUrl: MAINNET_RPC_URLS[0],
  rpcUrls: MAINNET_RPC_URLS,
  explorerUrl: "https://solscan.io",
  isTestnet: false,
};

export const SOLANA_DEVNET: SolanaChainConfig = {
  id: "solana-devnet",
  family: "solana",
  chainId: SOLANA_DEVNET_CHAIN_ID,
  name: "Solana Devnet",
  symbol: "SOL",
  decimals: 9,
  cluster: "devnet",
  rpcUrl: DEVNET_RPC_URLS[0],
  rpcUrls: DEVNET_RPC_URLS,
  explorerUrl: "https://solscan.io",
  isTestnet: true,
};

// The ordered RPC endpoints for a config, always non-empty (falls back to the
// single rpcUrl for any older/partial config object).
export function getSolanaRpcUrls(config: SolanaChainConfig): string[] {
  return config.rpcUrls && config.rpcUrls.length > 0
    ? config.rpcUrls
    : [config.rpcUrl];
}

export const SOLANA_NETWORKS: SolanaChainConfig[] = [
  SOLANA_MAINNET,
  SOLANA_DEVNET,
];

// SOL uses 9 decimals; 1 SOL = 1_000_000_000 lamports.
export const SOL_DECIMALS = 9;
export const LAMPORTS_PER_SOL = 1_000_000_000n;

// Lamports kept back on a native max-send so the transaction fee + a minimal
// rent buffer are always covered. ~0.001 SOL is generous for a single transfer
// (base fee is 5000 lamports).
export const SOL_FEE_RESERVE_LAMPORTS = 1_000_000n;

export function getSolanaConfigByChainId(
  chainId: number,
): SolanaChainConfig | null {
  return SOLANA_NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

export function getRequiredSolanaConfigByChainId(
  chainId: number,
): SolanaChainConfig {
  const config = getSolanaConfigByChainId(chainId);

  if (!config) {
    throw new Error(`Unsupported Solana chain id: ${chainId}`);
  }

  return config;
}

// Solscan query suffix: empty on mainnet, "?cluster=devnet" on devnet.
function clusterQuery(config: SolanaChainConfig): string {
  return config.cluster === "devnet" ? "?cluster=devnet" : "";
}

export function getSolanaTransactionExplorerUrl(
  config: SolanaChainConfig,
  signature: string,
): string {
  return `${config.explorerUrl}/tx/${signature}${clusterQuery(config)}`;
}

export function getSolanaAddressExplorerUrl(
  config: SolanaChainConfig,
  address: string,
): string {
  return `${config.explorerUrl}/account/${address}${clusterQuery(config)}`;
}
