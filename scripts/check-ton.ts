// scripts/check-ton.ts
//
// Unit checks for the TON (Ed25519, smart-contract wallet) adapter that do not
// touch the network: BIP-44 Ed25519 derivation (determinism + uniqueness +
// valid contract address), user-friendly address validation (rejecting EVM /
// Bitcoin / TRON / Solana addresses), nanoton/TON conversion, amount-parse
// guards, and the native portfolio shape. Run with: npm run check:ton

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const { deriveTonAccountFromMnemonic, deriveTonAddress } = await import(
  "../src/chains/ton/ton.derivation"
);
const {
  isValidTonAddress,
  normalizeTonAddress,
  shortenTonAddress,
  getTonDerivationPath,
} = await import("../src/chains/ton/ton.address");
const { nanoToTon, tonToNano, formatTonTokenAmount, parseTonTokenAmount } =
  await import("../src/chains/ton/ton.format");
const {
  TRUSTED_JETTONS,
  resolveTrustedJetton,
  TON_NATIVE_TOKEN,
  TON_NATIVE_SYMBOL,
  TON_NATIVE_NAME,
  displayTonNativeSymbol,
  displayTonNativeName,
  applyTonNativeRename,
} = await import("../src/chains/ton/ton.tokens");
const { TON_MAINNET_CHAIN_ID } = await import(
  "../src/core/networks/chain-registry"
);
const { assertTonSendAmount, TON_FEE_RESERVE_NANO, mapTonTxStatus } =
  await import("../src/chains/ton/ton.transactions");
const { mapTonAccountState } = await import("../src/chains/ton/ton.balance");
const {
  TON_MAINNET,
  TON_API_BASE_URL,
  SIMPL_API_BASE_URL,
  getTonAddressExplorerUrl,
  getTonTransactionExplorerUrl,
  getTonJettonExplorerUrl,
} = await import("../src/chains/ton/ton.config");
const { tonApiClient } = await import("../src/core/ton/tonApiClient");
const { getTonNativeSpot, getTonNativeHistory } = await import(
  "../src/chains/ton/ton.prices"
);
const { marketDataService } = await import(
  "../src/core/prices/market-data.service"
);
const { Address } = await import("@ton/core");

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

console.log("=== ton.derivation (BIP-44 Ed25519, v4R2 wallet contract) ===");
const account0 = deriveTonAccountFromMnemonic(MNEMONIC, 0);
const account0Again = deriveTonAccountFromMnemonic(MNEMONIC, 0);
const account1 = deriveTonAccountFromMnemonic(MNEMONIC, 1);

ok(
  "derivation is deterministic for the same mnemonic/index",
  account0.address === account0Again.address,
);
ok(
  "different account index yields a different address",
  account0.address !== account1.address,
);
ok(
  "derivation path is m/44'/607'/0'/0'",
  account0.derivationPath === "m/44'/607'/0'/0'",
);
ok(
  "account 1 path is m/44'/607'/1'/0'",
  account1.derivationPath === "m/44'/607'/1'/0'",
);
ok(
  "getTonDerivationPath(3) is m/44'/607'/3'/0'",
  getTonDerivationPath(3) === "m/44'/607'/3'/0'",
);
ok("derived address is a valid TON address", isValidTonAddress(account0.address));
ok(
  "derived address is the non-bounceable mainnet (UQ…) form",
  account0.address.startsWith("UQ"),
);
ok(
  "publicKey is 32-byte Ed25519 hex (64 chars)",
  /^[0-9a-f]{64}$/.test(account0.publicKey),
);
ok(
  "deriveTonAddress matches the full account address",
  deriveTonAddress(MNEMONIC, 0) === account0.address,
);

console.log("=== ton.address validation ===");
ok("valid UQ… address accepted", isValidTonAddress(account0.address));
ok(
  "raw 0:<hex> address accepted",
  isValidTonAddress(
    "0:0000000000000000000000000000000000000000000000000000000000000000",
  ),
);
ok(
  "EVM 0x address is rejected",
  !isValidTonAddress("0x0000000000000000000000000000000000000000"),
);
ok(
  "Bitcoin bc1 address is rejected",
  !isValidTonAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
);
ok(
  "TRON T-address is rejected",
  !isValidTonAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"),
);
ok(
  "Solana base58 address is rejected",
  !isValidTonAddress("HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk"),
);
ok("garbage string is invalid", !isValidTonAddress("not-an-address!!!"));
ok("empty string is invalid", !isValidTonAddress(""));
ok(
  "normalize round-trips a derived address",
  normalizeTonAddress(account0.address) === account0.address,
);
ok(
  "shorten produces an ellipsised form",
  shortenTonAddress(account0.address).includes("…"),
);

