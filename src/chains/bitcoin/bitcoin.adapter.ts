// src/chains/bitcoin/bitcoin.adapter.ts
//
// The single entry point the wallet service uses for Bitcoin. It adapts BTC
// balances / sends / status / activity into the same shapes the rest of the
// wallet already speaks (WalletAssetBalance, the send result shape, the shared
// submitted/confirmed/failed statuses) so HomePage, SendPage, ReceivePage and
// history work largely unchanged.
//
// SECURITY: signing keys are supplied by the wallet service and never reach the
// UI. The Esplora provider only ever sees public addresses + a signed raw tx.

import {
  getBitcoinTransactionExplorerUrl,
  type BitcoinChainConfig,
} from "./bitcoin.config";
import { bitcoinErrorFor } from "./bitcoin.errors";
import { scriptHexForAddress, isValidBitcoinAddress } from "./bitcoin.address";
import { satsToBtc, btcToSats } from "./bitcoin.format";
import {
  getBitcoinBalance,
  loadBitcoinUtxos,
  type OwnedBitcoinAddress,
} from "./bitcoin.balance";
import {
  buildSignedBitcoinTransaction,
  broadcastBitcoinTransaction,
  getBitcoinTransactionStatus,
  loadBitcoinActivity,
  selectUtxos,
  type BitcoinSigningKey,
} from "./bitcoin.transactions";
import type { BitcoinActivityItem, BitcoinSendResult } from "./bitcoin.types";
import type { WalletAssetBalance } from "../../core/tokens/token-balance.service";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

// Map address strings the wallet owns into (address, scriptHex) pairs for
// read-only balance/UTXO queries.
function toOwnedAddresses(
  config: BitcoinChainConfig,
  addresses: string[],
): OwnedBitcoinAddress[] {
  return addresses.map((address) => ({
    address,
    scriptHex: scriptHexForAddress(address, config),
  }));
}

function nativeAssetId(config: BitcoinChainConfig): string {
  return `native:${config.chainId}`;
}

// Build the BTC portfolio (a single native asset) summed across the receive +
// change addresses. A failed read throws — the wallet service surfaces it.
// TODO(btc): wire a USD price source for BTC; until then usdValue stays null.
export async function getBitcoinPortfolio(
  config: BitcoinChainConfig,
  addresses: string[],
): Promise<WalletAssetBalance[]> {
  const balance = await getBitcoinBalance(config, addresses);
  const updatedAt = new Date().toISOString();

  return [
    {
      id: nativeAssetId(config),
      type: "native",
      chainId: config.chainId,
      chainName: config.name,
      name: config.name,
      symbol: config.symbol,
      decimals: config.decimals,
      contractAddress: null,
      balanceRaw: balance.totalSats.toString(),
      formatted: satsToBtc(balance.totalSats),
      updatedAt,
      isTransferable: true,
      visible: true,
      usdPrice: null,
      usdValue: null,
      logoUrl: null,
      isSpam: false,
      isVerified: true,
      source: "native",
    },
  ];
}

// Native BTC balance in satoshis, summed across receive + change addresses.
export async function getBitcoinNativeBalanceSats(
  config: BitcoinChainConfig,
  addresses: string[],
): Promise<bigint> {
  const balance = await getBitcoinBalance(config, addresses);
  return balance.totalSats;
}

export type SendBitcoinInput = {
  config: BitcoinChainConfig;
  // Display BTC amount (e.g. "0.0012").
  amount: string;
  recipient: string;
  feeRateSatPerVb: number;
  // The account's receive + change addresses (UTXOs are spent from both).
  ownedAddresses: string[];
  // Where change goes (the external change address).
  changeAddress: string;
  // Signing keys for the owned addresses (receive + change).
  signingKeys: BitcoinSigningKey[];
};

export type BitcoinAdapterSendResult = {
  hash: string;
  chainId: number;
  assetSymbol: string;
  amount: string;
  toAddress: string;
  explorerUrl: string | null;
};

// Send native BTC: validate, load UTXOs, select coins, build + sign the PSBT,
// then broadcast. Returns the wallet's shared send-result shape.
export async function sendBitcoinAsset(
  input: SendBitcoinInput,
): Promise<BitcoinAdapterSendResult> {
  const {
    config,
    amount,
    recipient,
    feeRateSatPerVb,
    ownedAddresses,
    changeAddress,
    signingKeys,
  } = input;

  if (!isValidBitcoinAddress(recipient, config)) {
    throw bitcoinErrorFor("INVALID_BITCOIN_ADDRESS");
  }

  if (!Number.isFinite(feeRateSatPerVb) || feeRateSatPerVb <= 0) {
    throw bitcoinErrorFor("FEE_ESTIMATION_FAILED");
  }

  const amountSats = btcToSats(amount);

  const utxos = await loadBitcoinUtxos(
    config,
    toOwnedAddresses(config, ownedAddresses),
  );

  if (utxos.length === 0) {
    throw bitcoinErrorFor("INSUFFICIENT_BALANCE");
  }

  const selection = selectUtxos(utxos, amountSats, feeRateSatPerVb);

  const built = buildSignedBitcoinTransaction({
    config,
    selection,
    recipient,
    amountSats,
    changeAddress,
    signingKeys,
  });

  const txid = await broadcastBitcoinTransaction(config, built.txHex);

  return {
    hash: txid,
    chainId: config.chainId,
    assetSymbol: config.symbol,
    amount,
    toAddress: recipient,
    explorerUrl: getBitcoinTransactionExplorerUrl(config, txid),
  };
}

// Map a BTC tx's status onto the wallet's shared activity statuses.
export async function getBitcoinActivityStatus(
  config: BitcoinChainConfig,
  txid: string,
): Promise<TransactionHistoryStatus> {
  return getBitcoinTransactionStatus(config, txid);
}

// Load normalized BTC activity across the account's receive + change addresses.
export async function getBitcoinActivity(
  config: BitcoinChainConfig,
  addresses: string[],
): Promise<BitcoinActivityItem[]> {
  return loadBitcoinActivity(config, addresses);
}

export type { BitcoinSendResult };
