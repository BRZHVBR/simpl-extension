// src/polyfills/buffer.ts
//
// Minimal browser/extension polyfill for the Node `Buffer` and `global` globals.
// @solana/web3.js (and some of its transitive deps) reference `Buffer` and
// `global` at runtime; neither exists in the extension's popup / sidepanel /
// service-worker contexts. Import this module FIRST in every entry that can
// reach Solana code so the globals are installed before any Solana module runs.
//
// This is additive and inert for the existing EVM / TRON / Bitcoin flows — they
// never read these globals (ethers + @scure are Uint8Array-based).

import { Buffer } from "buffer";

const globalRef = globalThis as unknown as {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
};

if (typeof globalRef.Buffer === "undefined") {
  globalRef.Buffer = Buffer;
}

if (typeof globalRef.global === "undefined") {
  globalRef.global = globalThis;
}
