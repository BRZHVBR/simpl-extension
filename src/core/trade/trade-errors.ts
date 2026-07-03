// src/core/trade/trade-errors.ts
//
// Unified swap/bridge error taxonomy. Raw provider errors are normalized into a
// stable TradeErrorCode with a safe, user-facing message and a retry strategy.
// Pure. NEVER include raw tx / signatures / private metadata / API keys in the
// normalized message or the sanitized technical string.

export type TradeErrorCode =
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_GAS"
  | "QUOTE_EXPIRED"
  | "ROUTE_UNAVAILABLE"
  | "SLIPPAGE_TOO_HIGH"
  | "PRICE_IMPACT_TOO_HIGH"
  | "ALLOWANCE_REQUIRED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_FAILED"
  | "SIMULATION_FAILED"
  | "SIMULATION_UNAVAILABLE"
  | "TX_REJECTED"
  | "TX_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_TOKEN"
  | "INVALID_DESTINATION_ADDRESS"
  | "BRIDGE_SOURCE_CONFIRMED_DESTINATION_PENDING"
  | "BRIDGE_STUCK"
  | "UNKNOWN_ERROR";

export type RetryStrategy = "refresh_quote" | "retry" | "retry_with_more_gas" | "wait" | "none";

export type NormalizedTradeError = {
  code: TradeErrorCode;
  message: string; // user-facing, safe
  retry: RetryStrategy;
  // Short, sanitized identifier for support/logs — never raw payload.
  technical: string;
};

const MESSAGES: Record<TradeErrorCode, { message: string; retry: RetryStrategy }> = {
  INSUFFICIENT_BALANCE: { message: "You don't have enough of this token.", retry: "none" },
  INSUFFICIENT_GAS: { message: "Not enough native balance to cover the network fee.", retry: "none" },
  QUOTE_EXPIRED: { message: "This quote expired. Refresh to get a new price.", retry: "refresh_quote" },
  ROUTE_UNAVAILABLE: { message: "No route is available for this pair right now.", retry: "refresh_quote" },
  SLIPPAGE_TOO_HIGH: { message: "Slippage is too high for a safe trade.", retry: "refresh_quote" },
  PRICE_IMPACT_TOO_HIGH: { message: "Price impact is too high for this trade size.", retry: "none" },
  ALLOWANCE_REQUIRED: { message: "Approve this token before swapping.", retry: "retry" },
  APPROVAL_REJECTED: { message: "You rejected the approval.", retry: "retry" },
  APPROVAL_FAILED: { message: "The approval transaction failed.", retry: "retry" },
  SIMULATION_FAILED: { message: "This transaction is likely to fail and was not sent.", retry: "refresh_quote" },
  SIMULATION_UNAVAILABLE: { message: "Could not simulate this transaction; proceed with caution.", retry: "retry" },
  TX_REJECTED: { message: "You rejected the transaction.", retry: "retry" },
  TX_FAILED: { message: "The transaction failed on-chain.", retry: "refresh_quote" },
  PROVIDER_RATE_LIMITED: { message: "The price provider is busy. Try again in a moment.", retry: "wait" },
  PROVIDER_UNAVAILABLE: { message: "The price provider is unavailable right now.", retry: "wait" },
  UNSUPPORTED_CHAIN: { message: "This network is not supported for trading.", retry: "none" },
  UNSUPPORTED_TOKEN: { message: "This token is not supported for trading.", retry: "none" },
  INVALID_DESTINATION_ADDRESS: { message: "The destination address is invalid.", retry: "none" },
  BRIDGE_SOURCE_CONFIRMED_DESTINATION_PENDING: {
    message: "Source transfer confirmed — waiting for the destination chain.",
    retry: "wait",
  },
  BRIDGE_STUCK: { message: "This bridge transfer is delayed. Check the status or contact support.", retry: "wait" },
  UNKNOWN_ERROR: { message: "Something went wrong. Please try again.", retry: "retry" },
};

// Map a raw provider/error value to a stable code. Only inspects short strings;
// never surfaces the raw payload to the user.
export function classifyTradeError(raw: unknown): TradeErrorCode {
  const text = (raw instanceof Error ? raw.message : String(raw ?? "")).toLowerCase();

  if (/insufficient funds|insufficient balance|not enough .*balance/.test(text)) return "INSUFFICIENT_BALANCE";
  if (/insufficient .*(gas|native)|not enough (sol|eth|bnb|trx) for (the )?fee|out of gas/.test(text)) return "INSUFFICIENT_GAS";
  if (/quote.*expire|expired quote|price.*expired/.test(text)) return "QUOTE_EXPIRED";
  if (/blockhash.*(expired|not found)|transaction expired/.test(text)) return "QUOTE_EXPIRED";
  if (/no route|route not found|no liquidity|cannot find|no quote/.test(text)) return "ROUTE_UNAVAILABLE";
  if (/slippage/.test(text)) return "SLIPPAGE_TOO_HIGH";
  if (/price impact/.test(text)) return "PRICE_IMPACT_TOO_HIGH";
  if (/allowance|approve .*token|not approved/.test(text)) return "ALLOWANCE_REQUIRED";
  if (/user rejected|user denied|rejected the request|4001/.test(text)) return "TX_REJECTED";
  if (/simulat.*fail|would fail|execution reverted/.test(text)) return "SIMULATION_FAILED";
  if (/simulat.*unavailable|cannot simulate/.test(text)) return "SIMULATION_UNAVAILABLE";
  if (/rate limit|429|too many requests/.test(text)) return "PROVIDER_RATE_LIMITED";
  if (/unavailable|503|502|gateway|network error|failed to fetch/.test(text)) return "PROVIDER_UNAVAILABLE";
  if (/unsupported chain|chain not supported/.test(text)) return "UNSUPPORTED_CHAIN";
  if (/unsupported token|token not supported/.test(text)) return "UNSUPPORTED_TOKEN";
  if (/invalid .*(destination|recipient) address|bad address/.test(text)) return "INVALID_DESTINATION_ADDRESS";
  if (/reverted|transaction failed|tx failed/.test(text)) return "TX_FAILED";
  return "UNKNOWN_ERROR";
}

export function normalizeTradeError(raw: unknown, code?: TradeErrorCode): NormalizedTradeError {
  const resolved = code ?? classifyTradeError(raw);
  const { message, retry } = MESSAGES[resolved];
  return { code: resolved, message, retry, technical: resolved };
}
