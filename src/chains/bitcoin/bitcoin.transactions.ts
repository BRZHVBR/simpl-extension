// src/chains/bitcoin/bitcoin.transactions.ts
//
// Bitcoin transaction building (coin selection + fee estimation + PSBT signing)
// and activity loading. On-chain amounts are integer satoshis (bigint).
//
// SECURITY: signing keys (Uint8Array) are passed in by the wallet service and
// used only with the local @scure/btc-signer signer. They are never logged,
// persisted, or sent to the Esplora provider. We do not echo raw signing errors.

import { Transaction } from "@scure/btc-signer";
import { hex } from "@scure/base";
import {
  DUST_THRESHOLD_SATS,
  P2WPKH_INPUT_VBYTES,
  P2WPKH_OUTPUT_VBYTES,
  TX_OVERHEAD_VBYTES,
  getBitcoinTransactionExplorerUrl,
  type BitcoinChainConfig,
} from "./bitcoin.config";
import { bitcoinErrorFor, normalizeBitcoinError } from "./bitcoin.errors";
import {
  broadcastTransaction,
  getAddressTransactions,
  getTransactionStatus,
} from "./bitcoin.esplora";
import type {
  BitcoinActivityItem,
  BitcoinUtxo,
  EsploraTx,
} from "./bitcoin.types";
import type { TransactionHistoryStatus } from "../../core/transactions/transaction-history.service";

// --- Fee estimation ------------------------------------------------------

// Approximate virtual size (vbytes) of a P2WPKH tx with the given input/output
// counts: overhead + inputs*68 + outputs*31.
export function estimateVbytes(inputCount: number, outputCount: number): number {
  return (
    TX_OVERHEAD_VBYTES +
    inputCount * P2WPKH_INPUT_VBYTES +
    outputCount * P2WPKH_OUTPUT_VBYTES
  );
}

export function estimateFeeSats(
  inputCount: number,
  outputCount: number,
  feeRateSatPerVb: number,
): bigint {
  const vbytes = estimateVbytes(inputCount, outputCount);
  return BigInt(Math.ceil(vbytes * feeRateSatPerVb));
}

// --- Coin selection ------------------------------------------------------

export type CoinSelection = {
  inputs: BitcoinUtxo[];
  feeSats: bigint;
  // Change amount routed to the change address; 0n when no change output.
  changeSats: bigint;
  hasChange: boolean;
  totalInputSats: bigint;
};

// Simple MVP coin selection: sort UTXOs descending by value and accumulate until
// the target amount + estimated fee is covered. The fee is recalculated as the
// input count grows. A change output is added only when the leftover is above
// the dust threshold; otherwise the dust is absorbed into the fee.
// Throws INSUFFICIENT_BALANCE when the UTXO set can't cover amount + fee.
export function selectUtxos(
  utxos: BitcoinUtxo[],
  targetSats: bigint,
  feeRateSatPerVb: number,
): CoinSelection {
  if (targetSats <= 0n) {
    throw bitcoinErrorFor("INVALID_AMOUNT");
  }

  const sorted = [...utxos].sort((a, b) =>
    a.value < b.value ? 1 : a.value > b.value ? -1 : 0,
  );

  const selected: BitcoinUtxo[] = [];
  let total = 0n;

  for (const utxo of sorted) {
    selected.push(utxo);
    total += utxo.value;

    // Fee assuming a change output (recipient + change = 2 outputs).
    const feeWithChange = estimateFeeSats(selected.length, 2, feeRateSatPerVb);

    if (total < targetSats + feeWithChange) {
      continue;
    }

    const change = total - targetSats - feeWithChange;

    if (change > DUST_THRESHOLD_SATS) {
      return {
        inputs: selected,
        feeSats: feeWithChange,
        changeSats: change,
        hasChange: true,
        totalInputSats: total,
      };
    }

    // Change would be dust: drop the change output and absorb the remainder
    // (target..total) into the fee. The single-output fee is necessarily
    // covered because it is smaller than the two-output fee we already cleared.
    return {
      inputs: selected,
      feeSats: total - targetSats,
      changeSats: 0n,
      hasChange: false,
      totalInputSats: total,
    };
  }

  throw bitcoinErrorFor("INSUFFICIENT_BALANCE");
}

// --- Build + sign --------------------------------------------------------

// A signing key tied to the wallet address that owns the UTXOs it can spend.
export type BitcoinSigningKey = {
  address: string;
  privateKey: Uint8Array;
};

export type BuiltBitcoinTransaction = {
  txHex: string;
  txid: string;
  feeSats: bigint;
};

