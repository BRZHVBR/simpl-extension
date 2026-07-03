// src/core/security/backup-status.ts
//
// Pure, storage-agnostic model of a wallet's seed-backup state. Read/written by
// the create flow, the seed-backup verification page, the Home banner, the
// Security Center and the risk-policy layer. No chrome/DOM deps.
//
// Persisted (by callers) under `securitySettings` in chrome.storage.local. We
// also read/write the legacy flat keys (`seedBackupVerified`,
// `seedBackupConfirmed`) so existing screens keep working.

export type BackupStatus = {
  // Whether a seed backup is expected for this wallet at all (false for
  // private-key-only imports and watch-only wallets).
  required: boolean;
  verified: boolean;
  verifiedAt?: number;
  skippedAt?: number;
  reminderCount?: number;
  lastReminderAt?: number;
};

// How the active wallet's primary secret was created — drives backup policy.
export type WalletSecretKind = "mnemonic" | "privateKey" | "watch" | "unknown";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

// Parse a BackupStatus out of the raw `securitySettings` record. Handles three
// shapes, newest first:
//   1. `securitySettings.backupStatus` (v2 object — this module's format)
//   2. legacy flat `seedBackupVerified` / `seedBackupConfirmed` booleans
//   3. absent → "unknown" (migrated/legacy wallet): required, not verified, but
//      callers treat unknown as reminder-only (see isMigratedUnknown).
export function parseBackupStatus(securitySettings: unknown): BackupStatus {
  const s = asRecord(securitySettings);
  const raw = s.backupStatus;

  if (raw && typeof raw === "object") {
    const r = asRecord(raw);
    return {
      required: r.required !== false,
      verified: r.verified === true,
      ...(num(r.verifiedAt) !== undefined ? { verifiedAt: num(r.verifiedAt) } : {}),
      ...(num(r.skippedAt) !== undefined ? { skippedAt: num(r.skippedAt) } : {}),
      ...(num(r.reminderCount) !== undefined ? { reminderCount: num(r.reminderCount) } : {}),
      ...(num(r.lastReminderAt) !== undefined ? { lastReminderAt: num(r.lastReminderAt) } : {}),
    };
  }

  // Legacy flat keys.
  if (s.seedBackupVerified === true) {
    return { required: true, verified: true };
  }
  if (s.seedBackupConfirmed === true || s.seedBackupConfirmed === false) {
    return { required: true, verified: false };
  }

  // Nothing recorded → unknown legacy wallet.
  return { required: true, verified: false };
}

// A wallet is "migrated/unknown" when there is NO backup metadata at all — a
// pre-existing wallet from before backup tracking. Such wallets get a reminder,
// never a destructive block (Stage 4 policy).
export function isMigratedUnknown(securitySettings: unknown): boolean {
  const s = asRecord(securitySettings);
  if (s.backupStatus && typeof s.backupStatus === "object") return false;
  if (s.seedBackupVerified === true) return false;
  if (s.seedBackupConfirmed === true || s.seedBackupConfirmed === false) return false;
  return true;
}

// Backup status for a freshly created / imported wallet, by secret kind.
export function initialBackupStatus(kind: WalletSecretKind): BackupStatus {
  if (kind === "watch") return { required: false, verified: false };
  // A private key has no seed phrase to back up; we don't require seed backup,
  // but callers surface a private-key backup warning + acknowledgement.
  if (kind === "privateKey") return { required: false, verified: false };
  // mnemonic / unknown → must verify.
  return { required: true, verified: false };
}

// Serialize to the shape stored under `securitySettings` — the v2 object plus
// the legacy mirror keys so older screens keep reading the same truth.
export function toSecuritySettingsPatch(status: BackupStatus): Record<string, unknown> {
  return {
    backupStatus: status,
    seedBackupConfirmed: status.verified,
    seedBackupVerified: status.verified,
    ...(status.verifiedAt !== undefined
      ? { seedBackupVerifiedAt: new Date(status.verifiedAt).toISOString() }
      : {}),
  };
}

export function markVerified(status: BackupStatus, nowMs: number): BackupStatus {
  return { ...status, required: true, verified: true, verifiedAt: nowMs };
}

export function markSkipped(status: BackupStatus, nowMs: number): BackupStatus {
  return {
    ...status,
    skippedAt: nowMs,
    reminderCount: (status.reminderCount ?? 0) + 1,
    lastReminderAt: nowMs,
  };
}

// True when the backup step still needs the user's attention.
export function backupNeedsAttention(status: BackupStatus): boolean {
  return status.required && !status.verified;
}