console.log("=== ton.format conversion (9 decimals) ===");
ok("tonToNano('1') === 1000000000n", tonToNano("1") === 1_000_000_000n);
ok("tonToNano('0.000000001') === 1n", tonToNano("0.000000001") === 1n);
ok("nanoToTon(1000000000n) === '1'", nanoToTon(1_000_000_000n) === "1");
ok("nanoToTon(12300n) === '0.0000123'", nanoToTon(12_300n) === "0.0000123");
ok(
  "roundtrip tonToNano/nanoToTon('0.25')",
  nanoToTon(tonToNano("0.25")) === "0.25",
);
ok(
  "formatTonTokenAmount(1500000n, 6) === '1.5'",
  formatTonTokenAmount(1_500_000n, 6) === "1.5",
);
ok(
  "parseTonTokenAmount('1.5', 6) === 1500000n",
  parseTonTokenAmount("1.5", 6) === 1_500_000n,
);
throwsCode(
  "tonToNano rejects 10 decimals",
  () => tonToNano("0.0000000001"),
  "TON_INVALID_AMOUNT",
);
throwsCode("tonToNano rejects zero", () => tonToNano("0"), "TON_INVALID_AMOUNT");
throwsCode(
  "tonToNano rejects non-numeric",
  () => tonToNano("abc"),
  "TON_INVALID_AMOUNT",
);

