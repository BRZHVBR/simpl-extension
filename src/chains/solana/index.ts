// src/chains/solana/index.ts
//
// Barrel for the Solana (Ed25519, account-based) adapter. Mirrors the structure
// of the EVM/TRON/Bitcoin chain modules: config + address + derivation +
// balance + tokens + transactions + errors + format behind one adapter surface.

export * from "./solana.config";
export * from "./solana.errors";
export * from "./solana.rpc";
export * from "./solana.format";
export * from "./solana.address";
export * from "./solana.derivation";
export * from "./solana.types";
export * from "./solana.balance";
export * from "./solana.tokens";
export * from "./solana.transactions";
export * from "./solana.adapter";
