// src/chains/solana/solana.adapter.ts
//
// The single entry point the wallet service uses for Solana. It adapts SOL +
// SPL balances / sends / status / activity into the same shapes the rest of the
// wallet already speaks (WalletAssetBalance, the send result shape, the shared
// submitted/confirmed/failed statuses) so HomePage, SendPage, ReceivePage and
// history work largely unchanged.
//
// SECURITY: signing keys are supplied by the wallet service and never reach the
// UI. The RPC provider only ever sees public addresses + a signed transaction.

import {
  getSolanaTransactionExplorerUrl,
  type SolanaChainConfig,
} from "./solana.config";
import { isValidSolanaAddress } from "./solana.address";
import { solToLamports, formatTokenAmount } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { getSolBalanceLamports } from "./solana.balance";
import { resolveTokenMetadata } from "./solana.tokens";
import { fetchSolanaPortfolio } from "./solana.portfolio-api";
import {
  getSolanaTransactionStatus,
  loadSolanaActivity,
  sendSolTransaction,
} from "./solana.transactions";
import type { SolanaActivityItem } from "./solana.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";
import { customTokenService } from "../../core/tokens/custom-token.service";

const isDev = Boolean((import.meta.env as { DEV?: boolean } | undefined)?.DEV);

function nativeAssetId(config: SolanaChainConfig): string {
  return `native:${config.chainId}`;
}

function splAssetId(config: SolanaChainConfig, mint: string): string {
  return `spl:${config.chainId}:${mint}`;
}

// Build the Solana portfolio (native SOL + SPL balances) via the Simpl API
// Solana portfolio gateway. Direct browser calls to public Solana RPC are
// blocked/rate-limited from the extension origin (400/403/cancelled), which made
// imported SPL balances read 0 — so all balance READS now go through the
// gateway. The owner is derived locally (passed in) and the user's imported mints
// are sent so the backend resolves them too. Local signing/send/swap is
// untouched. Base58 owner/mints are sent verbatim (never lowercased).
export async function getSolanaPortfolio(
  config: SolanaChainConfig,
  address: string,
): Promise<WalletAssetBalance[]> {
  const updatedAt = new Date().toISOString();

  // Local custom-token metadata, keyed by mint (verbatim base58). Enriches the
  // backend balances with the user's imported name/symbol/logo, and supplies the
  // mint list the gateway should resolve.
  const customByMint = new Map<
    string,
    { logoURI?: string; name: string; symbol: string; decimals: number }
  >();
  try {
    for (const token of customTokenService.getTokensByChainId(config.chainId)) {
      customByMint.set(token.address, {
        logoURI: token.logoURI,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      });
    }
  } catch (error) {
    console.debug("Solana custom-token read failed:", error);
  }
  const importedMints = Array.from(customByMint.keys());

  if (isDev) {
    console.debug("[SolanaPortfolioDebug] request", {
      owner: address,
      chainId: config.chainId,
      network: config.name,
      importedMints,
    });
  }

  // One gateway call replaces the native-SOL read + bulk SPL scan + per-mint
  // direct lookups that previously hit public RPC directly.
  const portfolio = await fetchSolanaPortfolio({
    owner: address,
    importedMints,
  });

  if (isDev) {
    console.debug("[SolanaPortfolioDebug] gateway response", {
      owner: portfolio.owner,
      nativeLamports: portfolio.nativeSol?.lamports,
      tokenCount: portfolio.tokens?.length ?? 0,
      tokens: (portfolio.tokens ?? []).map((t) => ({
        mint: t.mint,
        amount: t.amount,
        decimals: t.decimals,
        uiAmountString: t.uiAmountString,
        source: t.source,
      })),
      missingImportedMints: portfolio.missingImportedMints ?? [],
      warnings: portfolio.warnings ?? [],
      source: portfolio.source,
    });
  }

  // ── Native SOL (from the gateway, not a direct RPC call) ──
  const nativeLamports = portfolio.nativeSol?.lamports ?? "0";
  const nativeDecimals = portfolio.nativeSol?.decimals ?? config.decimals;
  const nativeAsset: WalletAssetBalance = {
    id: nativeAssetId(config),
    type: "native",
    chainId: config.chainId,
    chainName: config.name,
    name: config.name,
    symbol: config.symbol,
    decimals: config.decimals,
    contractAddress: null,
    balanceRaw: nativeLamports,
    formatted:
      portfolio.nativeSol?.uiAmountString ??
      formatTokenAmount(nativeLamports, nativeDecimals),
    updatedAt,
    isTransferable: true,
    visible: true,
    usdPrice: null,
    usdValue: null,
    logoUrl: null,
    isSpam: false,
    isVerified: true,
    source: "native",
  };

  // ── Held SPL tokens (gateway on-chain balances win over any zero fallback) ──
  const heldMints = new Set<string>();
  const tokenAssets: WalletAssetBalance[] = [];
  for (const token of portfolio.tokens ?? []) {
    if (!token?.mint) continue;
    const custom = customByMint.get(token.mint);
    const known = resolveTokenMetadata(token.mint);
    const decimals = token.decimals;
    const formatted =
      token.uiAmountString ?? formatTokenAmount(token.amount ?? "0", decimals);

    heldMints.add(token.mint);
    tokenAssets.push({
      id: splAssetId(config, token.mint),
      type: "spl",
      chainId: config.chainId,
      chainName: config.name,
      // Known registry label wins; otherwise the user-imported label; else mint.
      name: known.isVerified ? known.name : custom?.name ?? known.name,
      symbol: known.isVerified ? known.symbol : custom?.symbol ?? known.symbol,
      decimals,
      contractAddress: token.mint,
      balanceRaw: token.amount ?? "0",
      formatted,
      updatedAt,
      isTransferable: true,
      visible: true,
      usdPrice: null,
      usdValue: null,
      // Known-list logo wins; otherwise the imported logoURI.
      logoUrl: known.logoUrl ?? custom?.logoURI ?? null,
      isSpam: false,
      isVerified: known.isVerified,
      source: known.isVerified ? "registry" : custom ? "custom" : "discovery",
    });
  }

  // ── Imported tokens the gateway did NOT return as held → zero balance ──
  // Covers missingImportedMints and any imported mint absent from `tokens`.
  const importedAssets: WalletAssetBalance[] = [];
  for (const [mint, custom] of customByMint.entries()) {
    if (heldMints.has(mint)) continue;
    importedAssets.push({
      id: splAssetId(config, mint),
      type: "spl",
      chainId: config.chainId,
      chainName: config.name,
      name: custom.name,
      symbol: custom.symbol,
      decimals: custom.decimals,
      contractAddress: mint,
      balanceRaw: "0",
      formatted: "0",
      updatedAt,
      isTransferable: true,
      visible: true,
      usdPrice: null,
      usdValue: null,
      logoUrl: custom.logoURI ?? null,
      isSpam: false,
      isVerified: false,
      source: "custom",
    });
  }

  const finalAssets = [nativeAsset, ...tokenAssets, ...importedAssets];

  if (isDev) {
    console.debug("[SolanaPortfolioDebug] final returned SPL assets", {
      assets: finalAssets
        .filter((a) => a.type === "spl")
        .map((a) => ({
          id: a.id,
          mint: a.contractAddress,
          symbol: a.symbol,
          balanceRaw: a.balanceRaw,
          formatted: a.formatted,
          decimals: a.decimals,
          source: a.source,
          finalSource: heldMints.has(a.contractAddress ?? "")
            ? "held-gateway"
            : "imported-zero-fallback",
        })),
    });
  }

  return finalAssets;
}

