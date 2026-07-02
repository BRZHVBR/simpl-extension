// src/core/bridge/evm-bridge.service.ts
//
// EVM-source bridge transaction PREFLIGHT + failure classification. LI.FI returns
// a ready-to-send EVM transactionRequest for an executable route; the wallet signs
// + broadcasts it through the normal send path. The problem this module fixes:
// when that tx would revert (most commonly because an ERC-20 allowance is missing
// for the bridge spender), ethers' estimateGas throws a raw, opaque error that the
// UI flattened to "simulation failed / unknown". Here we simulate FIRST (eth_call
// + estimateGas) and classify the failure into a precise, display-safe code so the
// flow can show "Approve USDT", "Not enough BNB for network fees", etc. — never a
// generic "unknown".
//
// Read-only: this module only does public JSON-RPC reads over the registry RPC
// (eth_call / eth_estimateGas / eth_getBalance / eth_gasPrice + ERC-20
// allowance/balance). It NEVER signs, never touches key material, and never logs
// a private key or a raw signed transaction. [bridge:evm] diagnostics log only
// safe metadata (addresses are public; amounts/gas are not secrets).

import { getChainById } from "../networks/chain-registry";
import {
  readErc20Allowance,
  readErc20Balance,
  readNativeBalance,
} from "../balances/chain-balance.service";
import { isBridgeDebugEnabled } from "../../chains/solana/solana.bridge";

// ── Diagnostics ──────────────────────────────────────────────────────────────

function log(event: string, data: Record<string, unknown>): void {
  if (!isBridgeDebugEnabled()) return;
  // eslint-disable-next-line no-console
  console.info(`[bridge:evm] ${event}`, data);
}

// ── Coded errors ─────────────────────────────────────────────────────────────

export type EvmBridgeErrorCode =
  | "EVM_ALLOWANCE_REQUIRED"
  | "EVM_INSUFFICIENT_TOKEN_BALANCE"
  | "EVM_INSUFFICIENT_NATIVE_GAS"
  | "EVM_CHAIN_MISMATCH"
  | "EVM_REVERT"
  | "EVM_RPC_UNAVAILABLE"
  | "EVM_UNKNOWN_SIMULATION_FAILED";

export class EvmBridgeError extends Error {
  readonly code: EvmBridgeErrorCode;
  // Decoded Solidity revert string (Error(string)), when one was present.
  readonly revertReason: string | null;
  constructor(
    code: EvmBridgeErrorCode,
    message: string,
    revertReason: string | null = null,
  ) {
    super(message);
    this.name = "EvmBridgeError";
    this.code = code;
    this.revertReason = revertReason;
  }
}

// ── JSON-RPC ─────────────────────────────────────────────────────────────────

type RpcError = { code?: number; message?: string; data?: unknown };
type RpcResponse = { result?: unknown; error?: RpcError };

