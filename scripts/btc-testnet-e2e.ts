// scripts/btc-testnet-e2e.ts
//
// Live Bitcoin TESTNET end-to-end send, driven entirely through the real
// adapter modules. A throwaway testnet-only seed is generated in memory ONLY —
// it is never written to disk, never logged, and never printed (no seed / xprv
// / WIF / private key is ever exposed). Flow:
//   1. derive a tb1q receive address (to be faucet-funded by the operator),
//      plus a separate tb1q recipient address and a change address,
//   2. poll the live testnet UTXO set until funds arrive (mempool counts),
//   3. build + sign + broadcast a tiny send to the recipient,
//   4. poll the broadcast tx until confirmed, report final balance.
// Mainnet is never touched.

import { webcrypto } from "node:crypto";
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { generateMnemonic } = await import("@scure/bip39");
const { wordlist } = await import("@scure/bip39/wordlists/english.js");
const { BITCOIN_TESTNET } = await import("../src/chains/bitcoin/bitcoin.config");
const { deriveBitcoinAccount } = await import(
  "../src/chains/bitcoin/bitcoin.derivation"
);
const { getBitcoinBalance } = await import("../src/chains/bitcoin/bitcoin.balance");
const { getBitcoinFeeQuotes } = await import("../src/chains/bitcoin/bitcoin.fees");
const { getBitcoinActivityStatus, sendBitcoinAsset } = await import(
  "../src/chains/bitcoin/bitcoin.adapter"
);
const { satsToBtc } = await import("../src/chains/bitcoin/bitcoin.format");

function log(line: string): void {
  // Unbuffered single-line logging so the operator can read the fund address
  // immediately while the process keeps polling.
  process.stdout.write(line + "\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Throwaway testnet seed — in memory only, NEVER printed or persisted.
const mnemonic = generateMnemonic(wordlist, 128);

// Account 0 funds the send; account 1's receive address is the recipient
// ("another tb1q address"). All addresses are public; keys stay in memory.
const acct0 = deriveBitcoinAccount(mnemonic, BITCOIN_TESTNET, 0);
const acct1 = deriveBitcoinAccount(mnemonic, BITCOIN_TESTNET, 1);

const fundAddress = acct0.receive.address;
const changeAddress = acct0.change.address;
const recipient = acct1.receive.address;

log("=== Bitcoin TESTNET E2E ===");
log(`FUND_ADDRESS=${fundAddress}`);
log(`RECIPIENT=${recipient}`);
log(`CHANGE=${changeAddress}`);
log("(seed is in-memory only; never logged or saved)");
log("Waiting for testnet funds to arrive (polling every 20s, up to 90 min)…");

const POLL_MS = 20_000;
const DEADLINE = Date.now() + 90 * 60_000;
const MIN_SPENDABLE = 2_000n; // need enough for amount (1000) + fee

let spendable = 0n;
while (Date.now() < DEADLINE) {
  try {
    const balance = await getBitcoinBalance(BITCOIN_TESTNET, [
      fundAddress,
      changeAddress,
    ]);
    spendable = balance.totalSats;
    if (spendable >= MIN_SPENDABLE) {
      log(`FUNDS_DETECTED total=${satsToBtc(spendable)} BTC`);
      break;
    }
  } catch (error) {
    log(`poll error (will retry): ${(error as Error).message}`);
  }
  await sleep(POLL_MS);
}

if (spendable < MIN_SPENDABLE) {
  log("TIMEOUT: no testnet funds arrived within the window. Re-run to retry.");
  process.exit(2);
}

log("=== Broadcasting tiny testnet send ===");
const fees = await getBitcoinFeeQuotes(BITCOIN_TESTNET);
log(`fee preset=normal rate=${fees.normal.satPerVb} sat/vB (fallback=${fees.isFallback})`);

const AMOUNT_BTC = "0.00001"; // 1000 sats

let txid: string;
try {
  const result = await sendBitcoinAsset({
    config: BITCOIN_TESTNET,
    amount: AMOUNT_BTC,
    recipient,
    feeRateSatPerVb: fees.normal.satPerVb,
    ownedAddresses: [fundAddress, changeAddress],
    changeAddress,
    signingKeys: [
      { address: fundAddress, privateKey: acct0.receive.privateKey },
      { address: changeAddress, privateKey: acct0.change.privateKey },
    ],
  });
  txid = result.hash;
  log(`SEND_AMOUNT=${AMOUNT_BTC} BTC`);
  log(`SEND_RECIPIENT=${recipient}`);
  log(`TXID=${result.hash}`);
  log(`EXPLORER=${result.explorerUrl}`);
} catch (error) {
  const code = (error as { code?: string }).code;
  log(`BROADCAST_FAILED code=${code ?? "?"} message=${(error as Error).message}`);
  process.exit(3);
}

// Activity / status: should be pending immediately after broadcast.
const initialStatus = await getBitcoinActivityStatus(BITCOIN_TESTNET, txid);
log(`STATUS_AFTER_BROADCAST=${initialStatus}`);

log("Polling for confirmation (every 30s, up to 30 min)…");
const CONFIRM_DEADLINE = Date.now() + 30 * 60_000;
let finalStatus = initialStatus;
while (Date.now() < CONFIRM_DEADLINE) {
  await sleep(30_000);
  finalStatus = await getBitcoinActivityStatus(BITCOIN_TESTNET, txid);
  if (finalStatus === "confirmed" || finalStatus === "failed") {
    break;
  }
}
log(`FINAL_STATUS=${finalStatus}`);

const finalBalance = await getBitcoinBalance(BITCOIN_TESTNET, [
  fundAddress,
  changeAddress,
]);
const recipientBalance = await getBitcoinBalance(BITCOIN_TESTNET, [recipient]);
log(`FINAL_SENDER_BALANCE=${satsToBtc(finalBalance.totalSats)} BTC`);
log(`RECIPIENT_BALANCE=${satsToBtc(recipientBalance.totalSats)} BTC`);
log("E2E complete.");
