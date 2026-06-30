// src/core/ton/tonApiClient.ts
//
// Centralized HTTP client for ALL TON network traffic. Every TON read/write in
// the extension goes through the Simpl API TON gateway
// (`${VITE_SIMPL_API_BASE_URL}/v1/ton/*`) — never to any upstream data provider
// directly. The upstream secrets live only in the getsimpl-api Worker; nothing
// sensitive ships in this client bundle.
//
// SECURITY: this client only ever sends PUBLIC data — a public address, a tx
// hash, price period/currency params, or an already-signed BOC. It never sees a
// mnemonic, seed, private key or key pair; signing stays in the chain layer.
//
// Routes (all under /v1/ton):
//   GET  /account?address=
//   GET  /history?address=&limit=
//   GET  /jettons?address=
//   POST /send-boc            { boc }
//   GET  /tx/status?account=&hash=
//   GET  /prices/spot?vs=usd,eur            (kept; gateway market-data route)
//   GET  /prices/history?period=&vs=usd     (kept; gateway market-data route)

import { tonApiUrl, type TonChainConfig } from "../../chains/ton/ton.config";
import {
  normalizeTonError,
  tonErrorFor,
  type TonErrorCode,
} from "../../chains/ton/ton.errors";

// --- Normalized gateway DTOs (only the fields we read) -------------------
//
// The gateway returns provider-independent shapes. We still accept a few field
// aliases so a minor backend shape difference degrades gracefully rather than
// breaking a screen.

export type TonAccountDto = {
  state?: string;
  balanceNano?: string | number;
  seqno?: number;
  isActive?: boolean;
};

export type TonHistoryEventDto = {
  hash?: string;
  txHash?: string;
  direction?: string;
  amountNano?: string | number;
  amount?: string | number;
  from?: string;
  to?: string;
  fromAddress?: string;
  toAddress?: string;
  status?: string;
  success?: boolean;
  // Unix seconds.
  timestamp?: number;
  utime?: number;
  time?: number;
  isJetton?: boolean;
  jettonMaster?: string;
};

export type TonHistoryDto = {
  items?: TonHistoryEventDto[];
  events?: TonHistoryEventDto[];
  transactions?: TonHistoryEventDto[];
};

export type TonJettonDto = {
  master?: string;
  address?: string;
  balance?: string;
  rawBalance?: string;
  usdPrice?: number;
  price?: number;
};

export type TonJettonsDto = {
  jettons?: TonJettonDto[];
  balances?: TonJettonDto[];
};

export type TonSendBocResultDto = {
  ok?: boolean;
  error?: string;
  hash?: string;
};

export type TonTxStatusDto = {
  status?: string;
  success?: boolean;
  aborted?: boolean;
};

export type TonSpotDto = {
  prices?: Record<string, number | undefined>;
};

export type TonPriceHistoryDto = {
  // Each point is { t | timestamp, price } or a [time, price] tuple. The proxy
  // currently emits `timestamp`; `t` is accepted for forward/backward compat.
  points?: Array<
    { t?: number; timestamp?: number; price?: number } | [number, number]
  >;
};

// --- Low-level fetch helpers --------------------------------------------

// Map a non-OK HTTP response to a coded TonError. 429 / 5xx → the network is
// unavailable (retryable); anything else → the caller's domain fail code.
function statusError(status: number, failCode: TonErrorCode): never {
  throw tonErrorFor(
    status === 429 || status >= 500 ? "TON_PROVIDER_UNAVAILABLE" : failCode,
    `TON gateway responded ${status}.`,
  );
}

// GET/POST that THROWS a coded TonError on transport failure or a non-OK
// response. Used by the balance/jetton/history/send paths where the caller wants
// a clean, classified error to surface (or to swallow into a degraded state).
async function requestJson<T>(
  config: TonChainConfig,
  path: string,
  failCode: TonErrorCode,
  init?: RequestInit,
): Promise<T> {
  const url = tonApiUrl(config, path);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { Accept: "application/json", ...init?.headers },
    });
  } catch (error) {
    throw normalizeTonError(error, failCode);
  }

  if (!response.ok) {
    statusError(response.status, failCode);
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeTonError(error, failCode);
  }
}

