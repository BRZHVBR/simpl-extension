// scripts/check-risk.ts
//
// Unit smoke for the backup-status + risk-policy models (Stage 4). Run:
//   npm run check:risk

import {
  parseBackupStatus,
  isMigratedUnknown,
  initialBackupStatus,
  markVerified,
  markSkipped,
  backupNeedsAttention,
  toSecuritySettingsPatch,
} from "../src/core/security/backup-status";
import { evaluateRiskAction, type RiskContext } from "../src/core/security/risk-policy";
import type { BackupStatus } from "../src/core/security/backup-status";

let failures = 0;
function check(name: string, passed: boolean, detail?: string): void {
  if (passed) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("START BACKUP / RISK POLICY CHECK\n");

// ── backup-status ────────────────────────────────────────────────────────────
console.log("Backup status model:");
check("fresh mnemonic → required, not verified",
  initialBackupStatus("mnemonic").required && !initialBackupStatus("mnemonic").verified);
check("private key → not required", !initialBackupStatus("privateKey").required);
check("watch → not required", !initialBackupStatus("watch").required);

check("absent securitySettings → migrated/unknown", isMigratedUnknown({}));
check("unknown parses as required+unverified",
  parseBackupStatus({}).required && !parseBackupStatus({}).verified);
check("legacy seedBackupVerified=true → verified",
  parseBackupStatus({ seedBackupVerified: true }).verified);
check("legacy verified is NOT unknown", !isMigratedUnknown({ seedBackupVerified: true }));
check("v2 backupStatus object round-trips",
  parseBackupStatus({ backupStatus: { required: true, verified: true, verifiedAt: 5 } }).verifiedAt === 5);
check("v2 object is NOT unknown", !isMigratedUnknown({ backupStatus: { required: true, verified: false } }));

const verified = markVerified(initialBackupStatus("mnemonic"), 1234);
check("markVerified sets verified + verifiedAt", verified.verified && verified.verifiedAt === 1234);
check("verified no longer needs attention", !backupNeedsAttention(verified));
check("unverified needs attention", backupNeedsAttention(initialBackupStatus("mnemonic")));
const skipped = markSkipped(initialBackupStatus("mnemonic"), 999);
check("markSkipped records skippedAt + reminderCount",
  skipped.skippedAt === 999 && skipped.reminderCount === 1);
check("toSecuritySettingsPatch mirrors legacy keys",
  toSecuritySettingsPatch(verified).seedBackupVerified === true &&
    (toSecuritySettingsPatch(verified).backupStatus as BackupStatus).verified === true);

// ── risk-policy ────────────────────────────────────────────────────────────
console.log("\nRisk policy:");
const freshUnverified: BackupStatus = { required: true, verified: false };
const doneBackup: BackupStatus = { required: true, verified: true, verifiedAt: 1 };

const base = (over: Partial<RiskContext>): RiskContext => ({
  locked: false,
  watchOnly: false,
  secretKind: "mnemonic",
  backup: doneBackup,
  backupUnknown: false,
  ...over,
});

// Watch-only
check("watch-only cannot send",
  !evaluateRiskAction("send", base({ watchOnly: true, secretKind: "watch", backup: initialBackupStatus("watch") })).allowed);
check("watch-only cannot sign message",
  !evaluateRiskAction("signMessage", base({ watchOnly: true, secretKind: "watch" })).allowed);
check("watch-only send requires selectNonWatchOnly",
  evaluateRiskAction("send", base({ watchOnly: true })).requiredAction === "selectNonWatchOnly");

// Locked
check("locked blocks send with requiredAction unlock",
  evaluateRiskAction("send", base({ locked: true })).requiredAction === "unlock");
check("locked blocks export with unlock",
  evaluateRiskAction("exportSecret", base({ locked: true })).requiredAction === "unlock");

// Unsupported chain
check("unsupported chain blocks send",
  !evaluateRiskAction("send", base({ chainSupported: false })).allowed);

// Fresh unverified mnemonic
check("fresh unverified mnemonic BLOCKS send",
  !evaluateRiskAction("send", base({ backup: freshUnverified })).allowed);
check("fresh unverified mnemonic BLOCKS walletConnect",
  !evaluateRiskAction("walletConnect", base({ backup: freshUnverified })).allowed);
check("fresh unverified mnemonic send requires backup",
  evaluateRiskAction("send", base({ backup: freshUnverified })).requiredAction === "backup");
check("fresh unverified mnemonic WARNS (not blocks) signMessage",
  evaluateRiskAction("signMessage", base({ backup: freshUnverified })).allowed &&
    evaluateRiskAction("signMessage", base({ backup: freshUnverified })).level === "danger");

// Migrated unknown → warn, not block
check("migrated unknown WARNS send (not blocked)",
  evaluateRiskAction("send", base({ backup: freshUnverified, backupUnknown: true })).allowed &&
    evaluateRiskAction("send", base({ backup: freshUnverified, backupUnknown: true })).level === "warning");

// Verified mnemonic → allowed
check("verified mnemonic allows send", evaluateRiskAction("send", base({})).allowed);

// Export secret → danger + unlock gate but allowed to proceed
check("exportSecret is danger + unlock",
  evaluateRiskAction("exportSecret", base({})).level === "danger" &&
    evaluateRiskAction("exportSecret", base({})).requiredAction === "unlock");

console.log("");
if (failures > 0) {
  console.log(`BACKUP / RISK POLICY CHECK FAILED — ${failures} failing check(s)`);
  process.exit(1);
}
console.log("BACKUP / RISK POLICY CHECK PASSED");