console.log("=== ton.tokens trusted Jetton registry ===");
ok(
  "registry contains USDT, NOT, DOGS",
  ["USDT", "NOT", "DOGS"].every((s) =>
    TRUSTED_JETTONS.some((j) => j.symbol === s),
  ),
);
ok("USDT has 6 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "USDT")?.decimals === 6);
ok("NOT has 9 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "NOT")?.decimals === 9);
ok("DOGS has 9 decimals", TRUSTED_JETTONS.find((j) => j.symbol === "DOGS")?.decimals === 9);
ok(
  "every registry master is a valid TON address",
  TRUSTED_JETTONS.every((j) => isValidTonAddress(j.master)),
);

const usdtMaster = TRUSTED_JETTONS.find((j) => j.symbol === "USDT")!.master;
ok(
  "resolveTrustedJetton matches the canonical EQ master",
  resolveTrustedJetton(usdtMaster)?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton matches the raw (0:hex) master form",
  resolveTrustedJetton(Address.parse(usdtMaster).toRawString())?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton matches the non-bounceable (UQ…) master form",
  resolveTrustedJetton(
    Address.parse(usdtMaster).toString({ urlSafe: true, bounceable: false }),
  )?.symbol === "USDT",
);
ok(
  "resolveTrustedJetton rejects an unknown jetton master",
  resolveTrustedJetton(
    "0:0000000000000000000000000000000000000000000000000000000000000000",
  ) === null,
);
ok(
  "resolveTrustedJetton rejects a non-TON address (spam guard)",
  resolveTrustedJetton("0x0000000000000000000000000000000000000000") === null,
);

console.log("=== ton native send: recipient validation ===");
ok("UQ recipient accepted", isValidTonAddress(account0.address));
ok(
  "EQ recipient accepted",
  isValidTonAddress("EQCD39VS5jcptHL8vMjEXrzGaRcCVYto7HUn4bpAOg8xqB2N"),
);
ok(
  "EVM recipient rejected",
  !isValidTonAddress("0x0000000000000000000000000000000000000000"),
);
ok("empty recipient rejected", !isValidTonAddress(""));

console.log("=== ton native send: amount guard + fee reserve ===");
ok("fee reserve is 0.05 TON", TON_FEE_RESERVE_NANO === 50_000_000n);
throwsCode(
  "zero amount rejected",
  () => assertTonSendAmount(tonToNano("1"), 0n),
  "TON_INVALID_AMOUNT",
);
throwsCode(
  "amount over balance rejected",
  () => assertTonSendAmount(tonToNano("0.5"), tonToNano("1")),
  "TON_INSUFFICIENT_BALANCE",
);
throwsCode(
  "amount leaving no fee room rejected",
  () => assertTonSendAmount(tonToNano("1"), tonToNano("0.98")),
  "TON_INSUFFICIENT_BALANCE_FOR_FEE",
);
throwsCode(
  "sending the FULL balance is rejected (no fee room)",
  () => assertTonSendAmount(tonToNano("1"), tonToNano("1")),
  "TON_INSUFFICIENT_BALANCE_FOR_FEE",
);

console.log("=== ton native send: safe MAX = balance - feeReserve ===");
{
  const balance = tonToNano("2");
  const maxSend = balance - TON_FEE_RESERVE_NANO;
  let passed = true;
  try {
    // Safe MAX (balance - reserve) must be sendable...
    assertTonSendAmount(balance, maxSend);
  } catch {
    passed = false;
  }
  ok("balance - feeReserve is sendable", passed);
  // ...but one nanoton more must fail the fee-room check.
  throwsCode(
    "balance - feeReserve + 1 fails fee check",
    () => assertTonSendAmount(balance, maxSend + 1n),
    "TON_INSUFFICIENT_BALANCE_FOR_FEE",
  );
}

console.log("=== ton explorer URL generation ===");
ok(
  "address URL → tonviewer.com/<addr>",
  getTonAddressExplorerUrl(TON_MAINNET, account0.address) ===
    `https://tonviewer.com/${account0.address}`,
);
ok(
  "tx URL → tonviewer.com/transaction/<hash>",
  getTonTransactionExplorerUrl(TON_MAINNET, "deadbeef") ===
    "https://tonviewer.com/transaction/deadbeef",
);
ok(
  "jetton URL → tonviewer.com/<master>",
  getTonJettonExplorerUrl(TON_MAINNET, usdtMaster) ===
    `https://tonviewer.com/${usdtMaster}`,
);

console.log("=== native asset rebrand: Toncoin/TON → Gram/GRAM ===");
ok("TON_NATIVE_SYMBOL is GRAM", TON_NATIVE_SYMBOL === "GRAM");
ok("TON_NATIVE_NAME is Gram", TON_NATIVE_NAME === "Gram");
ok("native token symbol is GRAM", TON_NATIVE_TOKEN.symbol === "GRAM");
ok("native token name is Gram", TON_NATIVE_TOKEN.name === "Gram");
ok("config native symbol is GRAM", TON_MAINNET.symbol === "GRAM");
ok("network name stays TON (not renamed)", TON_MAINNET.name === "TON");

ok(
  "legacy symbol TON renders as GRAM",
  displayTonNativeSymbol("TON") === "GRAM",
);
ok("current symbol GRAM stays GRAM", displayTonNativeSymbol("GRAM") === "GRAM");
ok(
  "other symbol (USDT) is left unchanged",
  displayTonNativeSymbol("USDT") === "USDT",
);
ok(
  "legacy name Toncoin renders as Gram",
  displayTonNativeName("Toncoin") === "Gram",
);
ok("other name left unchanged", displayTonNativeName("Tether USD") === "Tether USD");

console.log("=== legacy history-row rename (applyTonNativeRename) ===");
{
  const legacy = applyTonNativeRename({
    chainId: TON_MAINNET_CHAIN_ID,
    assetType: "native",
    assetSymbol: "TON",
    assetName: "Toncoin",
  });
  ok(
    "legacy native TON row → GRAM/Gram",
    legacy.assetSymbol === "GRAM" && legacy.assetName === "Gram",
  );

  const jetton = applyTonNativeRename({
    chainId: TON_MAINNET_CHAIN_ID,
    assetType: "jetton",
    assetSymbol: "USDT",
    assetName: "Tether USD",
  });
  ok(
    "TON jetton row is untouched",
    jetton.assetSymbol === "USDT" && jetton.assetName === "Tether USD",
  );

  const evm = applyTonNativeRename({
    chainId: 1,
    assetType: "native",
    assetSymbol: "TON",
    assetName: "Toncoin",
  });
  ok(
    "non-TON chain row is untouched (no accidental cross-chain rename)",
    evm.assetSymbol === "TON" && evm.assetName === "Toncoin",
  );
}

console.log("=== tonApiClient (Simpl gateway base + surface) ===");
ok(
  "TON_API_BASE_URL routes through the Simpl gateway /v1/ton",
  TON_API_BASE_URL === `${SIMPL_API_BASE_URL}/v1/ton`,
);
ok(
  "default Simpl base is api.getsimpl.io (no provider host)",
  SIMPL_API_BASE_URL === "https://api.getsimpl.io",
);
ok(
  "TON_API_BASE_URL never points at a direct provider",
  !/tonapi\.io|toncenter/.test(TON_API_BASE_URL),
);
for (const method of [
  "getAccount",
  "getWalletInfo",
  "getHistory",
  "getJettons",
  "sendBoc",
  "getTxStatus",
  "getSpot",
  "getPriceHistory",
]) {
  ok(
    `client exposes ${method}()`,
    typeof (tonApiClient as Record<string, unknown>)[method] === "function",
  );
}

console.log("=== mapTonAccountState (gateway state → wallet state) ===");
ok("active stays active", mapTonAccountState("active", 0n) === "active");
ok("frozen stays frozen", mapTonAccountState("frozen", 5n) === "frozen");
ok(
  "uninitialized + balance → uninit",
  mapTonAccountState("uninitialized", 10n) === "uninit",
);
ok(
  "uninit + zero balance → nonexist",
  mapTonAccountState("uninit", 0n) === "nonexist",
);
ok(
  "explicit nonexist stays nonexist",
  mapTonAccountState("nonexist", 0n) === "nonexist",
);
ok(
  "unknown state disambiguated by balance",
  mapTonAccountState(undefined, 7n) === "uninit" &&
    mapTonAccountState(undefined, 0n) === "nonexist",
);

console.log("=== mapTonTxStatus (safe-by-default tx status) ===");
ok(
  "null DTO → submitted (never a false failed)",
  mapTonTxStatus(null) === "submitted",
);
ok(
  "normalized status confirmed",
  mapTonTxStatus({ status: "confirmed" }) === "confirmed",
);
ok("normalized status failed", mapTonTxStatus({ status: "failed" }) === "failed");
ok(
  "pending → submitted",
  mapTonTxStatus({ status: "pending" }) === "submitted",
);
ok(
  "unknown → submitted",
  mapTonTxStatus({ status: "unknown" }) === "submitted",
);
ok(
  "success flag → confirmed",
  mapTonTxStatus({ success: true }) === "confirmed",
);
ok(
  "aborted flag → failed",
  mapTonTxStatus({ aborted: true }) === "failed",
);
ok(
  "empty DTO → submitted",
  mapTonTxStatus({}) === "submitted",
);

console.log(
  "=== ton price routing (TON proxy only — no generic gateway leak) ===",
);
{
  // Capture every fetch URL and serve canned TON-proxy responses so we can
  // assert exactly which endpoints the TON price paths hit — and which they
  // must never touch. The generic gateway routes are intentionally NOT served:
  // any TON call that reaches them would record a URL the assertions reject.
  const originalFetch = globalThis.fetch;
  const fetchCalls: string[] = [];
  const installStub = (handler: (url: string) => unknown): void => {
    globalThis.fetch = (async (input: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : (input as { url?: string })?.url ?? String(input);
      fetchCalls.push(url);
      const data = handler(url);
      return {
        ok: data != null,
        status: data != null ? 200 : 404,
        json: async () => data,
      } as Response;
    }) as typeof fetch;
  };

  installStub((url) => {
    if (url.includes("/v1/ton/prices/spot")) {
      return { prices: { usd: 5.5, eur: 5.0 } };
    }
    if (url.includes("/v1/ton/prices/history")) {
      // Proxy emits `timestamp` (not `t`) — exercise that mapping.
      return {
        points: [
          { timestamp: 1_700_000_000, price: 5.1 },
          { timestamp: 1_700_003_600, price: 5.2 },
        ],
      };
    }
    return null; // generic gateway routes deliberately unserved
  });

  try {
    // --- spot ---
    const spot = await getTonNativeSpot(TON_MAINNET, "usd");
    ok("TON native spot resolves price (5.5)", spot?.price === 5.5);
    ok(
      "TON native spot hits /v1/ton/prices/spot",
      fetchCalls.some((u) => u.includes("/v1/ton/prices/spot")),
    );

    // --- history ---
    const hist = await getTonNativeHistory(TON_MAINNET, "7d");
    ok(
      "TON native history hits /v1/ton/prices/history?period=7d",
      fetchCalls.some((u) => u.includes("/v1/ton/prices/history?period=7d")),
    );
    ok(
      "TON history points map to chart data ({timestamp,price} → {t,price})",
      Array.isArray(hist) &&
        hist.length === 2 &&
        hist[0].t === 1_700_000_000 &&
        hist[0].price === 5.1,
    );

    // --- market data (the path that used to leak the generic spot call) ---
    fetchCalls.length = 0;
    const market = await marketDataService.getAssetMarketData({
      chainId: TON_MAINNET_CHAIN_ID,
      address: null,
    });
    ok("TON native market data resolves price (5.5)", market?.priceUsd === 5.5);
    ok(
      "missing 24h volume does not fail market mapping (volume omitted)",
      market != null && market.volume24hUsd === undefined,
    );
    ok(
      "TON native market data routes via /v1/ton/prices/spot",
      fetchCalls.some((u) => u.includes("/v1/ton/prices/spot")),
    );
    ok(
      "TON native must NOT call generic /v1/prices/spot",
      !fetchCalls.some((u) => /\/v1\/prices\/spot/.test(u)),
    );
    ok(
      "TON native must NOT call generic /v1/prices/ohlc",
      !fetchCalls.some((u) => /\/v1\/prices\/ohlc/.test(u)),
    );
    ok(
      "TON native must NOT send ?chainId=ton to the generic gateway",
      !fetchCalls.some((u) => /chainId=ton/.test(u)),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("All TON checks passed.");