// GET that NEVER throws: returns null on any transport/HTTP/parse failure. Used
// by the price + tx-status paths, which degrade cleanly ("No price" / treat an
// unresolved tx as still pending) instead of surfacing an error.
async function tryRequestJson<T>(
  config: TonChainConfig,
  path: string,
): Promise<T | null> {
  const url = tonApiUrl(config, path);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// --- Public client surface ----------------------------------------------

export const tonApiClient = {
  // Account state + native balance + seqno. Throws TON_BALANCE_FETCH_FAILED /
  // TON_PROVIDER_UNAVAILABLE on failure.
  getAccount(
    config: TonChainConfig,
    address: string,
  ): Promise<TonAccountDto> {
    return requestJson<TonAccountDto>(
      config,
      `/account?address=${encodeURIComponent(address)}`,
      "TON_BALANCE_FETCH_FAILED",
    );
  },

  // Wallet state for the send pre-flight (same endpoint as getAccount, but the
  // failure is classified as a seqno-read error for the send UX).
  getWalletInfo(
    config: TonChainConfig,
    address: string,
  ): Promise<TonAccountDto> {
    return requestJson<TonAccountDto>(
      config,
      `/account?address=${encodeURIComponent(address)}`,
      "TON_SEQNO_FETCH_FAILED",
    );
  },

  // Recent on-chain activity for an address. Throws TON_HISTORY_FETCH_FAILED /
  // TON_PROVIDER_UNAVAILABLE on failure (callers swallow to local-only history).
  getHistory(
    config: TonChainConfig,
    address: string,
    limit: number,
  ): Promise<TonHistoryDto> {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 15;
    return requestJson<TonHistoryDto>(
      config,
      `/history?address=${encodeURIComponent(address)}&limit=${safeLimit}`,
      "TON_HISTORY_FETCH_FAILED",
    );
  },

  // Jetton balances (gateway trust-filters; the chain layer re-verifies).
  // Throws TON_JETTON_FETCH_FAILED / TON_PROVIDER_UNAVAILABLE on failure.
  getJettons(
    config: TonChainConfig,
    address: string,
  ): Promise<TonJettonsDto> {
    return requestJson<TonJettonsDto>(
      config,
      `/jettons?address=${encodeURIComponent(address)}`,
      "TON_JETTON_FETCH_FAILED",
    );
  },

  // Broadcast an already-signed external-message BOC. The gateway receives ONLY
  // the signed BOC — never any secret material. Throws TON_BROADCAST_FAILED /
  // TON_PROVIDER_UNAVAILABLE on failure.
  sendBoc(
    config: TonChainConfig,
    boc: string,
  ): Promise<TonSendBocResultDto> {
    return requestJson<TonSendBocResultDto>(
      config,
      `/send-boc`,
      "TON_BROADCAST_FAILED",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boc }),
      },
    );
  },

  // Confirmation status for a sent message. Returns null when the status can't
  // be resolved (404 / transient) so the caller treats it as still pending —
  // never a false "failed".
  getTxStatus(
    config: TonChainConfig,
    account: string,
    hash: string,
  ): Promise<TonTxStatusDto | null> {
    if (!account || !hash) return Promise.resolve(null);
    return tryRequestJson<TonTxStatusDto>(
      config,
      `/tx/status?account=${encodeURIComponent(account)}&hash=${encodeURIComponent(hash)}`,
    );
  },

  // Native Toncoin spot prices (usd + eur). Returns null on failure.
  getSpot(config: TonChainConfig): Promise<TonSpotDto | null> {
    return tryRequestJson<TonSpotDto>(config, `/prices/spot?vs=usd,eur`);
  },

  // Native Toncoin price history for a UI period. Returns null on failure.
  getPriceHistory(
    config: TonChainConfig,
    period: "1d" | "7d" | "1m",
  ): Promise<TonPriceHistoryDto | null> {
    return tryRequestJson<TonPriceHistoryDto>(
      config,
      `/prices/history?period=${period}&vs=usd`,
    );
  },
};