// Build, sign and finalize a P2WPKH PSBT for the given selection. Returns the
// raw tx hex + txid ready to broadcast. Does NOT broadcast.
export function buildSignedBitcoinTransaction(params: {
  config: BitcoinChainConfig;
  selection: CoinSelection;
  recipient: string;
  amountSats: bigint;
  changeAddress: string;
  signingKeys: BitcoinSigningKey[];
}): BuiltBitcoinTransaction {
  const { config, selection, recipient, amountSats, changeAddress, signingKeys } =
    params;

  let tx: Transaction;
  try {
    tx = new Transaction();

    for (const utxo of selection.inputs) {
      tx.addInput({
        // Display-order hex txid (matches Transaction.id); the library reverses
        // it internally for serialization.
        txid: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: hex.decode(utxo.scriptHex),
          amount: utxo.value,
        },
      });
    }
  } catch (error) {
    throw normalizeBitcoinError(error, "BUILD_TX_FAILED");
  }

  try {
    tx.addOutputAddress(recipient, amountSats, config.network);
  } catch {
    throw bitcoinErrorFor("INVALID_BITCOIN_ADDRESS");
  }

  if (selection.hasChange) {
    try {
      tx.addOutputAddress(changeAddress, selection.changeSats, config.network);
    } catch (error) {
      throw normalizeBitcoinError(error, "BUILD_TX_FAILED");
    }
  }

  try {
    // Only sign with keys whose address actually owns a selected input, then
    // finalize. @scure validates each signature as it signs.
    const ownerAddresses = new Set(
      selection.inputs.map((utxo) => utxo.address),
    );
    const neededKeys = signingKeys.filter((key) =>
      ownerAddresses.has(key.address),
    );

    if (neededKeys.length === 0) {
      throw bitcoinErrorFor("SIGNING_FAILED");
    }

    for (const key of neededKeys) {
      tx.sign(key.privateKey);
    }

    tx.finalize();
  } catch (error) {
    // Never echo the cause — it could embed key material.
    if (error instanceof Error && error.name === "BitcoinError") {
      throw error;
    }
    throw bitcoinErrorFor("SIGNING_FAILED");
  }

  return { txHex: tx.hex, txid: tx.id, feeSats: selection.feeSats };
}

// Broadcast a fully signed raw tx and return its txid.
export async function broadcastBitcoinTransaction(
  config: BitcoinChainConfig,
  rawTxHex: string,
): Promise<string> {
  return broadcastTransaction(config, rawTxHex);
}

// --- Status + activity ---------------------------------------------------

export async function getBitcoinTransactionStatus(
  config: BitcoinChainConfig,
  txid: string,
): Promise<TransactionHistoryStatus> {
  try {
    const status = await getTransactionStatus(config, txid);
    return status.confirmed ? "confirmed" : "submitted";
  } catch {
    // A not-yet-indexed tx reads as still pending rather than failed.
    return "submitted";
  }
}

function sumOwnedVout(tx: EsploraTx, owned: Set<string>): bigint {
  return tx.vout.reduce((sum, out) => {
    const address = out.scriptpubkey_address;
    return address && owned.has(address) ? sum + BigInt(out.value) : sum;
  }, 0n);
}

function sumNonOwnedVout(tx: EsploraTx, owned: Set<string>): bigint {
  return tx.vout.reduce((sum, out) => {
    const address = out.scriptpubkey_address;
    return address && owned.has(address) ? sum : sum + BigInt(out.value);
  }, 0n);
}

function sumOwnedVin(tx: EsploraTx, owned: Set<string>): bigint {
  return tx.vin.reduce((sum, input) => {
    const address = input.prevout?.scriptpubkey_address;
    return address && owned.has(address)
      ? sum + BigInt(input.prevout?.value ?? 0)
      : sum;
  }, 0n);
}

// Normalize one Esplora tx into a wallet activity item relative to the owned
// addresses. Pure — easy to unit test.
export function toActivityItem(
  config: BitcoinChainConfig,
  tx: EsploraTx,
  ownedAddresses: Set<string>,
): BitcoinActivityItem {
  const ownedReceived = sumOwnedVout(tx, ownedAddresses);
  const ownedSent = sumOwnedVin(tx, ownedAddresses);
  const nonOwnedOut = sumNonOwnedVout(tx, ownedAddresses);
  const feeSats = tx.fee != null ? BigInt(tx.fee) : null;

  let direction: BitcoinActivityItem["direction"];
  let amountSats: bigint;

  if (ownedSent === 0n) {
    direction = "incoming";
    amountSats = ownedReceived;
  } else if (nonOwnedOut === 0n) {
    direction = "self";
    amountSats = feeSats ?? 0n;
  } else {
    direction = "outgoing";
    amountSats = nonOwnedOut;
  }

  return {
    txid: tx.txid,
    direction,
    amountSats,
    feeSats,
    confirmed: Boolean(tx.status?.confirmed),
    blockTime: tx.status?.block_time ?? null,
    explorerUrl: getBitcoinTransactionExplorerUrl(config, tx.txid),
  };
}

// Load activity across the owned (receive + change) addresses: fetch each
// address's txs, merge by txid, normalize, and sort newest first (pending
// before confirmed, then by block time descending).
export async function loadBitcoinActivity(
  config: BitcoinChainConfig,
  ownedAddresses: string[],
): Promise<BitcoinActivityItem[]> {
  const owned = new Set(ownedAddresses);

  let perAddress: EsploraTx[][];
  try {
    perAddress = await Promise.all(
      ownedAddresses.map((address) => getAddressTransactions(config, address)),
    );
  } catch (error) {
    throw normalizeBitcoinError(error);
  }

  const byTxid = new Map<string, EsploraTx>();
  for (const tx of perAddress.flat()) {
    if (!byTxid.has(tx.txid)) {
      byTxid.set(tx.txid, tx);
    }
  }

  const items = [...byTxid.values()].map((tx) =>
    toActivityItem(config, tx, owned),
  );

  return items.sort((a, b) => {
    if (a.confirmed !== b.confirmed) {
      return a.confirmed ? 1 : -1; // pending first
    }
    return (b.blockTime ?? 0) - (a.blockTime ?? 0);
  });
}
