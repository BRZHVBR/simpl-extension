// Passive provider-health client for GET /v1/health/providers.
//
// Non-invasive by design: one cheap, deduped, short-cached request the app can
// consult to show a small contextual warning on a specific flow when the
// provider it depends on is degraded/down. It NEVER blocks rendering or data
// loading — a failed/absent healthcheck simply yields `null` (unknown).

function resolveApiBaseUrl(): string {
  const env = import.meta.env as Record<string, string | undefined> | undefined;
  const candidate =
    env?.VITE_SIMPL_API_URL ??
    env?.VITE_SIMPL_SWAP_PROXY_URL ??
    "https://api.getsimpl.io";
  const trimmed = (candidate ?? "").trim().replace(/\/+$/u, "");
  return trimmed || "https://api.getsimpl.io";
}

const API_BASE_URL = resolveApiBaseUrl();
const TTL_MS = 60_000;
const TIMEOUT_MS = 6_000;

export type ProviderStatus = "ok" | "degraded" | "down" | "not_configured";
export type ServiceStatus = "ok" | "degraded" | "down";

export type ProviderName =
  | "coingecko"
  | "zeroEx"
  | "lifi"
  | "jupiter"
  | "esplora"
  | "trongrid"
  | "ton";

export interface ProviderHealth {
  service: string;
  status: ServiceStatus;
  providers: Partial<Record<ProviderName, { status: ProviderStatus }>>;
}

let cached: { at: number; value: ProviderHealth | null } | null = null;
let inflight: Promise<ProviderHealth | null> | null = null;

function isProviderHealth(value: unknown): value is ProviderHealth {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { status?: unknown }).status === "string" &&
    typeof (value as { providers?: unknown }).providers === "object"
  );
}

/**
 * Get the provider-health snapshot, deduped and cached for {@link TTL_MS}.
 * Returns `null` (unknown) on any failure — the healthcheck must never surface
 * an error to the user.
 */
export async function getProviderHealth(force = false): Promise<ProviderHealth | null> {
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return cached.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE_URL}/v1/health/providers`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(String(res.status));
      const raw: unknown = await res.json();
      const value = isProviderHealth(raw) ? raw : null;
      cached = { at: Date.now(), value };
      return value;
    } catch {
      // Fail silent: an unreachable/absent healthcheck is "unknown", not an error.
      cached = { at: Date.now(), value: null };
      return null;
    } finally {
      clearTimeout(timer);
      inflight = null;
    }
  })();
  return inflight;
}

/** A provider is "impaired" when it is degraded or down (not merely not_configured). */
export function isProviderImpaired(
  health: ProviderHealth | null,
  provider: ProviderName,
): boolean {
  const status = health?.providers?.[provider]?.status;
  return status === "degraded" || status === "down";
}

/** The first impaired provider from a set, or null when all are fine/unknown. */
export function firstImpaired(
  health: ProviderHealth | null,
  providers: ProviderName[],
): ProviderName | null {
  if (!health) return null;
  return providers.find((p) => isProviderImpaired(health, p)) ?? null;
}

// Dev/debug surface: expose a console helper so provider health can be inspected
// from the popup Console without any user-facing UI. Quiet in production users'
// normal flow; only attaches the global, never logs on its own.
if (import.meta.env.DEV) {
  (globalThis as Record<string, unknown>).getSimplProviderHealth = () =>
    getProviderHealth(true).then((h) => {
      // eslint-disable-next-line no-console
      console.info("[simpl:health] providers", h);
      return h;
    });
}
