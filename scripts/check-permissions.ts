// scripts/check-permissions.ts
//
// Unit smoke for the versioned Connected-Sites permission model
// (src/core/permissions/connected-site-permissions.ts): migration safety,
// scope predicates, grant/revoke/expiry, and audit-log capping.
//
// Run: npm run check:permissions

import {
  CONNECTED_SITE_PERMISSION_VERSION,
  migrateConnectedSites,
  migrateEntry,
  isPermissionExpired,
  isPermissionActive,
  hasAccountPermission,
  hasChainPermission,
  hasMethodPermission,
  getPermittedAddresses,
  findByOrigin,
  findByTopic,
  grantConnectedSitePermission,
  revokeConnectedSitePermission,
  markPermissionRevoked,
  touchConnectedSitePermission,
  appendAuditEvent,
  AUDIT_LOG_MAX,
  type ConnectedSitePermission,
} from "../src/core/permissions/connected-site-permissions";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const NOW = "2026-07-03T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);

console.log("START CONNECTED-SITES PERMISSION CHECK\n");

// ── Migration safety (v1 → v2) ──────────────────────────────────────────────
console.log("Migration v1 → v2:");
const v1 = [
  { id: "https://a.xyz", origin: "https://a.xyz", type: "walletconnect", name: "A", iconUrl: "x", connectedAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-02-01T00:00:00.000Z" },
  { id: "https://b.xyz", origin: "https://b.xyz", type: "evm" },
];
const migrated = migrateConnectedSites(v1, NOW);
check("all entries migrate", migrated.length === 2);
check("version stamped to 2", migrated.every((p) => p.version === CONNECTED_SITE_PERMISSION_VERSION));
check("v1 grants NO accounts (no silent broad grant)", migrated.every((p) => p.accounts.length === 0));
check("v1 grants NO chains", migrated.every((p) => p.chains.length === 0));
check("v1 grants NO methods", migrated.every((p) => p.methods.length === 0));
check("source inferred (walletconnect / injected)",
  migrated[0].source === "walletconnect" && migrated[1].source === "injected");
check("identity + timestamps preserved",
  migrated[0].name === "A" && migrated[0].createdAt === "2026-01-01T00:00:00.000Z");
check("malformed entry dropped", migrateConnectedSites([null, {}, 5, "x"], NOW).length === 0);

// A v2 record round-trips with scopes intact.
const v2raw = {
  version: 2,
  id: "t1",
  origin: "https://d.xyz",
  source: "walletconnect",
  topic: "t1",
  accounts: [{ accountId: "a1", address: "0xAbC0000000000000000000000000000000000001", type: "evm" }],
  chains: [{ namespace: "eip155", chainId: "eip155:1" }],
  methods: ["personal_sign"],
  createdAt: NOW,
  updatedAt: NOW,
};
const v2 = migrateEntry(v2raw, NOW);
check("v2 record keeps its scopes", !!v2 && v2.accounts.length === 1 && v2.methods.length === 1);

// ── Predicates ───────────────────────────────────────────────────────────────
console.log("\nScope predicates:");
const perm: ConnectedSitePermission = {
  version: 2,
  id: "https://dapp.xyz",
  origin: "https://dapp.xyz",
  source: "injected",
  accounts: [{ accountId: "a1", address: "0xAbC0000000000000000000000000000000000001", type: "evm" }],
  chains: [{ namespace: "eip155", chainId: "1" }],
  methods: ["eth_accounts", "personal_sign"],
  createdAt: NOW,
  updatedAt: NOW,
};
check("hasAccountPermission is case-insensitive",
  hasAccountPermission(perm, "0xabc0000000000000000000000000000000000001"));
check("hasAccountPermission false for other address",
  !hasAccountPermission(perm, "0x0000000000000000000000000000000000000009"));
check("hasChainPermission true for granted chain", hasChainPermission(perm, { namespace: "eip155", chainId: "1" }));
check("hasChainPermission false for other chain", !hasChainPermission(perm, { namespace: "eip155", chainId: "56" }));
check("hasMethodPermission true", hasMethodPermission(perm, "personal_sign"));
check("hasMethodPermission false", !hasMethodPermission(perm, "eth_sendTransaction"));
check("getPermittedAddresses returns evm addr", getPermittedAddresses(perm, "evm").length === 1);

// ── Expiry / active ─────────────────────────────────────────────────────────
console.log("\nExpiry / active:");
const expired = { ...perm, expiresAt: "2020-01-01T00:00:00.000Z" };
const future = { ...perm, expiresAt: "2999-01-01T00:00:00.000Z" };
const revoked = { ...perm, revokedAt: NOW };
check("expired → isPermissionExpired true", isPermissionExpired(expired, NOW_MS));
check("future expiry → not expired", !isPermissionExpired(future, NOW_MS));
check("no expiry → not expired", !isPermissionExpired(perm, NOW_MS));
check("expired → not active", !isPermissionActive(expired, NOW_MS));
check("revoked → not active", !isPermissionActive(revoked, NOW_MS));
check("fresh → active", isPermissionActive(perm, NOW_MS));

// ── Grant (upsert) ───────────────────────────────────────────────────────────
console.log("\nGrant / upsert:");
let store: ConnectedSitePermission[] = [];
store = grantConnectedSitePermission(
  store,
  {
    origin: "https://x.xyz",
    source: "injected",
    accounts: [{ accountId: "a", address: "0x1", type: "evm" }],
    chains: [{ namespace: "eip155", chainId: "1" }],
    methods: ["eth_accounts", "personal_sign"],
  },
  NOW,
);
check("grant creates a record", store.length === 1 && findByOrigin(store, "https://x.xyz") !== null);
check("granted scopes present", findByOrigin(store, "https://x.xyz")!.methods.includes("personal_sign"));
// Re-grant replaces scopes (approval defines the current scope).
store = grantConnectedSitePermission(
  store,
  { origin: "https://x.xyz", source: "injected", accounts: [{ accountId: "a", address: "0x1", type: "evm" }], chains: [], methods: ["eth_accounts"] },
  NOW,
);
check("re-grant does not duplicate", store.length === 1);
check("re-grant replaces methods", !findByOrigin(store, "https://x.xyz")!.methods.includes("personal_sign"));
// WalletConnect grant keyed by topic.
store = grantConnectedSitePermission(
  store,
  { origin: "https://wc.xyz", source: "walletconnect", topic: "topic-1", accounts: [], chains: [], methods: ["eth_sendTransaction"], expiresAt: "2999-01-01T00:00:00.000Z" },
  NOW,
);
check("wc grant keyed by topic", findByTopic(store, "topic-1") !== null);
check("wc grant carries expiry", !!findByTopic(store, "topic-1")!.expiresAt);

// ── Revoke ───────────────────────────────────────────────────────────────────
console.log("\nRevoke:");
const afterRevokeTopic = revokeConnectedSitePermission(store, { topic: "topic-1" });
check("revoke by topic removes the record", findByTopic(afterRevokeTopic, "topic-1") === null);
const afterRevokeOrigin = revokeConnectedSitePermission(store, { origin: "https://x.xyz" });
check("revoke by origin removes the record", findByOrigin(afterRevokeOrigin, "https://x.xyz") === null);
const marked = markPermissionRevoked(store, { topic: "topic-1" }, NOW);
check("markPermissionRevoked sets revokedAt (tombstone)",
  marked.find((p) => p.topic === "topic-1")?.revokedAt === NOW);
check("marked tombstone is inactive", !isPermissionActive(marked.find((p) => p.topic === "topic-1")!, NOW_MS));

// ── Touch ────────────────────────────────────────────────────────────────────
console.log("\nTouch:");
const touched = touchConnectedSitePermission(store, { topic: "topic-1" }, "2027-01-01T00:00:00.000Z");
check("touch updates lastUsedAt", touched.find((p) => p.topic === "topic-1")?.lastUsedAt === "2027-01-01T00:00:00.000Z");

// ── Audit log cap ─────────────────────────────────────────────────────────────
console.log("\nAudit log:");
let log: ReturnType<typeof appendAuditEvent> = [];
for (let i = 0; i < AUDIT_LOG_MAX + 50; i += 1) {
  log = appendAuditEvent(log, { type: "site_connected", at: NOW, origin: `https://s${i}.xyz` });
}
check(`audit log capped at ${AUDIT_LOG_MAX}`, log.length === AUDIT_LOG_MAX);
check("newest event first", log[0].origin === `https://s${AUDIT_LOG_MAX + 49}.xyz`);

console.log("");
if (failures > 0) {
  console.log(`PERMISSION CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("PERMISSION CHECK PASSED");
