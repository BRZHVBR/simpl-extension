// scripts/check-bitcoin-mainnet-readonly.ts
//
// READ-ONLY Bitcoin MAINNET verification for a user-supplied PUBLIC address (and
// optional txid). Validates the address format/network, then queries the live
// mainnet Esplora provider for balance, UTXOs and activity through the real
// adapter modules. It NEVER signs, NEVER broadcasts, and NEVER touches any key
// material — it only reads public chain data.
//
// Usage:
//   BTC_ADDR=bc1q... [BTC_TXID=<funding txid>] npx tsx scripts/check-bitcoin-mainnet-readonly.ts
//
// Mainnet only. No transaction is ever created.

const { BITCOIN_MAINNET, BITCOIN_TESTNET } = await import(
  "../src/chains/bitcoin/bitcoin.config"
);
const { isValidBitcoinAddress, scriptHexForAddress } = await import(
  "../src/chains/bitcoin/bitcoin.address"
);
const { getBitcoinBalance, loadBitcoinUtxos } = await import(
  "../src/chains/bitcoin/bitcoin.balance"
);
const { getBitcoinActivity, getBitcoinActivityStatus } = await import(
  "../src/chains/bitcoin/bitcoin.adapter"
);
const { satsToBtc } = await import("../src/chains/bitcoin/bitcoin.format");

const addr = process.env.BTC_ADDR;
const txid = process.env.BTC_TXID;

if (!addr) {
  console.error("Set BTC_ADDR=bc1q... (your wallet's mainnet receive address).");
  process.exit(1);
}

let fail = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) fail++;
};

console.log("=== Address validation (MAINNET) ===");
ok("address starts with bc1q (native SegWit P2WPKH)", addr.startsWith("bc1q"));
ok("valid on Bitcoin mainnet", isValidBitcoinAddress(addr, BITCOIN_MAINNET));
ok(
  "NOT a testnet address (rejected on testnet network)",
  !isValidBitcoinAddress(addr, BITCOIN_TESTNET),
);

console.log("\n=== Live mainnet balance (Blockstream) ===");
const balance = await getBitcoinBalance(BITCOIN_MAINNET, [addr]);
console.log("confirmed:", satsToBtc(balance.confirmedSats), "BTC");
console.log("pending  :", satsToBtc(balance.pendingSats), "BTC");
console.log("total    :", satsToBtc(balance.totalSats), "BTC");

console.log("\n=== Live mainnet UTXOs ===");
const utxos = await loadBitcoinUtxos(BITCOIN_MAINNET, [
  { address: addr, scriptHex: scriptHexForAddress(addr, BITCOIN_MAINNET) },
]);
console.log("utxo count:", utxos.length);
for (const u of utxos.slice(0, 8)) {
  console.log(
    `  ${u.txid.slice(0, 12)}…:${u.vout}  ${satsToBtc(u.value)} BTC  ${
      u.confirmed ? "confirmed" : "pending"
    }`,
  );
}

console.log("\n=== Live mainnet activity (classification + explorer host) ===");
const activity = await getBitcoinActivity(BITCOIN_MAINNET, [addr]);
console.log("activity items:", activity.length);
for (const a of activity.slice(0, 8)) {
  console.log(
    `  ${a.direction.padEnd(8)} ${satsToBtc(a.amountSats)} BTC  fee=${
      a.feeSats != null ? satsToBtc(a.feeSats) : "-"
    }  ${a.confirmed ? "confirmed" : "pending"}  ${a.explorerUrl}`,
  );
}
if (activity.length > 0) {
  const mainnetHost = activity.every((a) =>
    a.explorerUrl.startsWith("https://mempool.space/tx/"),
  );
  const noTestnet = activity.every(
    (a) => !a.explorerUrl.includes("/testnet/"),
  );
  ok("all explorer links use mainnet mempool.space/tx/ (no /testnet/)", mainnetHost && noTestnet);
}

if (txid) {
  console.log("\n=== Funding tx status (by txid) ===");
  const status = await getBitcoinActivityStatus(BITCOIN_MAINNET, txid);
  console.log(`status: ${status}`);
  const match = activity.find((a) => a.txid === txid);
  if (match) {
    ok(`incoming funding tx ${txid.slice(0, 10)}… classified as incoming`, match.direction === "incoming");
    console.log(`  amount: ${satsToBtc(match.amountSats)} BTC  explorer: ${match.explorerUrl}`);
  } else {
    console.log("  (txid not yet visible for this address — may still be propagating)");
  }
}

console.log("");
if (fail > 0) {
  console.error(`${fail} check(s) FAILED`);
  process.exit(1);
}
console.log("Read-only mainnet verification complete. No tx was created.");
