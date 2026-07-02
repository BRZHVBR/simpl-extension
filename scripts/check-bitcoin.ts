// scripts/check-bitcoin.ts
//
// Unit checks for the Bitcoin (UTXO) adapter that do not touch the network:
// BIP-84 address derivation (mainnet/testnet), address validation, sats/BTC
// conversion, UTXO balance summing, fee-estimate fallback mapping, coin
// selection (incl. dust + insufficient handling) and a no-secret-leak guard on
// the signed transaction. Run with: npm run check:bitcoin

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { BITCOIN_MAINNET, BITCOIN_TESTNET } = await import(
  "../src/chains/bitcoin/bitcoin.config"
);
const { deriveBitcoinAccount } = await import(
  "../src/chains/bitcoin/bitcoin.derivation"
);
const { isValidBitcoinAddress, classifyBitcoinAddress } = await import(
  "../src/chains/bitcoin/bitcoin.address"
);
const { btcToSats, satsToBtc, formatBtcAmount } = await import(
  "../src/chains/bitcoin/bitcoin.format"
);
const { sumUtxos, sumBitcoinBalances, addressBalanceFromInfo } = await import(
  "../src/chains/bitcoin/bitcoin.balance"
);
const { feeQuotesFromEstimates, getFallbackFeeQuotes } = await import(
  "../src/chains/bitcoin/bitcoin.fees"
);
const {
  selectUtxos,
  estimateVbytes,
  estimateFeeSats,
  buildSignedBitcoinTransaction,
} = await import("../src/chains/bitcoin/bitcoin.transactions");

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

// Official BIP-84 test vector mnemonic + expected first receive/change
// addresses for account 0 on mainnet (m/84'/0'/0'/{0,1}/0).
const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const EXPECTED_MAINNET_RECEIVE =
  "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
const EXPECTED_MAINNET_CHANGE = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el";

console.log("=== bitcoin.derivation (BIP-84) ===");
const mainnetAccount = deriveBitcoinAccount(MNEMONIC, BITCOIN_MAINNET, 0);
ok(
  "mainnet receive matches BIP-84 test vector",
  mainnetAccount.receive.address === EXPECTED_MAINNET_RECEIVE,
);
ok(
  "mainnet change matches BIP-84 test vector",
  mainnetAccount.change.address === EXPECTED_MAINNET_CHANGE,
);
ok(
  "mainnet receive uses bc1 prefix",
  mainnetAccount.receive.address.startsWith("bc1q"),
);
ok(
  "mainnet derivation path is m/84'/0'/0'/0/0",
  mainnetAccount.receive.derivationPath === "m/84'/0'/0'/0/0",
);

const testnetAccount = deriveBitcoinAccount(MNEMONIC, BITCOIN_TESTNET, 0);
ok(
  "testnet receive uses tb1 prefix",
  testnetAccount.receive.address.startsWith("tb1q"),
);
ok(
  "testnet derivation path uses coin type 1",
  testnetAccount.receive.derivationPath === "m/84'/1'/0'/0/0",
);
ok(
  "different account index yields a different address",
  deriveBitcoinAccount(MNEMONIC, BITCOIN_MAINNET, 1).receive.address !==
    mainnetAccount.receive.address,
);

console.log("=== bitcoin.address validation ===");
ok(
  "valid mainnet address validates on mainnet",
  isValidBitcoinAddress(EXPECTED_MAINNET_RECEIVE, BITCOIN_MAINNET),
);
ok(
  "mainnet address rejected on testnet",
  !isValidBitcoinAddress(EXPECTED_MAINNET_RECEIVE, BITCOIN_TESTNET),
);
ok(
  "testnet address validates on testnet",
  isValidBitcoinAddress(testnetAccount.receive.address, BITCOIN_TESTNET),
);
ok(
  "garbage string is invalid",
  !isValidBitcoinAddress("not-an-address", BITCOIN_MAINNET),
);
ok(
  "EVM 0x address is rejected",
  !isValidBitcoinAddress(
    "0x0000000000000000000000000000000000000000",
    BITCOIN_MAINNET,
  ),
);
ok(
  "classify reports wrong-network for a mainnet addr on testnet",
  classifyBitcoinAddress(
    EXPECTED_MAINNET_RECEIVE,
    BITCOIN_TESTNET,
    BITCOIN_MAINNET,
  ) === "wrong-network",
);

console.log("=== bitcoin.format conversion ===");
ok("btcToSats('1') === 100000000n", btcToSats("1") === 100_000_000n);
ok("btcToSats('0.00000001') === 1n", btcToSats("0.00000001") === 1n);
ok("satsToBtc(100000000n) === '1'", satsToBtc(100_000_000n) === "1");
ok("satsToBtc(12300n) === '0.000123'", satsToBtc(12_300n) === "0.000123");
ok(
  "roundtrip btcToSats/satsToBtc('0.0012')",
  satsToBtc(btcToSats("0.0012")) === "0.0012",
);
ok(
  "formatBtcAmount adds symbol",
  formatBtcAmount(50_000n) === "0.0005 BTC",
);
throwsCode(
  "btcToSats rejects 9 decimals",
  () => btcToSats("0.000000001"),
  "INVALID_AMOUNT",
);
throwsCode("btcToSats rejects zero", () => btcToSats("0"), "INVALID_AMOUNT");
throwsCode(
  "btcToSats rejects non-numeric",
  () => btcToSats("abc"),
  "INVALID_AMOUNT",
);

