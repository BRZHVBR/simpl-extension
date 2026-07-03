// src/core/security/risk-policy.ts
//
// Central, pure risk-control policy reused across every risky flow (send, swap,
// bridge, signing, WalletConnect, dApp connect, account/chain switch, secret
// export). A single source of truth for "is this action allowed, and if not,
// what does the user need to do first?" — no chrome/DOM deps.

import type { BackupStatus, WalletSecretKind } from "./backup-status";
import { backupNeedsAttention } from "./backup-status";

export type RiskAction =
  | "send"
  | "swap"
  | "bridge"
  | "signMessage"
  | "signTypedData"
  | "walletConnect"
  | "dappConnect"
  | "switchAccount"
  | "switchChain"
  | "exportSecret";

export type RiskLevel = "info" | "warning" | "danger" | "blocked";

export type RiskDecision = {
  allowed: boolean;
  level: RiskLevel;
  reason?: string;
  requiredAction?: "backup" | "unlock" | "selectNonWatchOnly" | "reviewPermission";
};

export type RiskContext = {
  locked: boolean;
  watchOnly: boolean;
  secretKind: WalletSecretKind;
  backup: BackupStatus;
  // For unknown/migrated wallets (no backup metadata) we warn, never block.
  backupUnknown: boolean;
  chainSupported?: boolean;
};

// Actions that move value or produce a signature — the ones a watch-only account
// can never perform and that an unverified fresh mnemonic must not perform.
const VALUE_OR_SIGNING: ReadonlySet<RiskAction> = new Set<RiskAction>([
  "send",
  "swap",
  "bridge",
  "signMessage",
  "signTypedData",
  "walletConnect",
]);

const SIGNING: ReadonlySet<RiskAction> = new Set<RiskAction>([
  "send",
  "swap",
  "bridge",
  "signMessage",
  "signTypedData",
]);

export function evaluateRiskAction(action: RiskAction, ctx: RiskContext): RiskDecision {
  // 1. Watch-only can never sign / move value.
  if (ctx.watchOnly && (VALUE_OR_SIGNING.has(action) || action === "exportSecret")) {
    return {
      allowed: false,
      level: "blocked",
      reason: "Watch-only accounts can view balances and activity, but cannot sign transactions.",
      requiredAction: "selectNonWatchOnly",
    };
  }

  // 2. Locked wallet must be unlocked for any signing / value / export.
  if (ctx.locked && (VALUE_OR_SIGNING.has(action) || action === "exportSecret")) {
    return {
      allowed: false,
      level: "blocked",
      reason: "Unlock your wallet to continue.",
      requiredAction: "unlock",
    };
  }

  // 3. Unsupported chain → block value/signing.
  if (ctx.chainSupported === false && VALUE_OR_SIGNING.has(action)) {
    return { allowed: false, level: "blocked", reason: "This network is not supported." };
  }

  // 4. Export secret → always allowed to proceed to a password/unlock gate, with
  //    a danger-level warning (the caller enforces the password prompt).
  if (action === "exportSecret") {
    return {
      allowed: true,
      level: "danger",
      reason: "Anyone with this secret can control your funds. Never share it.",
      requiredAction: "unlock",
    };
  }

  // 5. Seed-backup policy for mnemonic wallets.
  if (ctx.secretKind === "mnemonic" && backupNeedsAttention(ctx.backup)) {
    // Migrated/unknown wallet → warn + remind, never block (Stage 4 policy).
    if (ctx.backupUnknown) {
      if (VALUE_OR_SIGNING.has(action)) {
        return {
          allowed: true,
          level: "warning",
          reason: "Your recovery phrase is not verified yet. Back it up to avoid losing access.",
          requiredAction: "backup",
        };
      }
      return { allowed: true, level: "info" };
    }

    // Fresh (known-unverified) mnemonic → block value/WC until verified; strong
    // warning for message signing.
    if (VALUE_OR_SIGNING.has(action)) {
      if (SIGNING.has(action) && (action === "signMessage" || action === "signTypedData")) {
        return {
          allowed: true,
          level: "danger",
          reason: "Back up your recovery phrase before signing. simpl cannot recover your wallet if this phrase is lost.",
          requiredAction: "backup",
        };
      }
      return {
        allowed: false,
        level: "blocked",
        reason: "Back up your recovery phrase before sending, swapping, bridging, or connecting to dApps.",
        requiredAction: "backup",
      };
    }
  }

  // 6. dApp connect / switch always route through explicit approval elsewhere;
  //    from a policy standpoint they are allowed to proceed to that approval.
  return { allowed: true, level: "info" };
}
