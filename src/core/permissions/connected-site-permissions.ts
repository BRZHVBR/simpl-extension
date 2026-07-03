// src/core/permissions/connected-site-permissions.ts
//
// Versioned Connected-Sites permission model shared by the dApp provider
// (service worker), the WalletConnect engine (offscreen) and the UI. Pure —
// no chrome / DOM / WalletKit deps — so every caller reads the raw
// `connectedSites` array from its own storage layer, runs these helpers, and
// writes the result back. Also the single source of truth for the local audit
// trail.
//
// Design intent (Stage 3): a connected site holds an EXPLICIT, scoped grant —
// which accounts, which chains, which methods — with created/used/expiry
// timestamps and revocation. Legacy v1 records (a bare `{origin, type}` entry)
// migrate to v2 with EMPTY scopes: we prefer a re-approval over silently
// granting broad access.

export const CONNECTED_SITE_PERMISSION_VERSION = 2 as const;

export type ChainNamespace = "eip155" | "tron" | "solana" | "bip122" | "ton";
export type AccountType = "evm" | "tron" | "solana" | "bitcoin" | "ton";
export type PermissionSource = "injected" | "walletconnect";

export type ConnectedSiteAccount = {
  accountId: string;
  address: string;
  type: AccountType;
  label?: string;
};

export type ConnectedSiteChain = {
  namespace: ChainNamespace;
  chainId: string;
  label?: string;
};

export type ConnectedSitePermission = {
  version: 2;
  id: string;
  origin: string;
  name?: string;
  icon?: string;
  source: PermissionSource;
  topic?: string;
  accounts: ConnectedSiteAccount[];
  chains: ConnectedSiteChain[];
  methods: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
};

// ── audit trail ──────────────────────────────────────────────────────────────

export type AuditEventType =
  | "site_connected"
  | "site_rejected"
  | "site_revoked"
  | "site_permission_updated"
  | "walletconnect_connected"
  | "walletconnect_rejected"
  | "walletconnect_revoked"
  | "method_approved"
  | "method_rejected"
  | "chain_switch_approved"
  | "chain_switch_rejected"
  | "account_switch_approved"
  | "account_switch_rejected";

export type AuditEvent = {
  type: AuditEventType;
  at: string;
  origin?: string;
  topic?: string;
  method?: string;
  // A short, already-public identifier only (e.g. a shortened address or chain
  // id). NEVER a signature, raw tx, seed, private key or message body.
  detail?: string;
};

export const AUDIT_LOG_KEY = "permissionAuditLog";
export const AUDIT_LOG_MAX = 300;

// ── helpers ──────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeAccounts(value: unknown): ConnectedSiteAccount[] {
  if (!Array.isArray(value)) return [];
  const out: ConnectedSiteAccount[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const address = str(r.address);
    const accountId = str(r.accountId) ?? address;
    const type = r.type;
    if (!address || !accountId) continue;
    out.push({
      accountId,
      address,
      type: (["evm", "tron", "solana", "bitcoin", "ton"].includes(type as string)
        ? (type as AccountType)
        : "evm"),
      ...(str(r.label) ? { label: str(r.label) } : {}),
    });
  }
  return out;
}

function normalizeChains(value: unknown): ConnectedSiteChain[] {
  if (!Array.isArray(value)) return [];
  const out: ConnectedSiteChain[] = [];
  for (const item of value) {
    const r = asRecord(item);
    const chainId = str(r.chainId);
    const namespace = r.namespace;
    if (!chainId) continue;
    out.push({
      namespace: (["eip155", "tron", "solana", "bip122", "ton"].includes(namespace as string)
        ? (namespace as ChainNamespace)
        : "eip155"),
      chainId,
      ...(str(r.label) ? { label: str(r.label) } : {}),
    });
  }
  return out;
}

// Migrate a single raw connectedSites entry to a v2 permission. A v1 entry
// (no version, or version < 2) is migrated with EMPTY accounts/chains/methods
// so no scoped access is silently carried over — the site must re-approve.
export function migrateEntry(raw: unknown, nowIso: string): ConnectedSitePermission | null {
  const r = asRecord(raw);
  const origin = str(r.origin) ?? str(r.id);
  if (!origin) return null;

  const source: PermissionSource =
    r.source === "walletconnect" || r.source === "injected"
      ? r.source
      : r.type === "walletconnect"
        ? "walletconnect"
        : "injected";

  const isV2 = r.version === CONNECTED_SITE_PERMISSION_VERSION;

  return {
    version: CONNECTED_SITE_PERMISSION_VERSION,
    id: str(r.id) ?? origin,
    origin,
    ...(str(r.name) ? { name: str(r.name) } : {}),
    ...(str(r.icon) ?? str(r.iconUrl) ? { icon: str(r.icon) ?? str(r.iconUrl) } : {}),
    source,
    ...(str(r.topic) ? { topic: str(r.topic) } : {}),
    // v1 has no scope data → empty (safe). v2 keeps its scopes.
    accounts: isV2 ? normalizeAccounts(r.accounts) : [],
    chains: isV2 ? normalizeChains(r.chains) : [],
    methods: isV2 ? stringArray(r.methods) : [],
    createdAt: str(r.createdAt) ?? str(r.connectedAt) ?? nowIso,
    updatedAt: str(r.updatedAt) ?? nowIso,
    ...(str(r.lastUsedAt) ? { lastUsedAt: str(r.lastUsedAt) } : {}),
    ...(str(r.expiresAt) ? { expiresAt: str(r.expiresAt) } : {}),
    ...(str(r.revokedAt) ? { revokedAt: str(r.revokedAt) } : {}),
  };
}

