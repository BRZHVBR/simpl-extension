// scripts/check-bitcoin-testnet-live.ts
//
// LIVE Bitcoin Testnet integration check. Exercises the real adapter modules
// (esplora provider, balance, fees, activity) against the live Blockstream
// testnet API — NO mocks. Read-only by default; it never broadcasts unless
// BTC_LIVE_BROADCAST=1 is set AND the derived address has spendable UTXOs.
//
// Run: npx tsx scripts/check-bitcoin-testnet-live.ts
// Mainnet is intentionally never touched here.

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { BITCOIN_TESTNET } = await import("../src/chains/bitcoin/bitcoin.config");
const { deriveBitcoinAccount } = await import(
  "../src/chains/bitcoin/bitcoin.derivation"
);
const { getBitcoinBalance, loadBitcoinUtxos } = await import(
  "../src/chains/bitcoin/bitcoin.balance"
);
const { getBitcoinFeeQuotes } = await import("../src/chains/bitcoin/bitcoin.fees");
const { getBitcoinActivity, sendBitcoinAsset } = await import(
  "../src/chains/bitcoin/bitcoin.adapter"
);
const { scriptHexForAddress } = await import(
  "../src/chains/bitcoin/bitcoin.address"
);
const { satsToBtc } = await import("../src/chains/bitcoin/bitcoin.format");

// Standard BIP-84 test mnemonic (communal test funds may exist on testnet).
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

const account = deriveBitcoinAccount(MNEMONIC, BITCOIN_TESTNET, 0);
const receive = account.receive.address;
const change = account.change.address;

console.log("=== Derived testnet addresses (BIP-84, account 0) ===");
console.log("receive:", receive);
console.log("change :", change);
console.log(
  "receive starts with tb1q:",
  receive.startsWith("tb1q") ? "PASS" : "FAIL",
);

console.log("\n=== Live balance (Blockstream testnet) ===");
const balance = await getBitcoinBalance(BITCOIN_TESTNET, [receive, change]);
console.log("confirmed:", satsToBtc(balance.confirmedSats), "BTC");
console.log("pending  :", satsToBtc(balance.pendingSats), "BTC");
console.log("total    :", satsToBtc(balance.totalSats), "BTC");

console.log("\n=== Live UTXOs ===");
const utxos = await loadBitcoinUtxos(BITCOIN_TESTNET, [
  { address: receive, scriptHex: scriptHexForAddress(receive, BITCOIN_TESTNET) },
  { address: change, scriptHex: scriptHexForAddress(change, BITCOIN_TESTNET) },
]);
console.log("utxo count:", utxos.length);
for (const u of utxos.slice(0, 5)) {
  console.log(
    `  ${u.txid.slice(0, 12)}…:${u.vout}  ${satsToBtc(u.value)} BTC  ${
      u.confirmed ? "confirmed" : "pending"
    }`,
  );
}

console.log("\n=== Live fee estimates ===");
const fees = await getBitcoinFeeQuotes(BITCOIN_TESTNET);
console.log("isFallback:", fees.isFallback);
console.log(
  `slow ${fees.slow.satPerVb} | normal ${fees.normal.satPerVb} | fast ${fees.fast.satPerVb} sat/vB`,
);

console.log("\n=== Live activity (classification) ===");
const activity = await getBitcoinActivity(BITCOIN_TESTNET, [receive, change]);
console.log("activity items:", activity.length);
for (const a of activity.slice(0, 6)) {
  console.log(
    `  ${a.direction.padEnd(8)} ${satsToBtc(a.amountSats)} BTC  fee=${
      a.feeSats != null ? satsToBtc(a.feeSats) : "-"
    }  ${a.confirmed ? "confirmed" : "pending"}  ${a.explorerUrl}`,
  );
}
const hasMempoolHost = activity.every((a) =>
  a.explorerUrl.startsWith("https://mempool.space/testnet/tx/"),
);
console.log(
  "all explorer links point to mempool.space/testnet:",
  activity.length === 0 ? "n/a" : hasMempoolHost ? "PASS" : "FAIL",
);

// --- Optional real broadcast (guarded) -----------------------------------
const wantBroadcast = process.env.BTC_LIVE_BROADCAST === "1";
const spendable = utxos.reduce((s, u) => s + u.value, 0n);

if (!wantBroadcast) {
  console.log(
    "\n[broadcast skipped] set BTC_LIVE_BROADCAST=1 to attempt a tiny testnet self-send.",
  );
} else if (spendable < 2_000n) {
  console.log(
    `\n[broadcast skipped] insufficient testnet funds (${satsToBtc(
      spendable,
    )} BTC). Fund ${receive} via a testnet faucet first.`,
  );
} else {
  console.log("\n=== Live testnet broadcast (self-send) ===");
  // Send a tiny amount back to our own change address; sign with both keys.
  const result = await sendBitcoinAsset({
    config: BITCOIN_TESTNET,
    amount: "0.00001", // 1000 sats
    recipient: change,
    feeRateSatPerVb: fees.normal.satPerVb,
    ownedAddresses: [receive, change],
    changeAddress: change,
    signingKeys: [
      { address: receive, privateKey: account.receive.privateKey },
      { address: change, privateKey: account.change.privateKey },
    ],
  });
  console.log("broadcast txid:", result.hash);
  console.log("explorer:", result.explorerUrl);
}

console.log("\nLive testnet read checks complete.");
