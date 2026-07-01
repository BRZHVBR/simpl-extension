// Normalized Simpl API error parser (shared, framework-agnostic).
//
// The hardened getsimpl-api gateway returns errors in a normalized envelope:
//
//   { error: { code, message, provider?, chainType?, retryable?, details? } }
//
// (also seen as `{ ok:false, error:{…} }`). Older / provider-specific routes
// still return legacy shapes — `{ error: "No route", message }` or
// `{ error: "TON_UPSTREAM_UNAVAILABLE", message }`. This module folds all of
// those, plus transport failures (network / timeout / CORS) and non-JSON
// bodies, into ONE typed `NormalizedApiError` with a SHORT, SAFE user message.
//
// Rules honored here:
//   • Never surface raw upstream/provider text to the user — `userMessage` is
//     always one of our own curated strings; provider detail lives only in
//     `technical` (for console/debug logging).
//   • Non-JSON, empty, and malformed bodies degrade gracefully.
//   • Network errors, timeouts, aborts and CORS failures are classified.

export type SimplApiErrorCode =
  // Backend normalized codes:
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_ASSET"
  | "UNSUPPORTED_TOKEN"
  | "INVALID_TOKEN"
  | "TOKEN_NOT_FOUND"
  | "NO_ROUTE"
  | "INSUFFICIENT_LIQUIDITY"
  | "QUOTE_EXPIRED"
  | "RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "PROVIDER_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "UNAUTHORIZED_ORIGIN"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR"
  // Client-synthesized (no server code available):
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "NOT_DEPLOYED"
  | "UNKNOWN";

export interface NormalizedApiError {
  /** Stable, machine-branchable code. */
  code: SimplApiErrorCode;
  /** Short, safe, user-facing message. Never contains provider internals. */
  userMessage: string;
  /** Whether retrying the same request unchanged can reasonably succeed. */
  retryable: boolean;
  /** HTTP status when the server answered; 0 for transport/timeout failures. */
  httpStatus: number;
  /** Upstream provider that failed, when the server told us. */
  provider?: string;
  /** Chain family the error relates to, when the server told us. */
  chainType?: string;
  /** Suggested wait before retrying a rate-limited request. */
  retryAfterSeconds?: number;
  /** Technical detail for console/debug ONLY — never render this. */
  technical: string;
  /** Raw structured detail from the envelope, for debug logging only. */
  details?: unknown;
}

// Short, safe copy per code. These are the ONLY strings shown to the user.
const USER_MESSAGE: Record<SimplApiErrorCode, string> = {
  BAD_REQUEST: "Something was off with that request. Please try again.",
  VALIDATION_ERROR: "Something was off with that request. Please try again.",
  UNSUPPORTED_CHAIN: "This network is not supported yet.",
  UNSUPPORTED_ASSET: "This asset is not supported yet.",
  UNSUPPORTED_TOKEN: "This asset is not supported yet.",
  INVALID_TOKEN: "This asset is not supported yet.",
  TOKEN_NOT_FOUND: "Token metadata was not found.",
  NO_ROUTE: "No route was found for this pair.",
  INSUFFICIENT_LIQUIDITY: "No route with enough liquidity was found.",
  QUOTE_EXPIRED: "This quote expired. Refresh the quote and try again.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  UPSTREAM_TIMEOUT: "The provider is taking too long to respond. Please try again.",
  PROVIDER_TIMEOUT: "The provider is taking too long to respond. Please try again.",
  UPSTREAM_UNAVAILABLE: "This provider is temporarily unavailable.",
  PROVIDER_ERROR: "The provider returned an error. Please try again.",
  UNAUTHORIZED_ORIGIN: "This request is not allowed from here.",
  CONFIG_ERROR: "The service is temporarily unavailable.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
  NETWORK_ERROR: "Network error. Check your connection and try again.",
  TIMEOUT: "The request timed out. Please try again.",
  NOT_DEPLOYED: "This feature is temporarily unavailable.",
  UNKNOWN: "Something went wrong. Please try again.",
};