// Native SOL balance in lamports, for the single-balance surfaces.
export async function getSolanaNativeBalanceLamports(
  config: SolanaChainConfig,
  address: string,
): Promise<bigint> {
  return getSolBalanceLamports(address, config);
}

export type SolanaAdapterSendResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

export type SendSolanaInput = {
  config: SolanaChainConfig;
  asset: WalletAssetBalance;
  // Display amount (e.g. "0.25").
  amount: string;
  recipient: string;
  // Signing material for the sender — supplied by the wallet service only.
  fromSecretKey: Uint8Array;
};

// Send a Solana asset. Native SOL is fully implemented; SPL token transfers are
// intentionally gated behind a clean coded error (a half-working ATA-creating
// transfer is worse than an explicit "coming soon"). SPL balances still display.
export async function sendSolanaAsset(
  input: SendSolanaInput,
): Promise<SolanaAdapterSendResult> {
  const { config, asset, amount, recipient, fromSecretKey } = input;

  if (!isValidSolanaAddress(recipient)) {
    throw solanaErrorFor("INVALID_SOLANA_ADDRESS");
  }

  if (asset.type !== "native") {
    // SPL send is not yet wired — see solana.errors SPL_SEND_UNSUPPORTED.
    throw solanaErrorFor("SPL_SEND_UNSUPPORTED");
  }

  const amountLamports = solToLamports(amount);

  const { signature } = await sendSolTransaction({
    fromSecretKey,
    toAddress: recipient,
    amountLamports,
    config,
  });

  return {
    hash: signature,
    chainId: config.chainId,
    assetSymbol: config.symbol,
    amount,
    toAddress: recipient,
    explorerUrl: getSolanaTransactionExplorerUrl(config, signature),
  };
}

// Map a Solana signature's status onto the wallet's shared activity statuses.
export async function getSolanaActivityStatus(
  config: SolanaChainConfig,
  signature: string,
): Promise<TransactionHistoryStatus> {
  return getSolanaTransactionStatus(config, signature);
}

// Load normalized Solana activity for the account's address.
export async function getSolanaActivity(
  config: SolanaChainConfig,
  address: string,
): Promise<SolanaActivityItem[]> {
  return loadSolanaActivity(config, address);
}