// POST a JSON-RPC call to the chain's registry RPC. Throws an EVM_RPC_UNAVAILABLE
// EvmBridgeError on a transport failure (so callers never confuse "RPC down" with
// "tx reverted"). A protocol-level { error } is returned in the payload, NOT
// thrown — the caller classifies it.
async function jsonRpc(
  chainId: number,
  method: string,
  params: unknown[],
): Promise<RpcResponse> {
  const chain = getChainById(chainId);
  if (!chain) {
    throw new EvmBridgeError("EVM_RPC_UNAVAILABLE", "Unknown source chain.");
  }
  let response: Response;
  try {
    response = await fetch(chain.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch {
    throw new EvmBridgeError(
      "EVM_RPC_UNAVAILABLE",
      `${chain.nativeCurrency.symbol} RPC is temporarily unavailable.`,
    );
  }
  if (!response.ok) {
    throw new EvmBridgeError(
      "EVM_RPC_UNAVAILABLE",
      `${chain.nativeCurrency.symbol} RPC is temporarily unavailable.`,
    );
  }
  try {
    return (await response.json()) as RpcResponse;
  } catch {
    throw new EvmBridgeError(
      "EVM_RPC_UNAVAILABLE",
      `${chain.nativeCurrency.symbol} RPC returned an invalid response.`,
    );
  }
}

// ── Hex helpers ──────────────────────────────────────────────────────────────

function toHexQuantity(value: string | null | undefined): string {
  if (!value || value === "0x" ) return "0x0";
  try {
    return `0x${BigInt(value).toString(16)}`;
  } catch {
    return "0x0";
  }
}

function hexToBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || value === "" || value === "0x") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

// Decode a Solidity `Error(string)` revert payload (selector 0x08c379a0) into its
// human reason. Returns null for empty/Panic/unknown payloads. Never throws.
function decodeRevertReason(data: unknown): string | null {
  if (typeof data !== "string") return null;
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  // 0x08c379a0 selector + offset(32) + length(32) + string bytes.
  if (hex.length < 8 + 64 + 64 || hex.slice(0, 8).toLowerCase() !== "08c379a0") {
    return null;
  }
  try {
    const lenHex = hex.slice(8 + 64, 8 + 128);
    const len = Number(BigInt(`0x${lenHex}`));
    if (!Number.isFinite(len) || len <= 0 || len > 1024) return null;
    const strHex = hex.slice(8 + 128, 8 + 128 + len * 2);
    let out = "";
    for (let i = 0; i < strHex.length; i += 2) {
      const code = parseInt(strHex.slice(i, i + 2), 16);
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out.trim() || null;
  } catch {
    return null;
  }
}

// Best-effort one-line summary of an RPC error message/data — capped, never the
// full payload. Used only for classification + safe debug storage.
function rpcErrorText(error: RpcError | null | undefined): string {
  if (!error) return "";
  const parts: string[] = [];
  if (typeof error.message === "string") parts.push(error.message);
  if (typeof error.data === "string") parts.push(error.data);
  else if (error.data && typeof error.data === "object") {
    const inner = (error.data as { message?: unknown }).message;
    if (typeof inner === "string") parts.push(inner);
  }
  return parts.join(" ").slice(0, 300);
}

// Classify a reverted eth_call / estimateGas RPC error into a precise code. Order
// matters: the most specific allowance/balance/gas signals win before the generic
// revert. The revert reason (when decodable) refines balance vs allowance.
export function classifyEvmSimulationError(
  error: RpcError | null | undefined,
): { code: EvmBridgeErrorCode; revertReason: string | null } {
  const revertReason =
    decodeRevertReason((error?.data as { data?: unknown })?.data) ??
    decodeRevertReason(error?.data);
  const blob = `${rpcErrorText(error)} ${revertReason ?? ""}`.toLowerCase();

  if (
    blob.includes("transfer amount exceeds allowance") ||
    blob.includes("insufficient allowance") ||
    blob.includes("allowance")
  ) {
    return { code: "EVM_ALLOWANCE_REQUIRED", revertReason };
  }
  if (
    blob.includes("transfer amount exceeds balance") ||
    blob.includes("transfer exceeds balance") ||
    blob.includes("exceeds balance")
  ) {
    return { code: "EVM_INSUFFICIENT_TOKEN_BALANCE", revertReason };
  }
  if (
    blob.includes("insufficient funds") ||
    blob.includes("insufficient funds for gas") ||
    blob.includes("gas required exceeds") ||
    blob.includes("max fee per gas less than") ||
    blob.includes("out of gas")
  ) {
    return { code: "EVM_INSUFFICIENT_NATIVE_GAS", revertReason };
  }
  if (
    blob.includes("execution reverted") ||
    blob.includes("reverted") ||
    revertReason != null
  ) {
    return { code: "EVM_REVERT", revertReason };
  }
  if (
    blob.includes("timeout") ||
    blob.includes("rate limit") ||
    blob.includes("429") ||
    blob.includes("503") ||
    blob.includes("502")
  ) {
    return { code: "EVM_RPC_UNAVAILABLE", revertReason };
  }
  return { code: "EVM_UNKNOWN_SIMULATION_FAILED", revertReason };
}

// ── Preflight ────────────────────────────────────────────────────────────────

export type EvmBridgePreflightParams = {
  // The route's SOURCE chain (the chain we sign + send on).
  fromChainId: number;
  // The transactionRequest's own chainId, for the chain guard (may be null).
  txChainId: number | null;
  fromAddress: string;
  to: string;
  data: string;
  // Native value the tx sends, in wei (decimal or hex string; "0" for ERC-20).
  value: string;
  // ERC-20 source token contract, or null for a native-asset source.
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  // Source amount in base units (for balance + allowance comparison).
  fromAmountBaseUnits: string;
  // The bridge spender to approve (LI.FI approvalAddress), or null when unknown /
  // native source.
  spender: string | null;
  nativeSymbol: string;
  // Bridge/provider name, for diagnostics only.
  tool: string | null;
  // Optional gas hints carried on the route (logged; estimateGas is authoritative).
  gasLimit?: string | null;
  gasPrice?: string | null;
  maxFeePerGas?: string | null;
  maxPriorityFeePerGas?: string | null;
};

export type EvmBridgePreflightResult = {
  ok: true;
  // Estimated gas limit (decimal string) when estimateGas succeeded, else null.
  gasLimit: string | null;
};

// Safe, copyable snapshot of the last preflight — for copyLastEvmBridgeDebug().
type EvmBridgeDebug = {
  chainId: number;
  txChainId: number | null;
  tool: string | null;
  tokenAddress: string | null;
  tokenSymbol: string;
  tokenDecimals: number;
  owner: string;
  spender: string | null;
  to: string;
  value: string;
  hasData: boolean;
  dataLength: number;
  fromAmountBaseUnits: string;
  allowance: string | null;
  tokenBalance: string | null;
  nativeGasBalance: string | null;
  ethCall: "ok" | string;
  estimateGas: string | "error";
  classification: EvmBridgeErrorCode | null;
  revertReason: string | null;
  txHash: string | null;
};
let lastEvmBridgeDebug: EvmBridgeDebug | null = null;

// Record the broadcast tx hash on the latest debug snapshot (called after send).
export function recordEvmBridgeTxHash(hash: string): void {
  if (lastEvmBridgeDebug) lastEvmBridgeDebug.txHash = hash;
}

// Dev helper: print (and best-effort clipboard-copy) the latest EVM bridge
// preflight — chain/token/owner/spender, allowance, balances, eth_call &
// estimateGas outcomes, classification and the broadcast hash. Never a key, seed
// or signed tx. Attached to globalThis when bridge diagnostics are enabled.
export function copyLastEvmBridgeDebug(): EvmBridgeDebug | null {
  // eslint-disable-next-line no-console
  console.info("[bridge:evm] preflight-debug (latest)", lastEvmBridgeDebug);
  try {
    const text = JSON.stringify(lastEvmBridgeDebug ?? {}, null, 2);
    (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => unknown } } })
      .navigator?.clipboard?.writeText?.(text);
  } catch {
    // Clipboard is best-effort and never required.
  }
  return lastEvmBridgeDebug;
}

