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
import { solToLamports } from "./solana.format";
import { solanaErrorFor } from "./solana.errors";
import { getSolBalance, getSolBalanceLamports } from "./solana.balance";
import { getSplTokenBalances } from "./solana.tokens";
import {
  getSolanaTransactionStatus,
  loadSolanaActivity,
  sendSolTransaction,
} from "./solana.transactions";
import type { SolanaActivityItem } from "./solana.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

function nativeAssetId(config: SolanaChainConfig): string {
  return `native:${config.chainId}`;
}

function splAssetId(config: SolanaChainConfig, mint: string): string {
  return `spl:${config.chainId}:${mint}`;
}

// Build the Solana portfolio: native SOL plus any SPL token balances. A failed
// SPL read degrades to SOL-only so one slow/failed token call never blanks the
// screen; a failed native read throws (the wallet service surfaces it).
export async function getSolanaPortfolio(
  config: SolanaChainConfig,
  address: string,
): Promise<WalletAssetBalance[]> {
  const updatedAt = new Date().toISOString();
  const balance = await getSolBalance(address, config);

  const nativeAsset: WalletAssetBalance = {
    id: nativeAssetId(config),
    type: "native",
    chainId: config.chainId,
    chainName: config.name,
    name: config.name,
    symbol: config.symbol,
    decimals: config.decimals,
    contractAddress: null,
    balanceRaw: balance.raw.toString(),
    formatted: balance.formatted,
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

  let tokenAssets: WalletAssetBalance[] = [];
  try {
    const tokens = await getSplTokenBalances(address, config);
    tokenAssets = tokens.map((token) => ({
      id: splAssetId(config, token.mint),
      type: "spl",
      chainId: config.chainId,
      chainName: config.name,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      contractAddress: token.mint,
      balanceRaw: token.rawAmount.toString(),
      formatted: token.formatted,
      updatedAt,
      isTransferable: true,
      visible: true,
      usdPrice: null,
      usdValue: null,
      logoUrl: token.logoUrl,
      isSpam: false,
      isVerified: token.isVerified,
      source: token.isVerified ? "registry" : "discovery",
    }));
  } catch (error) {
    console.debug("Solana SPL balance read failed:", error);
    tokenAssets = [];
  }

  return [nativeAsset, ...tokenAssets];
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