// Whether a code is retryable by default (a transient/infra failure vs. a
// request that must change first).
const RETRYABLE: Record<SimplApiErrorCode, boolean> = {
  BAD_REQUEST: false,
  VALIDATION_ERROR: false,
  UNSUPPORTED_CHAIN: false,
  UNSUPPORTED_ASSET: false,
  UNSUPPORTED_TOKEN: false,
  INVALID_TOKEN: false,
  TOKEN_NOT_FOUND: false,
  NO_ROUTE: false,
  INSUFFICIENT_LIQUIDITY: false,
  QUOTE_EXPIRED: true,
  RATE_LIMITED: true,
  UPSTREAM_TIMEOUT: true,
  PROVIDER_TIMEOUT: true,
  UPSTREAM_UNAVAILABLE: true,
  PROVIDER_ERROR: true,
  UNAUTHORIZED_ORIGIN: false,
  CONFIG_ERROR: false,
  INTERNAL_ERROR: false,
  NETWORK_ERROR: true,
  TIMEOUT: true,
  NOT_DEPLOYED: false,
  UNKNOWN: false,
};

const KNOWN_CODES = new Set<string>(Object.keys(USER_MESSAGE));

/** Short user-facing message for a code (falls back to UNKNOWN copy). */
export function userMessageForCode(code: string): string {
  return USER_MESSAGE[code as SimplApiErrorCode] ?? USER_MESSAGE.UNKNOWN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Map a legacy label string (e.g. "No route", "Bad request", "Provider error")
// or an UPPER_SNAKE provider code (e.g. "TON_UPSTREAM_UNAVAILABLE") onto a
// normalized code. Returns null when nothing recognizable matches.
function codeFromLegacyString(raw: string): SimplApiErrorCode | null {
  const s = raw.trim();
  if (!s) return null;
  if (KNOWN_CODES.has(s)) return s as SimplApiErrorCode;
  const u = s.toUpperCase();
  // Provider UPPER_SNAKE codes and legacy labels, matched by substring so
  // "TON_UPSTREAM_RATE_LIMITED" / "Rate limited" both resolve.
  if (u.includes("RATE_LIMIT") || u.includes("RATE LIMIT")) return "RATE_LIMITED";
  if (u.includes("QUOTE") && u.includes("EXPIR")) return "QUOTE_EXPIRED";
  if (u.includes("LIQUIDITY")) return "INSUFFICIENT_LIQUIDITY";
  if (u.includes("TIMEOUT") || u.includes("TIMED OUT")) return "UPSTREAM_TIMEOUT";
  if (u.includes("UNAVAILABLE")) return "UPSTREAM_UNAVAILABLE";
  if (u.includes("NO ROUTE") || u.includes("NO_ROUTE")) return "NO_ROUTE";
  if (u.includes("NOT_FOUND") || u.includes("NOT FOUND")) return "TOKEN_NOT_FOUND";
  if (u.includes("UNSUPPORTED_CHAIN") || u.includes("UNSUPPORTED CHAIN")) return "UNSUPPORTED_CHAIN";
  if (u.includes("UNSUPPORTED")) return "UNSUPPORTED_ASSET";
  if (u.includes("FORBIDDEN") || u.includes("ORIGIN")) return "UNAUTHORIZED_ORIGIN";
  if (u.includes("INVALID") || u.includes("BAD REQUEST") || u.includes("BAD_REQUEST")) return "BAD_REQUEST";
  if (u.includes("PROVIDER") || u.includes("UPSTREAM")) return "PROVIDER_ERROR";
  return null;
}

// Map an HTTP status to a code when the body carried no usable code.
function codeFromStatus(status: number): SimplApiErrorCode {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 403:
      return "UNAUTHORIZED_ORIGIN";
    case 404:
      return "TOKEN_NOT_FOUND";
    case 408:
      return "UPSTREAM_TIMEOUT";
    case 409:
      return "QUOTE_EXPIRED";
    case 429:
      return "RATE_LIMITED";
    case 502:
      return "PROVIDER_ERROR";
    case 503:
      return "UPSTREAM_UNAVAILABLE";
    case 504:
      return "UPSTREAM_TIMEOUT";
    default:
      if (status >= 500) return "PROVIDER_ERROR";
      if (status >= 400) return "BAD_REQUEST";
      return "UNKNOWN";
  }
}

