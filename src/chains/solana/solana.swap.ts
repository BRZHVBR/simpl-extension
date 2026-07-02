// src/chains/solana/solana.swap.ts
//
// Local signing for a Simpl-API/Jupiter-built Solana swap transaction. The
// backend returns an UNSIGNED VersionedTransaction (base64); we deserialize it,
// sign it with the selected account's Solana keypair, and serialize it back to
// base64 for /v1/solana/swap/execute.
//
// SECURITY: the secret key is used only to construct the in-memory Keypair and
// never leaves this function — it is not logged, returned or persisted. No
// network call happens here (broadcast is done server-side by /execute).

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { solanaErrorFor } from "./solana.errors";

// Binary-safe base64 helpers (avoid relying on a global Buffer polyfill).
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Deserialize the backend's base64 VersionedTransaction, sign it locally with
// the given secret key, and return the signed transaction as base64. Throws a
// normalized SolanaError (never leaks key material) on any failure.
export function signSolanaSwapTransaction(params: {
  transactionBase64: string;
  fromSecretKey: Uint8Array;
}): string {
  let signer: Keypair;
  try {
    signer = Keypair.fromSecretKey(params.fromSecretKey);
  } catch {
    throw solanaErrorFor("SIGNING_FAILED");
  }

  let transaction: VersionedTransaction;
  try {
    transaction = VersionedTransaction.deserialize(
      base64ToBytes(params.transactionBase64),
    );
  } catch {
    throw solanaErrorFor(
      "BUILD_TX_FAILED",
      "Could not prepare this swap. Try again.",
    );
  }

  try {
    // Adds/overwrites this account's signature in the transaction's signer slot;
    // any co-signers the backend already applied are preserved.
    transaction.sign([signer]);
  } catch {
    throw solanaErrorFor("SIGNING_FAILED");
  }

  return bytesToBase64(transaction.serialize());
}
