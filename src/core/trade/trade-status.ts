// src/core/trade/trade-status.ts
//
// Canonical swap/bridge lifecycle statuses + their user-facing copy, technical
// code, whether a retry is offered, and the safe next step. The UI maps a flow's
// state to one of these instead of showing raw provider states. Pure.

export type TradeStatus =
  | "quote_loading"
  | "quote_ready"
  | "quote_expired"
  | "simulation_unavailable"
  | "simulation_failed"
  | "approval_required"
  | "approval_pending"
  | "approval_failed"
  | "confirm_ready"
  | "transaction_pending"
  | "transaction_submitted"
  | "transaction_confirmed"
  | "transaction_failed"
  | "bridge_waiting_source"
  | "bridge_waiting_destination"
  | "bridge_refund_required"
  | "bridge_stuck"
  | "route_unavailable";

export type TradeStatusInfo = {
  status: TradeStatus;
  message: string;
  canRetry: boolean;
  // Terminal (success/failure) states end the flow; non-terminal expect progress.
  terminal: boolean;
};

export const TRADE_STATUS_INFO: Record<TradeStatus, Omit<TradeStatusInfo, "status">> = {
  quote_loading: { message: "Fetching the best price…", canRetry: false, terminal: false },
  quote_ready: { message: "Quote ready. Review before you confirm.", canRetry: false, terminal: false },
  quote_expired: { message: "Quote expired — refresh for a new price.", canRetry: true, terminal: false },
  simulation_unavailable: { message: "Couldn't simulate this trade; proceed with caution.", canRetry: true, terminal: false },
  simulation_failed: { message: "This trade is likely to fail and was not sent.", canRetry: true, terminal: false },
  approval_required: { message: "Approve this token to continue.", canRetry: false, terminal: false },
  approval_pending: { message: "Waiting for the approval to confirm…", canRetry: false, terminal: false },
  approval_failed: { message: "The approval failed. Try again.", canRetry: true, terminal: false },
  confirm_ready: { message: "Ready to confirm.", canRetry: false, terminal: false },
  transaction_pending: { message: "Confirm in your wallet…", canRetry: false, terminal: false },
  transaction_submitted: { message: "Submitted — waiting for confirmation…", canRetry: false, terminal: false },
  transaction_confirmed: { message: "Trade confirmed.", canRetry: false, terminal: true },
  transaction_failed: { message: "The transaction failed.", canRetry: true, terminal: true },
  bridge_waiting_source: { message: "Waiting for the source transaction…", canRetry: false, terminal: false },
  bridge_waiting_destination: { message: "Source confirmed — waiting for the destination chain…", canRetry: false, terminal: false },
  bridge_refund_required: { message: "The bridge could not complete; a refund is required.", canRetry: false, terminal: true },
  bridge_stuck: { message: "This transfer is delayed. Check status or contact support.", canRetry: true, terminal: false },
  route_unavailable: { message: "No route is available right now.", canRetry: true, terminal: false },
};

export function getTradeStatusInfo(status: TradeStatus): TradeStatusInfo {
  return { status, ...TRADE_STATUS_INFO[status] };
}
