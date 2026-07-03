# Connected Sites — Permission Model

How SIMPL scopes what a connected site (browser dApp or WalletConnect session)
may do. Introduced on `feat/wc-explicit-approval-security` (Stage 3).

Source of truth: `src/core/permissions/connected-site-permissions.ts` (pure,
shared by the service worker, the offscreen WalletConnect engine and the UI).
Storage key: `connectedSites` in `chrome.storage.local`.

## Schema (v2)

```ts
type ConnectedSitePermission = {
  version: 2;
  id; origin; name?; icon?;
  source: 'injected' | 'walletconnect';
  topic?;                       // WalletConnect session topic
  accounts: { accountId; address; type: 'evm'|'tron'|'solana'|'bitcoin'|'ton'; label? }[];
  chains:   { namespace: 'eip155'|'tron'|'solana'|'bip122'|'ton'; chainId; label? }[];
  methods:  string[];
  createdAt; updatedAt; lastUsedAt?; expiresAt?; revokedAt?;
};
```

A permission is **active** when it is not `revokedAt` and not past `expiresAt`.

## Scoping

- **Accounts** — `eth_accounts` returns *only* the granted addresses that still
  exist in the wallet (never the whole wallet, never an ungranted account).
  Signing/sending requires the signer address to be granted.
- **Chains** — `eth_sendTransaction` requires the active network to be granted.
  An injected connect grants all supported EVM chains; a WalletConnect session
  grants exactly the chains in its approved namespaces.
- **Methods** — each RPC method must be in `methods`. A method still triggers its
  own per-action approval — the grant only decides whether the site may *ask*.

## dApp (injected) flow

1. `eth_requestAccounts` with no active permission → connect approval popup. On
   approve, `grantInjectedEvmPermission` records the approving account + supported
   EVM chains + the default method set.
2. `eth_accounts` → granted addresses (∩ wallet), else `[]`.
3. `personal_sign` / `eth_signTypedData_v4` → active permission + method + signer
   account, then a signing approval.
4. `eth_sendTransaction` → active permission + method + chain + `from` account,
   then a transaction approval.
5. `wallet_switchEthereumChain` → if the chain is already granted, switch
   directly; otherwise a switch approval (which grants the chain); unsupported →
   `4902`.
6. `simpl_switchAccount` / `simpl_switchChain` → never silent; always an explicit
   approval (the active account/chain is wallet-global). On approve, the account/
   chain is added to the site's permission.

## WalletConnect flow

1. Session proposals are explicit-approval (never auto-approved — see
   `docs/security-review.md`).
2. After a successful `approveSession`, a `source: 'walletconnect'` permission is
   stored, keyed by the session **topic**, scoped to the approved
   accounts/chains/methods, with `expiresAt` from the session expiry.
3. `session_request` is rejected (`4100`) unless the topic has an **active**
   permission that includes the method (and chain, when the request carries one).
4. `session_delete` removes the topic's permission; `session_expire` marks it
   revoked (inactive tombstone).

## Revoke

- **Connected Sites → Revoke / Revoke all** removes the permission. For a
  WalletConnect site it also sends `SIMPLE_WALLETCONNECT_DISCONNECT_SESSION` to
  the offscreen engine, which disconnects the live session by topic.
- Because every method guard resolves an *active* permission, revoke immediately
  blocks all further `eth_accounts` / signing / sending until the site reconnects
  and is re-approved.

## Migration (v1 → v2)

Legacy `connectedSites` entries (bare `{origin, type}`) migrate lazily on read to
v2 with **empty** `accounts` / `chains` / `methods`. We prefer a re-approval over
silently carrying over broad access:

- After upgrade, previously-connected sites show with **no granted permissions**
  and `eth_accounts` returns `[]`; the dApp's next `eth_requestAccounts` prompts a
  fresh, scoped connect. This is a deliberate one-time behavior change.

## Audit trail (local-only)

`connected-site-permissions.ts` also maintains a capped (`≤ 300`) local audit log
under `permissionAuditLog`: `site_connected`, `site_rejected`, `site_revoked`,
`walletconnect_*`, `method_approved` / `method_rejected`,
`chain_switch_*`, `account_switch_*`. It records only already-public identifiers
(origin, shortened address, chain id) — never a seed, private key, signature, raw
tx or message body. Local-only; never transmitted.

## First-party / internal methods

`simpl_*` methods are gated on the same connect permission as `eth_*` and never
silently mutate wallet-global state: `simpl_getAccounts` requires an active
permission; `simpl_switchAccount` / `simpl_switchChain` require an explicit
approval popup. There is no origin allowlist that bypasses approval.

## Enforced by

`scripts/check-permissions.ts` (model), `scripts/check-dapp-permissions.ts`
(guards), `scripts/check-walletconnect-approval.ts` (WC mapping) — all part of
`npm run check:release`.
