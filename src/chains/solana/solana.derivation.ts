// src/chains/solana/solana.derivation.ts
//
// BIP-44 Ed25519 (SLIP-0010) HD derivation for Solana. Unlike EVM/TRON/Bitcoin
// (secp256k1), Solana keys are Ed25519, so we use ed25519-hd-key over the BIP-39
// seed produced by @scure/bip39 (already shipped in the wallet) and build a
// web3.js Keypair from the 32-byte derived seed.
//
// SECURITY: the secret keys produced here must NEVER reach the React UI, logs,
// activity or errors. They are derived inside the wallet/background service
// layer at signing time only, held transiently as Uint8Array, and never
// persisted outside the existing encrypted vault.

import { mnemonicToSeedSync } from "@scure/bip39";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { Keypair } from "@solana/web3.js";
import { normalizeMnemonicForDerivation } from "../../core/accounts/derivation";
import { getSolanaDerivationPath } from "./solana.address";

// SLIP-0010 Ed25519 HD derivation, implemented over @noble/hashes (pure JS, no
// Node crypto/stream deps) so the bundle stays browser-clean. Solana paths are
// fully hardened (m/44'/501'/i'/0'), which is the only mode SLIP-0010 supports
// for Ed25519.

const ED25519_SEED_KEY = utf8ToBytes("ed25519 seed");
const HARDENED_OFFSET = 0x80000000;

type HdNode = { key: Uint8Array; chainCode: Uint8Array };

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

function masterKeyFromSeed(seed: Uint8Array): HdNode {
  const I = hmacSha512(ED25519_SEED_KEY, seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

// Hardened child derivation: data = 0x00 || key || ser32(index). `index` here is
// the raw BIP-44 index; the hardened offset is applied internally.
function deriveHardenedChild(node: HdNode, index: number): HdNode {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);

  const hardened = (index + HARDENED_OFFSET) >>> 0;
  const view = new DataView(data.buffer);
  view.setUint32(33, hardened, false); // big-endian

  const I = hmacSha512(node.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

// Walk a fully-hardened path (e.g. "m/44'/501'/0'/0'") from the seed and return
// the 32-byte Ed25519 seed at that node.
function deriveEd25519Seed(path: string, seed: Uint8Array): Uint8Array {
  const segments = path
    .split("/")
    .slice(1) // drop the leading "m"
    .map((segment) => {
      const hardened = segment.endsWith("'") || segment.endsWith("h");
      const value = Number.parseInt(segment.replace(/['h]$/, ""), 10);
      if (!Number.isInteger(value) || value < 0 || !hardened) {
        throw new Error(`Invalid hardened path segment: ${segment}`);
      }
      return value;
    });

  let node = masterKeyFromSeed(seed);
  for (const index of segments) {
    node = deriveHardenedChild(node, index);
  }

  return node.key;
}

// A derived Solana account. `secretKey` is the 64-byte web3.js secret key
// (signing material) — keep it in the service layer only. `publicKey` is the
// same base58 string as `address` (kept for callers that want the explicit
// field per the public API).
export type DerivedSolanaAccount = {
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
  derivationPath: string;
};

// Build a web3.js Keypair for `accountIndex` from a mnemonic. Internal — returns
// signing material; callers in the service layer must not expose `secretKey`.
export function deriveSolanaKeypairFromMnemonic(
  mnemonic: string,
  accountIndex: number,
): { keypair: Keypair; derivationPath: string } {
  const normalized = normalizeMnemonicForDerivation(mnemonic);
  const seed = mnemonicToSeedSync(normalized);
  const derivationPath = getSolanaDerivationPath(accountIndex);

  const ed25519Seed = deriveEd25519Seed(derivationPath, seed);
  const keypair = Keypair.fromSeed(Uint8Array.from(ed25519Seed));

  return { keypair, derivationPath };
}

// Derive the Solana account (address + signing material) for `accountIndex`
// from a mnemonic. This is the explicit public derivation entry point.
export function deriveSolanaAccountFromMnemonic(
  mnemonic: string,
  accountIndex: number,
): DerivedSolanaAccount {
  const { keypair, derivationPath } = deriveSolanaKeypairFromMnemonic(
    mnemonic,
    accountIndex,
  );

  const address = keypair.publicKey.toBase58();

  return {
    address,
    publicKey: address,
    secretKey: keypair.secretKey,
    derivationPath,
  };
}

// Public-only view: just the base58 address. Used for the display/persist path
// so we never hold key material longer than needed.
export function deriveSolanaAddress(
  mnemonic: string,
  accountIndex: number,
): string {
  return deriveSolanaKeypairFromMnemonic(
    mnemonic,
    accountIndex,
  ).keypair.publicKey.toBase58();
}
