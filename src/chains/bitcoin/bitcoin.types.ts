// src/chains/bitcoin/bitcoin.types.ts
//
// Shared types for the Bitcoin (UTXO) adapter. On-chain amounts are always
// integer satoshis as bigint; the UI only ever sees formatted decimal strings.

// A spendable unspent output, tagged with the wallet address that owns it (so
// the signer knows which key signs it) and whether it is confirmed.
export type BitcoinUtxo = {
  txid: string;
  vout: number;
  value: bigint; // satoshis
  // The owning wallet address (receive or change) — used to pick the signing key.
  address: string;
  // P2WPKH output script for this address (witnessUtxo.script).
  scriptHex: string;
  confirmed: boolean;
  blockHeight: number | null;
};

// Result of Esplora GET /address/:address (chain + mempool funded/spent stats).
export type BitcoinAddressInfo = {
  address: string;
  chainFundedSats: bigint;
  chainSpentSats: bigint;
  mempoolFundedSats: bigint;
  mempoolSpentSats: bigint;
  txCount: number;
};

// Confirmed/pending balance for a single address, in satoshis.
export type BitcoinAddressBalance = {
  confirmedSats: bigint;
  pendingSats: bigint;
};

// Aggregated wallet balance across receive + change addresses, in satoshis.
export type BitcoinBalance = {
  confirmedSats: bigint;
  // Net unconfirmed (incoming mempool) value.
  pendingSats: bigint;
  // confirmed + pending; the spendable + inflight total.
  totalSats: bigint;
};

export type BitcoinFeePreset = "slow" | "normal" | "fast";

export type BitcoinFeeQuote = {
  preset: BitcoinFeePreset;
  satPerVb: number;
  // Block target this rate aims for (display only).
  blockTarget: number;
};

export type BitcoinFeeQuotes = {
  slow: BitcoinFeeQuote;
  normal: BitcoinFeeQuote;
  fast: BitcoinFeeQuote;
  // True when the provider failed and these are hard-coded fallback rates — the
  // UI must clearly mark the quote as an estimate in this case.
  isFallback: boolean;
};

// A minimal Esplora transaction shape (only the fields the adapter reads).
export type EsploraTxVin = {
  txid: string;
  vout: number;
  prevout: {
    scriptpubkey_address?: string;
    value: number;
  } | null;
};

export type EsploraTxVout = {
  scriptpubkey_address?: string;
  value: number;
};

export type EsploraTx = {
  txid: string;
  fee?: number;
  vin: EsploraTxVin[];
  vout: EsploraTxVout[];
  status: {
    confirmed: boolean;
    block_height?: number;
    block_time?: number;
  };
};

// A normalized activity entry for the wallet's history UI.
export type BitcoinActivityItem = {
  txid: string;
  direction: "incoming" | "outgoing" | "self";
  // Net value to the wallet in satoshis (always positive magnitude).
  amountSats: bigint;
  feeSats: bigint | null;
  confirmed: boolean;
  blockTime: number | null;
  explorerUrl: string;
};

// Result of building + broadcasting a send.
export type BitcoinSendResult = {
  txid: string;
  feeSats: bigint;
};
