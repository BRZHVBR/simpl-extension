# Backup, Locked Approval & Risk Controls

Stage 4 of `feat/wc-explicit-approval-security`. Covers seed-backup enforcement,
the locked-approval UX, watch-only restrictions, and the shared risk-control
policy. Seed / private keys never leave the local vault; nothing here logs a
seed, private key, signature or raw transaction.

## Backup status model

`src/core/security/backup-status.ts` (pure). Persisted under `securitySettings`
in `chrome.storage.local` as a v2 `backupStatus` object **plus** legacy mirror
keys (`seedBackupVerified`/`seedBackupConfirmed`) so older screens keep working.

```ts
type BackupStatus = { required; verified; verifiedAt?; skippedAt?; reminderCount?; lastReminderAt? };
```

Policy by wallet secret kind:

| Kind | required | Behavior |
| --- | --- | --- |
| fresh mnemonic (`mnemonic` / `importedMnemonic`) | true | Must verify (random-word quiz) before risky actions. |
| imported private key (`privateKey`) | false | No seed to back up; risky actions allowed (private-key backup warning is a follow-up). |
| watch-only (`watch`) | false | Signing/sending unavailable regardless. |
| **migrated / unknown** (no `backupStatus` object) | true | **Reminder only — never blocked.** |

`isMigratedUnknown()` distinguishes a pre-existing wallet (no backup metadata →
reminder) from a freshly-created one (has `backupStatus` → gated).

## Seed backup enforcement

- On create, `CreateWalletPage` writes `backupStatus {required:true, verified:false}`.
- `App` gates on it: a fresh wallet that is required + unverified + **not skipped**
  is routed to `backup-verify` (the `SeedBackupVerificationPage`) before Home —
  it cannot silently reach Home.
- Verification = password → review phrase → confirm several **random-index**
  words. Only on success is `verified:true` + `verifiedAt` written. No bypass.
- "Remind me later" is explicit (`markSkipped` records `skippedAt` +
  `reminderCount`) and lands on Home with a persistent banner — never a silent skip.
- Closing mid-flow loses nothing: the wallet exists and the gate re-applies on
  next entry (still required + unverified + not skipped).
- **Risk actions before verification** (fresh mnemonic): send/swap/bridge/WC are
  blocked; message signing is a strong warning. Migrated wallets are warned, not
  blocked.

## Risk-control policy

`src/core/security/risk-policy.ts` — one `evaluateRiskAction(action, ctx)` reused
across flows. Returns `{ allowed, level, reason?, requiredAction? }`.

Order of checks: watch-only → locked → unsupported chain → export-secret →
seed-backup (fresh = block value/WC, warn on sign; migrated = warn) → default
allow. Enforced today in: the dApp provider / WC engine (service worker &
offscreen) and `SendPage`. Swap/Bridge already block watch-only; wiring the
backup block into them via the same helper is a fast-follow.

## Locked approval UX

The dApp approval flow uses an **inline per-action password**: signing decrypts
the key on demand from the password entered in the approval window
(`getPrivateKeyForAccount(account, password)`), so a normal locked wallet is not
a signing dead-end — the approval's ready screen *is* the unlock+approve step.
The `locked` screen only appears when there is no selected account at all; it now
offers **Open wallet** (to finish setup/unlock) alongside a Close that safely
**rejects** the request. Closing the window rejects all pending dApp approvals
(`rejectAllPendingDappApprovals`); the WalletConnect approval window likewise
rejects a pending proposal/request on close. Unlock never auto-approves — the
user still explicitly approves.

## Watch-only

- Send / Swap / Bridge render a watch-only guard (no signing UI).
- The dApp provider rejects `personal_sign` / `eth_signTypedData_v4` /
  `eth_sendTransaction` from a watch-only selected account **before** opening an
  approval, with: "Watch-only accounts can view balances and activity, but
  cannot sign transactions."
- Receive / History / Copy address remain available.

## Migration

Existing wallets have no `backupStatus` → treated as migrated/unknown: a Home
reminder banner, never a destructive block, and never gated at App routing.
Balances / receive / history are never blocked.

## Enforced by

`scripts/check-risk.ts` (`npm run check:risk`) — backup-status + risk-policy unit
smoke; plus `check:dapp` (watch-only dApp reject) — all in `npm run check:release`.