if (isBridgeDebugEnabled()) {
  (globalThis as Record<string, unknown>).copyLastEvmBridgeDebug =
    copyLastEvmBridgeDebug;
}

// Simulate an EVM-source bridge transaction and classify any failure. Throws a
// coded EvmBridgeError on a problem (allowance / token balance / native gas /
// chain mismatch / revert / RPC); resolves { ok, gasLimit } when it is safe to
// broadcast. The allowance + token-balance checks run BEFORE simulation so the UI
// can show "Approve" without waiting on a revert.
export async function preflightEvmBridgeTransaction(
  params: EvmBridgePreflightParams,
): Promise<EvmBridgePreflightResult> {
  const isErc20 = params.tokenAddress != null;
  let fromAmount: bigint;
  try {
    fromAmount = BigInt(params.fromAmountBaseUnits);
  } catch {
    fromAmount = 0n;
  }

  // 1) Chain guard — never simulate/send a route tx on a different chain than its
  // source; the calldata is only valid on the chain it was built for.
  if (params.txChainId != null && params.txChainId !== params.fromChainId) {
    lastEvmBridgeDebug = {
      chainId: params.fromChainId,
      txChainId: params.txChainId,
      tool: params.tool,
      tokenAddress: params.tokenAddress,
      tokenSymbol: params.tokenSymbol,
      tokenDecimals: params.tokenDecimals,
      owner: params.fromAddress,
      spender: params.spender,
      to: params.to,
      value: params.value,
      hasData: Boolean(params.data && params.data !== "0x"),
      dataLength: params.data ? params.data.length : 0,
      fromAmountBaseUnits: params.fromAmountBaseUnits,
      allowance: null,
      tokenBalance: null,
      nativeGasBalance: null,
      ethCall: "skipped (chain mismatch)",
      estimateGas: "error",
      classification: "EVM_CHAIN_MISMATCH",
      revertReason: null,
      txHash: null,
    };
    throw new EvmBridgeError(
      "EVM_CHAIN_MISMATCH",
      "Bridge transaction is for a different chain.",
    );
  }

  // 2) Read public state: native (gas) balance, token balance + allowance.
  const [nativeBalance, tokenBalance, allowance] = await Promise.all([
    readNativeBalance({ chainId: params.fromChainId, owner: params.fromAddress }),
    isErc20 && params.tokenAddress
      ? readErc20Balance({
          chainId: params.fromChainId,
          tokenAddress: params.tokenAddress,
          owner: params.fromAddress,
        })
      : Promise.resolve(null),
    isErc20 && params.tokenAddress && params.spender
      ? readErc20Allowance({
          chainId: params.fromChainId,
          tokenAddress: params.tokenAddress,
          owner: params.fromAddress,
          spender: params.spender,
        })
      : Promise.resolve(null),
  ]);

  // 3) Diagnostics — safe metadata only (no key, no signed tx).
  log("preflight", {
    fromChainId: params.fromChainId,
    txChainId: params.txChainId,
    tool: params.tool,
    sourceTokenSymbol: params.tokenSymbol,
    sourceTokenAddress: params.tokenAddress,
    sourceTokenDecimals: params.tokenDecimals,
    fromAmountBaseUnits: params.fromAmountBaseUnits,
    owner: params.fromAddress,
    spender: params.spender,
    to: params.to,
    value: params.value,
    hasData: Boolean(params.data && params.data !== "0x"),
    dataLength: params.data ? params.data.length : 0,
    gasLimit: params.gasLimit ?? null,
    gasPrice: params.gasPrice ?? null,
    maxFeePerGas: params.maxFeePerGas ?? null,
    maxPriorityFeePerGas: params.maxPriorityFeePerGas ?? null,
    nativeGasBalance: nativeBalance?.toString() ?? null,
    tokenBalance: tokenBalance?.toString() ?? null,
    allowance: allowance?.toString() ?? null,
  });

  const debug: EvmBridgeDebug = {
    chainId: params.fromChainId,
    txChainId: params.txChainId,
    tool: params.tool,
    tokenAddress: params.tokenAddress,
    tokenSymbol: params.tokenSymbol,
    tokenDecimals: params.tokenDecimals,
    owner: params.fromAddress,
    spender: params.spender,
    to: params.to,
    value: params.value,
    hasData: Boolean(params.data && params.data !== "0x"),
    dataLength: params.data ? params.data.length : 0,
    fromAmountBaseUnits: params.fromAmountBaseUnits,
    allowance: allowance?.toString() ?? null,
    tokenBalance: tokenBalance?.toString() ?? null,
    nativeGasBalance: nativeBalance?.toString() ?? null,
    ethCall: "ok",
    estimateGas: "error",
    classification: null,
    revertReason: null,
    txHash: null,
  };
  lastEvmBridgeDebug = debug;

  // 4) Token-balance shortfall (only when we actually read a balance).
  if (isErc20 && tokenBalance != null && tokenBalance < fromAmount) {
    debug.classification = "EVM_INSUFFICIENT_TOKEN_BALANCE";
    log("preflight-classified", { code: debug.classification });
    throw new EvmBridgeError(
      "EVM_INSUFFICIENT_TOKEN_BALANCE",
      `Not enough ${params.tokenSymbol} balance.`,
    );
  }

  // 5) Allowance shortfall — surfaced BEFORE simulation so the UI shows Approve.
  if (
    isErc20 &&
    params.spender &&
    allowance != null &&
    allowance < fromAmount
  ) {
    debug.classification = "EVM_ALLOWANCE_REQUIRED";
    log("preflight-classified", { code: debug.classification, allowance: allowance.toString() });
    throw new EvmBridgeError(
      "EVM_ALLOWANCE_REQUIRED",
      `${params.tokenSymbol} approval required.`,
    );
  }

  // 6) eth_call (no state change) — catches reverts the allowance read missed
  // (e.g. spender unknown, Permit2, a bridge precondition).
  const callTx = {
    from: params.fromAddress,
    to: params.to,
    data: params.data || "0x",
    value: toHexQuantity(params.value),
  };
  const callRes = await jsonRpc(params.fromChainId, "eth_call", [callTx, "latest"]);
  if (callRes.error) {
    const { code, revertReason } = classifyEvmSimulationError(callRes.error);
    debug.ethCall = rpcErrorText(callRes.error) || "reverted";
    debug.classification = code;
    debug.revertReason = revertReason;
    log("preflight-classified", { phase: "eth_call", code, revertReason });
    throw new EvmBridgeError(code, messageForCode(code, params), revertReason);
  }

  // 7) estimateGas — authoritative gas + a second revert check.
  const gasRes = await jsonRpc(params.fromChainId, "eth_estimateGas", [callTx]);
  if (gasRes.error) {
    const { code, revertReason } = classifyEvmSimulationError(gasRes.error);
    debug.estimateGas = "error";
    debug.classification = code;
    debug.revertReason = revertReason;
    log("preflight-classified", { phase: "estimateGas", code, revertReason });
    throw new EvmBridgeError(code, messageForCode(code, params), revertReason);
  }
  const gasLimit = hexToBigInt(gasRes.result);
  debug.estimateGas = gasLimit?.toString() ?? "ok";

  // 8) Native-gas affordability (only when we read a native balance + gas price).
  if (nativeBalance != null && gasLimit != null) {
    const gasPriceRes = await jsonRpc(params.fromChainId, "eth_gasPrice", []);
    const gasPrice = hexToBigInt(gasPriceRes.result);
    if (gasPrice != null) {
      let value: bigint;
      try {
        value = BigInt(toHexQuantity(params.value));
      } catch {
        value = 0n;
      }
      // 20% gas headroom so a small price bump at send time doesn't strand the tx.
      const estimatedFee = (gasLimit * gasPrice * 12n) / 10n;
      if (nativeBalance < value + estimatedFee) {
        debug.classification = "EVM_INSUFFICIENT_NATIVE_GAS";
        log("preflight-classified", { code: debug.classification });
        throw new EvmBridgeError(
          "EVM_INSUFFICIENT_NATIVE_GAS",
          `Not enough ${params.nativeSymbol} for network fees.`,
        );
      }
    }
  }

  log("preflight-ok", { gasLimit: gasLimit?.toString() ?? null });
  return { ok: true, gasLimit: gasLimit?.toString() ?? null };
}