console.log("=== bitcoin.balance summing ===");
const utxos = [
  { txid: "a", vout: 0, value: 100_000n, address: "x", scriptHex: "00", confirmed: true, blockHeight: 1 },
  { txid: "b", vout: 1, value: 50_000n, address: "y", scriptHex: "00", confirmed: true, blockHeight: 2 },
  { txid: "c", vout: 0, value: 25_000n, address: "x", scriptHex: "00", confirmed: false, blockHeight: null },
];
ok("sumUtxos totals all values", sumUtxos(utxos) === 175_000n);
ok("sumUtxos([]) === 0n", sumUtxos([]) === 0n);

const balance = sumBitcoinBalances([
  addressBalanceFromInfo({
    address: "x",
    chainFundedSats: 100_000n,
    chainSpentSats: 30_000n,
    mempoolFundedSats: 5_000n,
    mempoolSpentSats: 0n,
    txCount: 3,
  }),
  addressBalanceFromInfo({
    address: "y",
    chainFundedSats: 50_000n,
    chainSpentSats: 0n,
    mempoolFundedSats: 0n,
    mempoolSpentSats: 0n,
    txCount: 1,
  }),
]);
ok("aggregated confirmed balance = 120000", balance.confirmedSats === 120_000n);
ok("aggregated pending balance = 5000", balance.pendingSats === 5_000n);
ok("aggregated total = 125000", balance.totalSats === 125_000n);

console.log("=== bitcoin.fees fallback ===");
const fallback = getFallbackFeeQuotes();
ok("fallback is flagged isFallback", fallback.isFallback === true);
ok("fallback slow=3 normal=8 fast=15", fallback.slow.satPerVb === 3 && fallback.normal.satPerVb === 8 && fallback.fast.satPerVb === 15);
ok(
  "empty estimates fall back",
  feeQuotesFromEstimates({}).isFallback === true,
);
const mapped = feeQuotesFromEstimates({ "1": 20, "2": 18, "6": 9, "12": 4 });
ok("mapped estimates are not fallback", mapped.isFallback === false);
ok("normal maps ~6-block target", mapped.normal.satPerVb === 9);
ok("slow maps ~12-block target", mapped.slow.satPerVb === 4);

console.log("=== bitcoin.transactions coin selection ===");
ok("estimateVbytes(1,2) = 11 + 68 + 62 = 141", estimateVbytes(1, 2) === 141);
ok(
  "estimateFeeSats(1,2,10) = 1410",
  estimateFeeSats(1, 2, 10) === 1410n,
);

const selUtxos = [
  { txid: "a", vout: 0, value: 200_000n, address: "x", scriptHex: "00", confirmed: true, blockHeight: 1 },
  { txid: "b", vout: 0, value: 100_000n, address: "x", scriptHex: "00", confirmed: true, blockHeight: 1 },
  { txid: "c", vout: 0, value: 5_000n, address: "x", scriptHex: "00", confirmed: true, blockHeight: 1 },
];
const selection = selectUtxos(selUtxos, 150_000n, 10);
ok(
  "selection covers amount + fee",
  selection.totalInputSats >= 150_000n + selection.feeSats,
);
ok(
  "selection picks largest UTXO first",
  selection.inputs[0].value === 200_000n,
);
ok(
  "change above dust produces a change output",
  selection.hasChange && selection.changeSats > 546n,
);
throwsCode(
  "insufficient balance throws",
  () => selectUtxos(selUtxos, 10_000_000n, 10),
  "INSUFFICIENT_BALANCE",
);

// Dust change handling: pick an amount so the leftover after fee is below dust;
// the change output must be dropped and absorbed into the fee.
const dustUtxos = [
  { txid: "d", vout: 0, value: 100_000n, address: "x", scriptHex: "00", confirmed: true, blockHeight: 1 },
];
// fee(1,2,1) = 141; amount = 100000 - 141 - 100 leaves 100 sat (< dust) of change.
const dustSelection = selectUtxos(dustUtxos, 100_000n - 141n - 100n, 1);
ok("dust change is dropped (no change output)", dustSelection.hasChange === false);
ok(
  "dust is absorbed into fee (fee > base estimate)",
  dustSelection.changeSats === 0n &&
    dustSelection.feeSats === 100_000n - (100_000n - 141n - 100n),
);

console.log("=== bitcoin.transactions no-secret-leak ===");
// Build + sign a real tx with a derived key, then assert the raw tx hex never
// contains the private key (hex or WIF). The script/address are public.
const sk = mainnetAccount.receive;
const privHex = Buffer.from(sk.privateKey).toString("hex");
const buildSelection = {
  inputs: [
    {
      txid: "0000000000000000000000000000000000000000000000000000000000000001",
      vout: 0,
      value: 100_000n,
      address: sk.address,
      scriptHex: sk.scriptHex,
      confirmed: true,
      blockHeight: 1,
    },
  ],
  feeSats: 1_410n,
  changeSats: 48_590n,
  hasChange: true,
  totalInputSats: 100_000n,
};
const built = buildSignedBitcoinTransaction({
  config: BITCOIN_MAINNET,
  selection: buildSelection,
  recipient: EXPECTED_MAINNET_RECEIVE,
  amountSats: 50_000n,
  changeAddress: mainnetAccount.change.address,
  signingKeys: [{ address: sk.address, privateKey: sk.privateKey }],
});
ok("build produces a txid", /^[0-9a-f]{64}$/.test(built.txid));
ok("build produces raw tx hex", built.txHex.length > 0);
ok(
  "raw tx hex does NOT contain the private key hex",
  !built.txHex.toLowerCase().includes(privHex.toLowerCase()),
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All Bitcoin checks passed.");
