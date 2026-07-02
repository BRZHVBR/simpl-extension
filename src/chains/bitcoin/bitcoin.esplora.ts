// src/chains/bitcoin/bitcoin.esplora.ts
//
// Lightweight Esplora (Blockstream) REST provider. Read-only chain access plus
// raw-transaction broadcast. This layer NEVER sees a private key, seed, or PSBT
// secret — it only ever receives public addresses and a fully signed raw tx hex.

import type { BitcoinChainConfig } from "./bitcoin.config";
import { bitcoinErrorFor, normalizeBitcoinError } from "./bitcoin.errors";
import type {
  BitcoinAddressInfo,
  BitcoinUtxo,
  EsploraTx,
} from "./bitcoin.types";

type EsploraAddressStats = {
  funded_txo_sum?: number;
  spent_txo_sum?: number;
  tx_count?: number;
};

type EsploraAddressResponse = {
  address: string;
  chain_stats?: EsploraAddressStats;
  mempool_stats?: EsploraAddressStats;
};

type EsploraUtxoResponse = {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
};

type EsploraFeeEstimates = Record<string, number>;

async function esploraFetch(
  config: BitcoinChainConfig,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${config.esploraBaseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw normalizeBitcoinError(error);
  }

  if (!response.ok) {
    // 4xx/5xx from Esplora — surface as a network error (the body may contain a
    // useful reason for broadcast failures; callers add the specific code).
    const body = await response.text().catch(() => "");
    throw normalizeBitcoinError(
      new Error(`Esplora ${response.status}: ${body}`),
    );
  }

  return response;
}

function toBigSats(value: number | undefined): bigint {
  return BigInt(Math.max(0, Math.round(value ?? 0)));
}

// GET /address/:address — funded/spent totals (chain + mempool) and tx count.
export async function getAddressInfo(
  config: BitcoinChainConfig,
  address: string,
): Promise<BitcoinAddressInfo> {
  const response = await esploraFetch(config, `/address/${address}`);
  const data = (await response.json()) as EsploraAddressResponse;

  const chain = data.chain_stats ?? {};
  const mempool = data.mempool_stats ?? {};

  return {
    address,
    chainFundedSats: toBigSats(chain.funded_txo_sum),
    chainSpentSats: toBigSats(chain.spent_txo_sum),
    mempoolFundedSats: toBigSats(mempool.funded_txo_sum),
    mempoolSpentSats: toBigSats(mempool.spent_txo_sum),
    txCount: (chain.tx_count ?? 0) + (mempool.tx_count ?? 0),
  };
}

// GET /address/:address/utxo — spendable outputs for an address.
export async function getAddressUtxos(
  config: BitcoinChainConfig,
  address: string,
  scriptHex: string,
): Promise<BitcoinUtxo[]> {
  const response = await esploraFetch(config, `/address/${address}/utxo`);
  const data = (await response.json()) as EsploraUtxoResponse[];

  return data.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    value: toBigSats(utxo.value),
    address,
    scriptHex,
    confirmed: Boolean(utxo.status?.confirmed),
    blockHeight: utxo.status?.block_height ?? null,
  }));
}

// GET /address/:address/txs — recent transactions touching an address (newest
// first, capped by Esplora at the latest mempool + ~25 confirmed).
export async function getAddressTransactions(
  config: BitcoinChainConfig,
  address: string,
): Promise<EsploraTx[]> {
  const response = await esploraFetch(config, `/address/${address}/txs`);
  return (await response.json()) as EsploraTx[];
}

// GET /tx/:txid/status — confirmation status for a single transaction.
export async function getTransactionStatus(
  config: BitcoinChainConfig,
  txid: string,
): Promise<{ confirmed: boolean; blockHeight: number | null }> {
  const response = await esploraFetch(config, `/tx/${txid}/status`);
  const data = (await response.json()) as {
    confirmed?: boolean;
    block_height?: number;
  };

  return {
    confirmed: Boolean(data.confirmed),
    blockHeight: data.block_height ?? null,
  };
}

// GET /fee-estimates — map of confirmation-target (blocks) → sat/vB.
export async function getFeeEstimates(
  config: BitcoinChainConfig,
): Promise<EsploraFeeEstimates> {
  const response = await esploraFetch(config, `/fee-estimates`);
  return (await response.json()) as EsploraFeeEstimates;
}

// POST /tx — broadcast a fully signed raw transaction (hex body). Returns the
// txid Esplora echoes back. The hex is already-signed public data; no secret is
// ever sent here.
export async function broadcastTransaction(
  config: BitcoinChainConfig,
  rawTxHex: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${config.esploraBaseUrl}/tx`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: rawTxHex,
    });
  } catch (error) {
    throw normalizeBitcoinError(error, "BROADCAST_FAILED");
  }

  const text = (await response.text().catch(() => "")).trim();

  if (!response.ok) {
    throw bitcoinErrorFor(
      "BROADCAST_FAILED",
      text ? `Broadcast rejected: ${text}` : undefined,
    );
  }

  return text;
}
