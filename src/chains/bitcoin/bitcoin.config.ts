// src/chains/bitcoin/bitcoin.config.ts
//
// Bitcoin (UTXO) network configuration. The app routes every chain by a single
// numeric `chainId` (see core/networks/chain-registry.ts); Bitcoin has no
// canonical numeric id, so it uses the internal sentinel ids defined there. This
// module exposes the human "bitcoin-mainnet" / "bitcoin-testnet" ids, the
// Esplora REST base URLs, the BIP-84 coin types, the @scure/btc-signer network
// params, and BTC-specific constants used only by the Bitcoin adapter.

import { NETWORK, TEST_NETWORK } from "@scure/btc-signer";
import {
  BITCOIN_MAINNET_CHAIN_ID,
  BITCOIN_TESTNET_CHAIN_ID,
} from "../../core/networks/chain-registry";

// The main @scure/btc-signer entry re-exports the NETWORK *values* but not the
// `BTC_NETWORK` type; derive it from the value to avoid a subpath import.
export type BtcNetwork = typeof NETWORK;

export type BitcoinNetworkId = "bitcoin-mainnet" | "bitcoin-testnet";

export type BitcoinChainConfig = {
  id: BitcoinNetworkId;
  family: "bitcoin";
  // Numeric routing key shared with the rest of the wallet.
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  // Esplora (Blockstream) REST base URL — no trailing slash.
  esploraBaseUrl: string;
  // Human-facing block explorer (mempool.space) base — no trailing slash.
  explorerUrl: string;
  // BIP-84 coin type: 0 for mainnet, 1 for all testnets.
  coinType: 0 | 1;
  // Expected native SegWit (P2WPKH) human-readable prefix: bc1 / tb1.
  bech32Prefix: "bc" | "tb";
  // @scure/btc-signer network params used for address + tx encoding.
  network: BtcNetwork;
  isTestnet: boolean;
};

export const BITCOIN_MAINNET: BitcoinChainConfig = {
  id: "bitcoin-mainnet",
  family: "bitcoin",
  chainId: BITCOIN_MAINNET_CHAIN_ID,
  name: "Bitcoin",
  symbol: "BTC",
  decimals: 8,
  esploraBaseUrl: "https://blockstream.info/api",
  explorerUrl: "https://mempool.space",
  coinType: 0,
  bech32Prefix: "bc",
  network: NETWORK,
  isTestnet: false,
};

export const BITCOIN_TESTNET: BitcoinChainConfig = {
  id: "bitcoin-testnet",
  family: "bitcoin",
  chainId: BITCOIN_TESTNET_CHAIN_ID,
  name: "Bitcoin Testnet",
  symbol: "BTC",
  decimals: 8,
  esploraBaseUrl: "https://blockstream.info/testnet/api",
  explorerUrl: "https://mempool.space/testnet",
  coinType: 1,
  bech32Prefix: "tb",
  network: TEST_NETWORK,
  isTestnet: true,
};

export const BITCOIN_NETWORKS: BitcoinChainConfig[] = [
  BITCOIN_MAINNET,
  BITCOIN_TESTNET,
];

// BTC uses 8 decimals; 1 BTC = 100_000_000 sats.
export const BTC_DECIMALS = 8;
export const SATS_PER_BTC = 100_000_000n;

// Native SegWit (P2WPKH) virtual-size constants used for fee estimation.
// A transaction's vsize ≈ overhead + inputs*IN + outputs*OUT.
export const P2WPKH_INPUT_VBYTES = 68;
export const P2WPKH_OUTPUT_VBYTES = 31;
export const TX_OVERHEAD_VBYTES = 11; // ~10.5 rounded up

// Dust threshold for a P2WPKH output. Outputs at or below this are uneconomical
// to spend, so we never create change below it (it's added to the fee instead).
export const DUST_THRESHOLD_SATS = 546n;

export function getBitcoinConfigByChainId(
  chainId: number,
): BitcoinChainConfig | null {
  return BITCOIN_NETWORKS.find((network) => network.chainId === chainId) ?? null;
}

export function getRequiredBitcoinConfigByChainId(
  chainId: number,
): BitcoinChainConfig {
  const config = getBitcoinConfigByChainId(chainId);

  if (!config) {
    throw new Error(`Unsupported Bitcoin chain id: ${chainId}`);
  }

  return config;
}

export function getBitcoinTransactionExplorerUrl(
  config: BitcoinChainConfig,
  txid: string,
): string {
  return `${config.explorerUrl}/tx/${txid}`;
}

export function getBitcoinAddressExplorerUrl(
  config: BitcoinChainConfig,
  address: string,
): string {
  return `${config.explorerUrl}/address/${address}`;
}