export function migrateConnectedSites(raw: unknown, nowIso: string): ConnectedSitePermission[] {
  if (!Array.isArray(raw)) return [];
  const out: ConnectedSitePermission[] = [];
  for (const entry of raw) {
    const migrated = migrateEntry(entry, nowIso);
    if (migrated) out.push(migrated);
  }
  return out;
}

// ── predicates ───────────────────────────────────────────────────────────────

export function isPermissionExpired(perm: ConnectedSitePermission, nowMs: number): boolean {
  if (!perm.expiresAt) return false;
  const t = Date.parse(perm.expiresAt);
  return Number.isFinite(t) && nowMs > t;
}

export function isPermissionActive(perm: ConnectedSitePermission, nowMs: number): boolean {
  return !perm.revokedAt && !isPermissionExpired(perm, nowMs);
}

export function hasAccountPermission(perm: ConnectedSitePermission, address: string): boolean {
  const a = address.toLowerCase();
  return perm.accounts.some((acc) => acc.address.toLowerCase() === a);
}

export function hasChainPermission(
  perm: ConnectedSitePermission,
  chain: { namespace?: ChainNamespace; chainId: string },
): boolean {
  return perm.chains.some(
    (c) =>
      c.chainId === chain.chainId &&
      (chain.namespace === undefined || c.namespace === chain.namespace),
  );
}

export function hasMethodPermission(perm: ConnectedSitePermission, method: string): boolean {
  return perm.methods.includes(method);
}

export function getPermittedAddresses(
  perm: ConnectedSitePermission,
  type?: AccountType,
): string[] {
  return perm.accounts
    .filter((a) => type === undefined || a.type === type)
    .map((a) => a.address);
}

// ── lookups ──────────────────────────────────────────────────────────────────

export function findByOrigin(
  perms: ConnectedSitePermission[],
  origin: string,
): ConnectedSitePermission | null {
  return perms.find((p) => p.origin === origin && p.source === "injected") ?? null;
}

export function findByTopic(
  perms: ConnectedSitePermission[],
  topic: string,
): ConnectedSitePermission | null {
  return perms.find((p) => p.topic === topic) ?? null;
}

// ── mutations (return a new array; never mutate input) ─────────────────────────

export type GrantInput = {
  origin: string;
  source: PermissionSource;
  topic?: string;
  name?: string;
  icon?: string;
  accounts: ConnectedSiteAccount[];
  chains: ConnectedSiteChain[];
  methods: string[];
  expiresAt?: string;
};

// Upsert a permission. Matches an existing record by topic (WalletConnect) or by
// origin+source (injected). Scopes are REPLACED with the granted set (an approval
// defines the current scope), timestamps updated, and any prior revocation
// cleared.
export function grantConnectedSitePermission(
  perms: ConnectedSitePermission[],
  input: GrantInput,
  nowIso: string,
): ConnectedSitePermission[] {
  const match = input.topic
    ? perms.find((p) => p.topic === input.topic)
    : perms.find((p) => p.origin === input.origin && p.source === input.source);

  const base: ConnectedSitePermission = match ?? {
    version: CONNECTED_SITE_PERMISSION_VERSION,
    id: input.topic ?? input.origin,
    origin: input.origin,
    source: input.source,
    accounts: [],
    chains: [],
    methods: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const next: ConnectedSitePermission = {
    ...base,
    version: CONNECTED_SITE_PERMISSION_VERSION,
    origin: input.origin,
    source: input.source,
    ...(input.topic ? { topic: input.topic } : base.topic ? { topic: base.topic } : {}),
    ...(input.name ?? base.name ? { name: input.name ?? base.name } : {}),
    ...(input.icon ?? base.icon ? { icon: input.icon ?? base.icon } : {}),
    accounts: input.accounts,
    chains: input.chains,
    methods: input.methods,
    createdAt: base.createdAt,
    updatedAt: nowIso,
    lastUsedAt: nowIso,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  };
  // Explicitly drop any prior revocation on a fresh grant.
  delete next.revokedAt;

  const rest = perms.filter((p) => p !== match);
  return [next, ...rest];
}

// Remove a permission entirely (user revoke / WC disconnect). Matches by id,
// origin or topic.
export function revokeConnectedSitePermission(
  perms: ConnectedSitePermission[],
  key: { id?: string; origin?: string; topic?: string },
): ConnectedSitePermission[] {
  return perms.filter((p) => {
    if (key.topic && p.topic === key.topic) return false;
    if (key.id && p.id === key.id) return false;
    if (key.origin && p.origin === key.origin) return false;
    return true;
  });
}

// Soft-mark a permission as expired/revoked (used for WC session lifecycle when
// we want the record to persist as an inactive tombstone rather than vanish).
export function markPermissionRevoked(
  perms: ConnectedSitePermission[],
  key: { origin?: string; topic?: string },
  nowIso: string,
): ConnectedSitePermission[] {
  return perms.map((p) =>
    (key.topic && p.topic === key.topic) || (key.origin && p.origin === key.origin)
      ? { ...p, revokedAt: nowIso, updatedAt: nowIso }
      : p,
  );
}

export function touchConnectedSitePermission(
  perms: ConnectedSitePermission[],
  key: { origin?: string; topic?: string },
  nowIso: string,
): ConnectedSitePermission[] {
  return perms.map((p) =>
    (key.topic && p.topic === key.topic) ||
    (key.origin && p.origin === key.origin && p.source === "injected")
      ? { ...p, lastUsedAt: nowIso }
      : p,
  );
}

// ── audit log ────────────────────────────────────────────────────────────────

export function appendAuditEvent(log: unknown, event: AuditEvent): AuditEvent[] {
  const existing = Array.isArray(log) ? (log as AuditEvent[]) : [];
  return [event, ...existing].slice(0, AUDIT_LOG_MAX);
}
