# Trade Error Taxonomy

Raw swap/bridge provider errors are normalized into a stable `TradeErrorCode`
with a safe user message and a retry strategy. Source of truth (code):
`src/core/trade/trade-errors.ts`. Normalized output **never** contains raw tx,
signatures, private metadata or API keys.

## Codes → message → retry

| Code | User message | Retry |
| --- | --- | --- |
| `INSUFFICIENT_BALANCE` | Not enough of this token | none |
| `INSUFFICIENT_GAS` | Not enough native balance for the network fee | none |
| `QUOTE_EXPIRED` | Quote expired — refresh | refresh_quote |
| `ROUTE_UNAVAILABLE` | No route for this pair right now | refresh_quote |
| `SLIPPAGE_TOO_HIGH` | Slippage too high for a safe trade | refresh_quote |
| `PRICE_IMPACT_TOO_HIGH` | Price impact too high | none |
| `ALLOWANCE_REQUIRED` | Approve this token first | retry |
| `APPROVAL_REJECTED` | You rejected the approval | retry |
| `APPROVAL_FAILED` | Approval transaction failed | retry |
| `SIMULATION_FAILED` | Likely to fail — not sent | refresh_quote |
| `SIMULATION_UNAVAILABLE` | Couldn't simulate; proceed with caution | retry |
| `TX_REJECTED` | You rejected the transaction | retry |
| `TX_FAILED` | Transaction failed on-chain | refresh_quote |
| `PROVIDER_RATE_LIMITED` | Provider busy; try again shortly | wait |
| `PROVIDER_UNAVAILABLE` | Provider unavailable right now | wait |
| `UNSUPPORTED_CHAIN` | Network not supported for trading | none |
| `UNSUPPORTED_TOKEN` | Token not supported for trading | none |
| `INVALID_DESTINATION_ADDRESS` | Destination address invalid | none |
| `BRIDGE_SOURCE_CONFIRMED_DESTINATION_PENDING` | Source confirmed — waiting for destination | wait |
| `BRIDGE_STUCK` | Transfer delayed — check status/support | wait |
| `UNKNOWN_ERROR` | Something went wrong; try again | retry |

## Provider mapping examples

- 0x/EVM: `insufficient funds` → `INSUFFICIENT_BALANCE`; `execution reverted` →
  `SIMULATION_FAILED` / `TX_FAILED`; `user rejected` → `TX_REJECTED`.
- Jupiter/Solana: `Blockhash not found` / `transaction expired` → `QUOTE_EXPIRED`;
  `not enough SOL for the fee` → `INSUFFICIENT_GAS`.
- LI.FI/bridge: `no route` → `ROUTE_UNAVAILABLE`; invalid recipient →
  `INVALID_DESTINATION_ADDRESS`; source-confirmed-destination-pending / stuck →
  the two `BRIDGE_*` codes.
- HTTP: `429` → `PROVIDER_RATE_LIMITED`; `502/503`/network → `PROVIDER_UNAVAILABLE`.

## Guarantees

- `classifyTradeError` inspects only short error text; it never surfaces the raw
  payload to the user.
- `normalizeTradeError().technical` is the stable code (safe for logs/support).
- Verified by `check:trade`: a raw `"execution reverted: 0xdeadbeef …"` yields a
  normalized message/technical that contains none of the raw payload.
