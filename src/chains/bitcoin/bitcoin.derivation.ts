// src/chains/bitcoin/bitcoin.derivation.ts
//
// BIP-84 native SegWit HD derivation for Bitcoin. Bitcoin uses secp256k1 like
// EVM/TRON, but its own coin type, change branch, and address encoding. We use
// the @scure bip39/bip32 stack already shipped in the wallet.
//
// SECURITY: the private keys produced here must NEVER reach the React UI. They
// are derived inside the wallet/background service layer at signing time only,
// held transiently as Uint8Array, and never logged or persisted.

import { mnemonicToSeedSync } from "@scure/bip39";
import { HDKey } from "@scure/bip32";
import { getAddress } from "@scure/btc-signer";
import { hex } from "@scure/base";
import { normalizeMnemonicForDerivation } from "../../core/accounts/derivation";
import type { BitcoinChainConfig } from "./bitcoin.config";
import {
  getBitcoinDerivationPath,
  p2wpkhFromPublicKey,
  scriptHexForAddress,
  type BitcoinAddressChain,
} from "./bitcoin.address";

// A single derived BIP-84 key + its native SegWit address. `privateKey` is
// signing material — keep it in the service layer only.
export type DerivedBitcoinKey = {
  chain: BitcoinAddressChain;
  derivationPath: string;
  address: string;
  scriptHex: string;
  publicKey: Uint8Array;
  privateKey: Uint8Array;
};

// The receive + change keys for one account on one Bitcoin network.
export type DerivedBitcoinAccount = {
  receive: DerivedBitcoinKey;
  change: DerivedBitcoinKey;
};

function deriveKey(
  rootKey: HDKey,
  config: BitcoinChainConfig,
  accountIndex: number,
  chain: BitcoinAddressChain,
): DerivedBitcoinKey {
  const derivationPath = getBitcoinDerivationPath(config, accountIndex, chain);
  const node = rootKey.derive(derivationPath);

  if (!node.privateKey || !node.publicKey) {
    throw new Error("Failed to derive Bitcoin key.");
  }

  const { address, scriptHex } = p2wpkhFromPublicKey(node.publicKey, config);

  return {
    chain,
    derivationPath,
    address,
    scriptHex,
    publicKey: node.publicKey,
    privateKey: node.privateKey,
  };
}

// Derive the receive + change keys (BIP-84) for `accountIndex` on `config`'s
// network from a mnemonic. Returns signing-capable material — callers must keep
// it inside the service layer and must not expose `privateKey`.
export function deriveBitcoinAccount(
  mnemonic: string,
  config: BitcoinChainConfig,
  accountIndex: number,
): DerivedBitcoinAccount {
  const normalized = normalizeMnemonicForDerivation(mnemonic);
  const seed = mnemonicToSeedSync(normalized);
  const rootKey = HDKey.fromMasterSeed(seed);

  return {
    receive: deriveKey(rootKey, config, accountIndex, "receive"),
    change: deriveKey(rootKey, config, accountIndex, "change"),
  };
}

// A single P2WPKH key for an imported raw private key. A lone secp256k1 key has
// no HD tree, so there is no receive/change split — the one address serves as
// both. Used only for "privateKey" imported accounts.
export type SingleBitcoinKey = {
  address: string;
  scriptHex: string;
  privateKey: Uint8Array;
};

function stripHexPrefix(value: string): string {
  return value.startsWith("0x") ? value.slice(2) : value;
}

// Derive a single native SegWit (P2WPKH) key from a raw secp256k1 private key
// (e.g. an imported EVM key) on `config`'s network. Signing material — keep in
// the service layer only.
export function deriveBitcoinKeyFromPrivateKey(
  privateKeyHex: string,
  config: BitcoinChainConfig,
): SingleBitcoinKey {
  const normalized = stripHexPrefix(privateKeyHex.trim());

  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("Invalid private key.");
  }

  const privateKey = hex.decode(normalized);
  const address = getAddress("wpkh", privateKey, config.network);

  if (!address) {
    throw new Error("Failed to derive a Bitcoin address.");
  }

  return {
    address,
    scriptHex: scriptHexForAddress(address, config),
    privateKey,
  };
}

// Public-only view: just the receive + change address strings. Used for the
// display/persist path so we never hold key material longer than needed.
export function deriveBitcoinAddresses(
  mnemonic: string,
  config: BitcoinChainConfig,
  accountIndex: number,
): { receive: string; change: string } {
  const account = deriveBitcoinAccount(mnemonic, config, accountIndex);
  return {
    receive: account.receive.address,
    change: account.change.address,
  };
}