function build(
  code: SimplApiErrorCode,
  httpStatus: number,
  technical: string,
  extra: Partial<NormalizedApiError> = {},
): NormalizedApiError {
  return {
    code,
    userMessage: USER_MESSAGE[code],
    retryable: extra.retryable ?? RETRYABLE[code],
    httpStatus,
    technical,
    ...extra,
  };
}

/**
 * Parse an already-decoded error body (any shape) + HTTP status into a
 * normalized error. `body` may be an object, a string, or null.
 */
export function normalizeApiErrorBody(body: unknown, status: number): NormalizedApiError {
  // 1. Normalized envelope: { error: { code, message, provider, chainType, retryable, details } }
  const envelope = isRecord(body) ? body.error : undefined;
  if (isRecord(envelope) && typeof envelope.code === "string") {
    const mapped = codeFromLegacyString(envelope.code);
    const code = mapped ?? codeFromStatus(status);
    const provider = typeof envelope.provider === "string" ? envelope.provider : undefined;
    const chainType = typeof envelope.chainType === "string" ? envelope.chainType : undefined;
    const retryable = typeof envelope.retryable === "boolean" ? envelope.retryable : undefined;
    const retryAfter = readRetryAfter(envelope.details);
    return build(code, status, `${envelope.code}: ${stringifySafe(envelope.message)}`, {
      provider,
      chainType,
      ...(retryable !== undefined ? { retryable } : {}),
      ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
      details: envelope.details,
    });
  }

  // 2. Legacy label / provider-code shape: { error: "string", message?, provider? }
  if (isRecord(body) && typeof body.error === "string") {
    const mapped = codeFromLegacyString(body.error);
    const code = mapped ?? codeFromStatus(status);
    const provider = typeof body.provider === "string" ? body.provider : undefined;
    return build(code, status, `${body.error}: ${stringifySafe(body.message)}`, { provider });
  }

  // 3. Only a message, or an unknown object → status-derived code.
  const technical = isRecord(body)
    ? stringifySafe(body.message ?? body)
    : typeof body === "string"
      ? body.slice(0, 300)
      : `HTTP ${status}`;
  return build(codeFromStatus(status), status, technical);
}

/** Pull a retry-after hint (seconds) from a details blob, when present. */
function readRetryAfter(details: unknown): number | undefined {
  if (!isRecord(details)) return undefined;
  const v = details.retryAfterSeconds ?? details.retryAfter;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function stringifySafe(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 300);
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return String(value).slice(0, 300);
  }
}

/**
 * Read a failed `Response` and normalize it. Reads the body text ONCE and
 * best-effort JSON-parses it, so a non-JSON / empty body degrades safely.
 */
export async function normalizeApiErrorFromResponse(res: Response): Promise<NormalizedApiError> {
  let text: string | null = null;
  try {
    text = await res.text();
  } catch {
    text = null;
  }
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text; // non-JSON body — keep as text
    }
  }
  const normalized = normalizeApiErrorBody(body, res.status);
  const retryAfterHeader = res.headers.get("retry-after");
  if (normalized.retryAfterSeconds === undefined && retryAfterHeader) {
    const n = Number(retryAfterHeader);
    if (Number.isFinite(n)) normalized.retryAfterSeconds = n;
  }
  return normalized;
}

/**
 * Classify a thrown/transport error (no HTTP response): abort/timeout, network
 * failure, or CORS. `fetch` surfaces CORS and offline the same way (a TypeError
 * "Failed to fetch"), so both map to NETWORK_ERROR.
 */
export function normalizeThrownError(err: unknown): NormalizedApiError {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || /abort|timeout|timed out/i.test(message)) {
    return build("TIMEOUT", 0, message || "Request aborted");
  }
  // TypeError "Failed to fetch" covers offline, DNS, and CORS-blocked requests.
  return build("NETWORK_ERROR", 0, message || "Network request failed");
}
