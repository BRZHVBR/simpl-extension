// src/chains/bitcoin/bitcoin.address.ts
//
// Bitcoin address helpers: BIP-84 derivation paths, P2WPKH (native SegWit)
// address + output-script encoding from a public key, and address validation.
// These are pure, PUBLIC-key-only utilities — no private key material here.

import { p2wpkh, Address, OutScript } from "@scure/btc-signer";
import { hex } from "@scure/base";
import type { BitcoinChainConfig } from "./bitcoin.config";

export type BitcoinAddressChain = "receive" | "change";

// BIP-84 native SegWit path. The Simpl account index maps to the BIP-84 account
// level; the address index is fixed at 0 for the MVP.
//   mainnet receive: m/84'/0'/{accountIndex}'/0/0
//   mainnet change:  m/84'/0'/{accountIndex}'/1/0
//   testnet uses coin type 1.
// TODO(btc): for HD address rotation / gap scanning, vary the final index.
export function getBitcoinDerivationPath(
  config: BitcoinChainConfig,
  accountIndex: number,
  chain: BitcoinAddressChain,
): string {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("Account index must be a non-negative integer.");
  }

  const changeIndex = chain === "change" ? 1 : 0;
  return `m/84'/${config.coinType}'/${accountIndex}'/${changeIndex}/0`;
}

export type P2wpkhScript = {
  address: string;
  // Hex-encoded P2WPKH output script (witnessUtxo.script for spending).
  scriptHex: string;
};

// Derive the native SegWit (P2WPKH) address + output script for a compressed
// secp256k1 public key on the given network. Throws if the library cannot
// encode an address (e.g. a malformed/ uncompressed key).
export function p2wpkhFromPublicKey(
  publicKey: Uint8Array,
  config: BitcoinChainConfig,
): P2wpkhScript {
  const payment = p2wpkh(publicKey, config.network);

  if (!payment.address) {
    throw new Error("Failed to derive a Bitcoin address.");
  }

  return {
    address: payment.address,
    scriptHex: hex.encode(payment.script),
  };
}

// True when `address` is a valid Bitcoin address for the given network. Uses the
// library's network-specific decoder, which rejects malformed input AND
// addresses for the wrong network (e.g. a bc1 address on testnet or a tb1
// address on mainnet). Accepts any standard address type the network can build
// an output for; coin selection/output building stays in bitcoin.transactions.
export function isValidBitcoinAddress(
  address: string,
  config: BitcoinChainConfig,
): boolean {
  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return false;
  }

  try {
    Address(config.network).decode(trimmed);
    return true;
  } catch {
    return false;
  }
}

// The hex-encoded output script for a (valid) address on `config`'s network.
// Lets read-only paths build a UTXO's witnessUtxo.script from just the stored
// address string (no key material needed). Throws on an invalid address.
export function scriptHexForAddress(
  address: string,
  config: BitcoinChainConfig,
): string {
  const decoded = Address(config.network).decode(address.trim());

  if (!decoded) {
    throw new Error("Invalid Bitcoin address.");
  }

  return hex.encode(OutScript.encode(decoded));
}

// Like isValidBitcoinAddress but reports WHY it failed, so the send flow can
// distinguish "not a Bitcoin address at all" from "valid, but wrong network".
export function classifyBitcoinAddress(
  address: string,
  config: BitcoinChainConfig,
  otherConfig: BitcoinChainConfig,
): "valid" | "wrong-network" | "invalid" {
  if (isValidBitcoinAddress(address, config)) {
    return "valid";
  }

  if (isValidBitcoinAddress(address, otherConfig)) {
    return "wrong-network";
  }

  return "invalid";
}