// Curated, display-safe message per code, parameterized by token/native symbol.
function messageForCode(
  code: EvmBridgeErrorCode,
  params: EvmBridgePreflightParams,
): string {
  switch (code) {
    case "EVM_ALLOWANCE_REQUIRED":
      return `${params.tokenSymbol} approval required.`;
    case "EVM_INSUFFICIENT_TOKEN_BALANCE":
      return `Not enough ${params.tokenSymbol} balance.`;
    case "EVM_INSUFFICIENT_NATIVE_GAS":
      return `Not enough ${params.nativeSymbol} for network fees.`;
    case "EVM_CHAIN_MISMATCH":
      return "Bridge transaction is for a different chain.";
    case "EVM_REVERT":
      return "Bridge transaction reverted during simulation.";
    case "EVM_RPC_UNAVAILABLE":
      return `${params.nativeSymbol} RPC is temporarily unavailable.`;
    default:
      return "Bridge transaction simulation failed.";
  }
}

// approve(address spender, uint256 amount) calldata.
export function encodeErc20ApproveData(
  spender: string,
  amountBaseUnits: string,
): string {
  const selector = "095ea7b3";
  const addr = spender.toLowerCase().replace(/^0x/u, "").padStart(64, "0");
  const amt = BigInt(amountBaseUnits).toString(16).padStart(64, "0");
  return `0x${selector}${addr}${amt}`;
}
