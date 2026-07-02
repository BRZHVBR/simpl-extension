// scripts/check-solana.ts
//
// Unit checks for the Solana (Ed25519) adapter that do not touch the network:
// BIP-44 Ed25519 derivation (determinism + uniqueness), base58 address
// validation (rejecting EVM / Bitcoin / TRON addresses), lamports/SOL + generic
// SPL conversion, amount-parse guards, and a no-secret-leak guard on the derived
// account. Run with: npm run check:solana

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { deriveSolanaAccountFromMnemonic } = await import(
  "../src/chains/solana/solana.derivation"
);
const {
  isValidSolanaAddress,
  normalizeSolanaAddress,
  shortenSolanaAddress,
  getSolanaDerivationPath,
} = await import("../src/chains/solana/solana.address");
const { lamportsToSol, solToLamports, formatTokenAmount, parseTokenAmount } =
  await import("../src/chains/solana/solana.format");
const { resolveTokenMetadata } = await import(
  "../src/chains/solana/solana.tokens"
);

let failures = 0;

function ok(label: string, condition: boolean): void {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures += 1;
}

function throwsCode(label: string, fn: () => unknown, expectedCode: string): void {
  try {
    fn();
    console.log(`FAIL: ${label} (expected throw)`);
    failures += 1;
  } catch (error) {
    const code = (error as { code?: string }).code;
    const codeOk = code === expectedCode;
    console.log(`${codeOk ? "PASS" : "FAIL"}: ${label} (code=${code ?? "none"})`);
    if (!codeOk) failures += 1;
  }
}

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
// Standard SLIP-0010 Ed25519 derivation (m/44'/501'/0'/0') for the canonical
// "abandon…about" mnemonic — matches Phantom / Solana CLI / ed25519-hd-key.
const EXPECTED_ACCOUNT0 = "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk";

console.log("=== solana.derivation (BIP-44 Ed25519) ===");
const account0 = deriveSolanaAccountFromMnemonic(MNEMONIC, 0);
const account0Again = deriveSolanaAccountFromMnemonic(MNEMONIC, 0);
const account1 = deriveSolanaAccountFromMnemonic(MNEMONIC, 1);

ok(
  "account 0 matches the SLIP-0010 test vector",
  account0.address === EXPECTED_ACCOUNT0,
);
ok(
  "derivation is deterministic for the same mnemonic/index",
  account0.address === account0Again.address,
);
ok(
  "different account index yields a different address",
  account0.address !== account1.address,
);
ok(
  "derivation path is m/44'/501'/0'/0'",
  account0.derivationPath === "m/44'/501'/0'/0'",
);
ok("account 1 path is m/44'/501'/1'/0'", account1.derivationPath === "m/44'/501'/1'/0'");
ok(
  "getSolanaDerivationPath(3) is m/44'/501'/3'/0'",
  getSolanaDerivationPath(3) === "m/44'/501'/3'/0'",
);
ok("derived address is a valid Solana address", isValidSolanaAddress(account0.address));
ok("publicKey equals the base58 address", account0.publicKey === account0.address);
ok("secretKey is a 64-byte Uint8Array", account0.secretKey.length === 64);

console.log("=== solana.address validation ===");
ok("valid address accepted", isValidSolanaAddress(account0.address));
ok(
  "EVM 0x address is rejected",
  !isValidSolanaAddress("0x0000000000000000000000000000000000000000"),
);
ok(
  "Bitcoin bc1 address is rejected",
  !isValidSolanaAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
);
ok(
  "TRON T-address is rejected",
  !isValidSolanaAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
);
ok("garbage string is invalid", !isValidSolanaAddress("not-an-address!!!"));
ok("empty string is invalid", !isValidSolanaAddress(""));
ok(
  "normalize round-trips a valid address",
  normalizeSolanaAddress(account0.address) === account0.address,
);
ok(
  "shorten produces an ellipsised form",
  shortenSolanaAddress(account0.address).includes("…"),
);

console.log("=== solana.format conversion ===");
ok("solToLamports('1') === 1000000000n", solToLamports("1") === 1_000_000_000n);
ok("solToLamports('0.000000001') === 1n", solToLamports("0.000000001") === 1n);
ok("lamportsToSol(1000000000n) === '1'", lamportsToSol(1_000_000_000n) === "1");
ok("lamportsToSol(12300n) === '0.0000123'", lamportsToSol(12_300n) === "0.0000123");
ok(
  "roundtrip solToLamports/lamportsToSol('0.25')",
  lamportsToSol(solToLamports("0.25")) === "0.25",
);
ok(
  "formatTokenAmount(1500000n, 6) === '1.5' (USDC-style)",
  formatTokenAmount(1_500_000n, 6) === "1.5",
);
ok(
  "parseTokenAmount('1.5', 6) === 1500000n",
  parseTokenAmount("1.5", 6) === 1_500_000n,
);
throwsCode(
  "solToLamports rejects 10 decimals",
  () => solToLamports("0.0000000001"),
  "INVALID_AMOUNT",
);
throwsCode("solToLamports rejects zero", () => solToLamports("0"), "INVALID_AMOUNT");
throwsCode(
  "solToLamports rejects non-numeric",
  () => solToLamports("abc"),
  "INVALID_AMOUNT",
);
throwsCode(
  "parseTokenAmount rejects too many decimals",
  () => parseTokenAmount("1.1234567", 6),
  "INVALID_AMOUNT",
);

console.log("=== solana.tokens metadata fallback ===");
const usdc = resolveTokenMetadata("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
ok("known USDC mint resolves to USDC", usdc.symbol === "USDC" && usdc.isVerified);
const unknown = resolveTokenMetadata("So11111111111111111111111111111111111111112");
ok(
  "unknown mint falls back to a shortened mint (not verified)",
  unknown.isVerified === false && unknown.symbol.includes("…"),
);

console.log("=== solana no-secret-leak ===");
// The base58 address must never expose the secret key bytes.
const secretHex = Buffer.from(account0.secretKey).toString("hex");
ok(
  "address does not contain secret key hex",
  !account0.address.toLowerCase().includes(secretHex.slice(0, 16).toLowerCase()),
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All Solana checks passed.");
