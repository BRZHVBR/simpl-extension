// src/chains/solana/solana.rpc.ts
//
// Resilient Solana RPC access: a connection factory plus fallback runners that
// try each configured endpoint in order (see solana.config.getSolanaRpcUrls).
// The public `api.mainnet-beta.solana.com` rejects many extension/browser
// origins with 403; rotating to the next endpoint on 403/429/network/invalid
// response keeps balances/activity working.
//
// SECURITY: only public read RPC calls flow through here. We never log request
// bodies, secret keys, mnemonics or addresses — dev diagnostics are limited to
// the endpoint host, an HTTP status hint and the normalized error code.

import { Connection } from "@solana/web3.js";
import { getSolanaRpcUrls, type SolanaChainConfig } from "./solana.config";
import { normalizeSolanaError } from "./solana.errors";

const env = import.meta.env as { DEV?: boolean } | undefined;
const isDev = Boolean(env?.DEV);

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

// Best-effort HTTP status hint pulled from a web3.js/fetch error message, for
// dev diagnostics only. Never inspects or logs the request body.
function statusHint(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = text.match(/\b(40[13]|429|5\d\d)\b/);
  return match ? match[1] : "n/a";
}

function logRpcFailure(
  url: string,
  error: unknown,
  index: number,
  total: number,
): void {
  if (!isDev) return;
  // Dev-only diagnostics: host + status + normalized code. No secrets, no body.
  console.warn(
    `[solana-rpc] endpoint ${index + 1}/${total} (${hostOf(url)}) failed`,
    { status: statusHint(error), code: normalizeSolanaError(error).code },
  );
}

// A web3.js Connection for one endpoint. "confirmed" is a good wallet default
// (fast, final enough for balances + sends).
export function createSolanaConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, "confirmed");
}

// Run a READ-ONLY op against the config's endpoints in order, falling back to
// the next on any failure (403/429/network/invalid response). Throws a single
// normalized SolanaError only when every endpoint fails. Use ONLY for
// idempotent reads — never for broadcasting a transaction.
export async function withSolanaRead<T>(
  config: SolanaChainConfig,
  op: (connection: Connection) => Promise<T>,
): Promise<T> {
  const urls = getSolanaRpcUrls(config);
  let lastError: unknown = null;

  for (let index = 0; index < urls.length; index += 1) {
    try {
      return await op(createSolanaConnection(urls[index]));
    } catch (error) {
      lastError = error;
      logRpcFailure(urls[index], error, index, urls.length);
    }
  }

  throw normalizeSolanaError(lastError);
}

// Resolve a connection on the first endpoint that answers a cheap, idempotent
// probe (getLatestBlockhash). Used for WRITES (send) so the broadcast happens
// exactly once on a known-good endpoint and is never retried across endpoints
// (which could double-send). Throws a normalized SolanaError if all are down.
export async function resolveHealthySolanaConnection(
  config: SolanaChainConfig,
): Promise<Connection> {
  const urls = getSolanaRpcUrls(config);
  let lastError: unknown = null;

  for (let index = 0; index < urls.length; index += 1) {
    try {
      const connection = createSolanaConnection(urls[index]);
      await connection.getLatestBlockhash();
      return connection;
    } catch (error) {
      lastError = error;
      logRpcFailure(urls[index], error, index, urls.length);
    }
  }

  throw normalizeSolanaError(lastError);
}
