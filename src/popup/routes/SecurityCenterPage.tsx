import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { walletService } from "../../core/wallet/wallet.service";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../components/SimpleInstrumentIcon";

import SeedBackupVerificationPage from "./SeedBackupVerificationPage";
import ConnectedSitesPage from "./ConnectedSitesPage";

type SecurityStatus = "secure" | "warning" | "danger" | "unknown";

type Snapshot = Record<string, unknown>;

type SecurityCenterPageProps = {
  onBack?: () => void;
  initialSnapshot?: Snapshot;
};

type SecurityCheck = {
  id: string;
  title: string;
  subtitle: string;
  status: SecurityStatus;
  value: string;
  onClick?: () => void | Promise<void>;
};

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60] as const;

function getChrome() {
  return (globalThis as unknown as { chrome?: any }).chrome;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readLocalStorageSnapshot(): Record<string, unknown> {
  const storage = (globalThis as unknown as { localStorage?: Storage }).localStorage;

  if (!storage) {
    return {};
  }

  const result: Record<string, unknown> = {};

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);

    if (!key) {
      continue;
    }

    const value = storage.getItem(key);
    result[key] = value == null ? value : parseMaybeJson(value);
  }

  return result;
}

function getByPath(source: Snapshot, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[part];
  }, source);
}

function firstBoolean(source: Snapshot, paths: string[]): boolean | undefined {
  for (const path of paths) {
    const value = getByPath(source, path);

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      if (value.toLowerCase() === "true") {
        return true;
      }

      if (value.toLowerCase() === "false") {
        return false;
      }
    }
  }

  return undefined;
}

function firstNumber(source: Snapshot, paths: string[]): number | undefined {
  for (const path of paths) {
    const value = getByPath(source, path);

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function hasAny(source: Snapshot, paths: string[]): boolean {
  return paths.some((path) => {
    const value = getByPath(source, path);

    if (value == null) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }

    return true;
  });
}

function chromeStorageGetAll(): Promise<Record<string, unknown>> {
  const chrome = getChrome();

  if (!chrome?.storage?.local?.get) {
    return Promise.resolve({});
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(null, (items: Record<string, unknown>) => {
        if (chrome.runtime?.lastError) {
          resolve({});
          return;
        }

        resolve(items ?? {});
      });
    } catch {
      resolve({});
    }
  });
}

function chromeStorageSet(items: Record<string, unknown>): Promise<void> {
  const chrome = getChrome();

  if (!chrome?.storage?.local?.set) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(items, () => resolve());
    } catch {
      resolve();
    }
  });
}

async function readSnapshot(): Promise<Snapshot> {
  const chromeStorage = await chromeStorageGetAll();
  const localStorageSnapshot = readLocalStorageSnapshot();

  return {
    ...chromeStorage,
    __localStorage: localStorageSnapshot,
  };
}

function mergeSnapshots(storageSnapshot: Snapshot, initialSnapshot: Snapshot): Snapshot {
  const initialWalletState = asRecord(initialSnapshot.walletState);
  const storageWalletState = asRecord(storageSnapshot.walletState);

  const initialWalletStateSettings = asRecord(initialWalletState.settings);
  const storageWalletStateSettings = asRecord(storageWalletState.settings);

  const initialSettings = asRecord(initialSnapshot.settings);
  const storageSettings = asRecord(storageSnapshot.settings);

  // Important: storage wins over initialSnapshot.
  // initialSnapshot comes from SettingsPage and may be stale after local changes.
  const settings = {
    ...initialWalletStateSettings,
    ...initialSettings,
    ...storageWalletStateSettings,
    ...storageSettings,
  };

  const securitySettings = {
    ...asRecord(initialSnapshot.securitySettings),
    ...asRecord(storageSnapshot.securitySettings),
  };

  return {
    ...initialSnapshot,
    ...storageSnapshot,
    settings,
    securitySettings,
    walletState: {
      ...initialWalletState,
      ...storageWalletState,
      settings,
    },
    biometricUnlock:
      storageSnapshot.biometricUnlock ??
      initialSnapshot.biometricUnlock ??
      settings.biometricUnlock,
  };
}

async function updateSecuritySettings(patch: Record<string, unknown>): Promise<Snapshot> {
  const current = await readSnapshot();

  const securitySettings = {
    ...asRecord(current.securitySettings),
    ...patch,
  };

  const currentSettings = asRecord(current.settings);
  const currentSettingsSecurity = asRecord(currentSettings.security);

  const nextSettings =
    Object.keys(currentSettings).length > 0
      ? {
          ...currentSettings,
          security: {
            ...currentSettingsSecurity,
            ...patch,
          },
        }
      : current.settings;

  const payload: Record<string, unknown> = {
    securitySettings,
  };

  if (nextSettings) {
    payload.settings = nextSettings;
  }

  await chromeStorageSet(payload);

  try {
    localStorage.setItem("securitySettings", JSON.stringify(securitySettings));
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }

  return readSnapshot();
}

async function updateRootSettings(
  patch: Record<string, unknown>,
  baseSnapshot: Snapshot = {},
): Promise<Snapshot> {
  const storageSnapshot = await readSnapshot();
  const mergedSnapshot = mergeSnapshots(storageSnapshot, baseSnapshot);

  const walletState = asRecord(mergedSnapshot.walletState);
  const walletStateSettings = asRecord(walletState.settings);

  const nextSettings = {
    ...walletStateSettings,
    ...asRecord(mergedSnapshot.settings),
    ...patch,
  };

  const payload: Record<string, unknown> = {
    settings: nextSettings,
  };

  if (Object.keys(walletState).length > 0) {
    payload.walletState = {
      ...walletState,
      settings: {
        ...walletStateSettings,
        ...nextSettings,
      },
    };
  }

  await chromeStorageSet(payload);

  try {
    localStorage.setItem("settings", JSON.stringify(nextSettings));

    if (payload.walletState) {
      localStorage.setItem("walletState", JSON.stringify(payload.walletState));
    }
  } catch {
    // Local storage can be unavailable in some extension surfaces.
  }

  const nextSnapshot = await readSnapshot();

  return mergeSnapshots(nextSnapshot, {
    ...baseSnapshot,
    settings: nextSettings,
    walletState: payload.walletState ?? {
      settings: nextSettings,
    },
  });
}

function getStatusColor(status: SecurityStatus): string {
  switch (status) {
    case "secure":
      return "var(--secure, #3f6f2c)";
    case "warning":
      return "#8a6200";
    case "danger":
      return "#a23b2d";
    case "unknown":
      return "var(--text-secondary, #777777)";
    default:
      return "var(--text-secondary, #777777)";
  }
}

const styles: Record<string, CSSProperties> = {
  page: {
    height: "100vh",
    minHeight: "100vh",
    width: "100%",
    background: "var(--bg, #ffffff)",
    color: "var(--text-primary, #111111)",
    overflowY: "auto",
    overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
  },
  topbar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    height: 56,
    borderBottom: "1px solid var(--border, #e8e8e8)",
    background: "var(--bg, #ffffff)",
  },
  topbarInner: {
    width: "100%",
    maxWidth: 680,
    height: "100%",
    margin: "0 auto",
    padding: "0 12px",
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "44px 1fr 44px",
    alignItems: "center",
  },
  backButton: {
    width: 36,
    height: 36,
    border: 0,
    background: "transparent",
    color: "var(--text-primary, #111111)",
    cursor: "pointer",
    fontSize: 22,
    lineHeight: "36px",
    padding: 0,
  },
  topbarTitle: {
    fontSize: 15,
    lineHeight: "20px",
    fontWeight: 800,
  },
  content: {
    width: "100%",
    maxWidth: 680,
    margin: "0 auto",
    padding: "20px 12px 88px",
    boxSizing: "border-box",
  },
  section: {
    marginTop: 28,
  },
  sectionLabel: {
    margin: "0 0 12px",
    color: "var(--text-primary, #111111)",
    fontSize: 12,
    lineHeight: "16px",
    letterSpacing: "0.2em",
    textTransform: "uppercase",
  },
  note: {
    marginTop: 14,
    padding: 14,
    borderRadius: 14,
    background: "var(--bg-sunken, #f7f7f4)",
    color: "var(--text-secondary, #666666)",
    fontSize: 12,
    lineHeight: "18px",
  },
};

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={styles.sectionLabel}>{children}</div>;
}

type RowProps = {
  icon?: ReactNode;
  instrument?: SimpleInstrument;
  title: string;
  subtitle?: string;
  value?: string;
  valueColor?: string;
  onClick?: () => void | Promise<void>;
};

function Row({ icon, instrument, title, subtitle, value, valueColor, onClick }: RowProps) {
  const body = (
    <>
      {instrument ? (
        <SimpleInstrumentIcon instrument={instrument} />
      ) : (
        <div className="tok">{icon}</div>
      )}

      <div className="body">
        <div className="nm">{title}</div>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>

      <div className="num">
        <div className="v" style={valueColor ? { color: valueColor } : undefined}>
          {value ?? (onClick ? "›" : "")}
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="row"
        onClick={() => void onClick()}
        style={{
          width: "100%",
          border: 0,
          background: "transparent",
          textAlign: "left",
        }}
      >
        {body}
      </button>
    );
  }

  return <div className="row">{body}</div>;
}

export default function SecurityCenterPage({
  onBack,
  initialSnapshot = {},
}: SecurityCenterPageProps) {
  const pageRef = useRef<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [showSeedBackupVerification, setShowSeedBackupVerification] = useState(false);
  const [isAutoLockSheetOpen, setIsAutoLockSheetOpen] = useState(false);
  const [showConnectedSites, setShowConnectedSites] = useState(false);

  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    let isMounted = true;

    readSnapshot().then((nextSnapshot) => {
      if (!isMounted) {
        return;
      }

      setSnapshot(mergeSnapshots(nextSnapshot, initialSnapshot));
    });

    return () => {
      isMounted = false;
    };
  }, [initialSnapshot]);

  const securityState = useMemo(() => {
    const encryptedVaultExists = hasAny(snapshot, [
      "encryptedVault",
      "vault.encryptedVault",
      "vault.ciphertext",
      "walletVault",
      "encryptedWallet",
      "__localStorage.encryptedVault",
      "__localStorage.walletVault",
      "__localStorage.encryptedWallet",
    ]);

    const autoLockMinutes = firstNumber(snapshot, [
      "settings.autoLockMinutes",
      "walletState.settings.autoLockMinutes",
      "walletSettings.autoLockMinutes",
      "securitySettings.autoLockMinutes",
      "autoLockMinutes",
      "__localStorage.settings.autoLockMinutes",
      "__localStorage.walletSettings.autoLockMinutes",
    ]);

    const seedBackupConfirmed = firstBoolean(snapshot, [
      "securitySettings.seedBackupConfirmed",
      "settings.security.seedBackupConfirmed",
      "walletState.settings.security.seedBackupConfirmed",
      "seedBackupConfirmed",
      "__localStorage.securitySettings.seedBackupConfirmed",
      "__localStorage.settings.security.seedBackupConfirmed",
    ]);

    const seedBackupVerified = firstBoolean(snapshot, [
      "securitySettings.seedBackupVerified",
      "settings.security.seedBackupVerified",
      "walletState.settings.security.seedBackupVerified",
      "seedBackupVerified",
      "__localStorage.securitySettings.seedBackupVerified",
      "__localStorage.settings.security.seedBackupVerified",
    ]);

    const hideBalances = firstBoolean(snapshot, [
      "settings.hideBalances",
      "walletState.settings.hideBalances",
      "walletSettings.hideBalances",
      "hideBalances",
      "__localStorage.settings.hideBalances",
      "__localStorage.walletSettings.hideBalances",
    ]);

    const rawConnectedSites = snapshot["connectedSites"];
    const connectedSitesCount = Array.isArray(rawConnectedSites)
      ? (rawConnectedSites as unknown[]).length
      : 0;

    return {
      encryptedVaultExists,
      autoLockMinutes,
      seedBackupConfirmed,
      seedBackupVerified,
      hideBalances,
      connectedSitesCount,
    };
  }, [snapshot]);

  const handleSeedBackupVerified = async () => {
    const nextSnapshot = await updateSecuritySettings({
      seedBackupConfirmed: true,
      seedBackupConfirmedAt: new Date().toISOString(),
      seedBackupVerified: true,
      seedBackupVerifiedAt: new Date().toISOString(),
    });

    setSnapshot(mergeSnapshots(nextSnapshot, initialSnapshot));
    setShowSeedBackupVerification(false);
  };

  const changeAutoLock = () => {
    setIsAutoLockSheetOpen(true);
  };

  const applyAutoLock = async (minutes: number) => {
    const nextSnapshot = await updateRootSettings(
      {
        autoLockMinutes: minutes,
      },
      initialSnapshot,
    );

    setSnapshot(nextSnapshot);
    setIsAutoLockSheetOpen(false);
  };

  const toggleHideBalances = async () => {
    const nextHideBalances = securityState.hideBalances !== true;

    const nextSnapshot = await updateRootSettings(
      {
        hideBalances: nextHideBalances,
      },
      initialSnapshot,
    );

    setSnapshot(nextSnapshot);
  };

  const lockWallet = async () => {
    walletService.lockWallet();

    window.dispatchEvent(
      new CustomEvent("simple-wallet:lock", {
        detail: {
          source: "security-center",
        },
      }),
    );

    onBack?.();
  };

  const checks: SecurityCheck[] = useMemo(() => {
    const autoLockIsStrong =
      typeof securityState.autoLockMinutes === "number" &&
      securityState.autoLockMinutes > 0 &&
      securityState.autoLockMinutes <= 15;

    const autoLockIsWeak =
      typeof securityState.autoLockMinutes === "number" &&
      securityState.autoLockMinutes > 15;

    const list: SecurityCheck[] = [
      {
        id: "encrypted-vault",
        title: "Encrypted vault",
        subtitle: securityState.encryptedVaultExists
          ? "Wallet secrets are stored in an encrypted local vault."
          : "Encrypted vault was not detected in local wallet storage.",
        status: securityState.encryptedVaultExists ? "secure" : "danger",
        value: securityState.encryptedVaultExists ? "Secure" : "Risk",
      },
      {
        id: "auto-lock",
        title: "Auto-lock",
        subtitle:
          typeof securityState.autoLockMinutes === "number"
            ? `Wallet locks after ${securityState.autoLockMinutes} min of inactivity.`
            : "Auto-lock setting was not detected.",
        status: autoLockIsStrong ? "secure" : autoLockIsWeak ? "warning" : "unknown",
        value:
          typeof securityState.autoLockMinutes === "number"
            ? `${securityState.autoLockMinutes} min`
            : "Unknown",
        onClick: changeAutoLock,
      },
      {
        id: "recovery-backup",
        title: "Recovery phrase backup",
        subtitle:
          securityState.seedBackupVerified === true
            ? "Recovery phrase backup was verified."
            : securityState.seedBackupConfirmed === true
              ? "Backup was confirmed, but word check is not completed."
              : "Select random recovery words to verify backup.",
        status: securityState.seedBackupVerified === true ? "secure" : "warning",
        value: securityState.seedBackupVerified === true ? "Verified" : "Review",
        onClick: () => setShowSeedBackupVerification(true),
      },
    ];

    if (typeof securityState.hideBalances === "boolean") {
      list.push({
        id: "hide-balances",
        title: "Hide balances",
        subtitle: securityState.hideBalances
          ? "Balance privacy mode is enabled."
          : "Balance privacy mode is disabled.",
        status: securityState.hideBalances ? "secure" : "warning",
        value: securityState.hideBalances ? "On" : "Off",
        onClick: toggleHideBalances,
      });
    }

    return list;
  }, [securityState, initialSnapshot]);

  const checksById = new Map(checks.map((check) => [check.id, check]));

  const deviceCheckIds = ["encrypted-vault", "auto-lock"] as const;
  const recoveryCheckIds = ["recovery-backup"] as const;
  const privacyCheckIds = ["hide-balances"] as const;

  const renderCheckRow = (check: SecurityCheck) => (
    <Row
      key={check.id}
      instrument="security"
      title={check.title}
      subtitle={check.subtitle}
      value={check.value}
      valueColor={getStatusColor(check.status)}
      onClick={check.onClick}
    />
  );

  if (showConnectedSites) {
    return <ConnectedSitesPage onBack={() => setShowConnectedSites(false)} />;
  }

  if (showSeedBackupVerification) {
    return (
      <SeedBackupVerificationPage
        onBack={() => setShowSeedBackupVerification(false)}
        onVerified={handleSeedBackupVerified}
      />
    );
  }

  return (
    <main ref={pageRef} style={styles.page}>
      <header style={styles.topbar}>
        <div style={styles.topbarInner}>
          <button type="button" onClick={onBack} style={styles.backButton} aria-label="Back">
            <BackIcon />
          </button>
          <div style={styles.topbarTitle}>Security Center</div>
          <div />
        </div>
      </header>

      <section style={styles.content}>
        <section style={{ ...styles.section, marginTop: 0 }}>
          <SectionLabel>Device security</SectionLabel>

          <div className="row-list">
            {deviceCheckIds
              .map((id) => checksById.get(id))
              .filter((check): check is SecurityCheck => Boolean(check))
              .map(renderCheckRow)}

            <Row
              instrument="security"
              title="Lock wallet"
              subtitle="Return to unlock screen."
              value="›"
              onClick={lockWallet}
            />
          </div>
        </section>

        <section style={styles.section}>
          <SectionLabel>Recovery</SectionLabel>

          <div className="row-list">
            {recoveryCheckIds
              .map((id) => checksById.get(id))
              .filter((check): check is SecurityCheck => Boolean(check))
              .map(renderCheckRow)}
          </div>
        </section>

        <section style={styles.section}>
          <SectionLabel>Privacy</SectionLabel>

          <div className="row-list">
            {privacyCheckIds
              .map((id) => checksById.get(id))
              .filter((check): check is SecurityCheck => Boolean(check))
              .map(renderCheckRow)}

            <Row
              instrument="dapps"
              title="Connected sites"
              subtitle={
                securityState.connectedSitesCount > 0
                  ? `${securityState.connectedSitesCount} site${securityState.connectedSitesCount !== 1 ? "s" : ""} connected. Review regularly.`
                  : "No dApps connected yet."
              }
              value={securityState.connectedSitesCount > 0 ? String(securityState.connectedSitesCount) : "None"}
              valueColor={
                securityState.connectedSitesCount > 0
                  ? "var(--text-secondary, #777777)"
                  : getStatusColor("secure")
              }
              onClick={() => setShowConnectedSites(true)}
            />


          </div>

        </section>

        <section style={styles.section}>
          <SectionLabel>Security tips</SectionLabel>

          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {(
              [
                "Verify your seed phrase backup by selecting random words to confirm you wrote them down correctly.",
                "Review connected sites regularly and disconnect any you no longer use.",
              ] as const
            ).map((tip, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  background: "var(--bg-sunken, #f7f7f4)",
                  fontSize: 12,
                  lineHeight: "18px",
                  color: "var(--text-secondary, #666666)",
                }}
              >
                {tip}
              </div>
            ))}
          </div>
        </section>
      </section>

      {isAutoLockSheetOpen ? (
        <div
          role="presentation"
          onClick={() => setIsAutoLockSheetOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "grid",
            alignItems: "end",
            background: "rgba(0, 0, 0, 0.24)",
            padding: "0 0 16px",
            boxSizing: "border-box",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Auto-lock options"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 680,
              margin: "0 auto",
              padding: "0 12px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                border: "1px solid var(--border, #dedede)",
                borderRadius: 24,
                background: "var(--bg, #ffffff)",
                boxShadow: "0 24px 80px rgba(0, 0, 0, 0.18)",
                padding: 16,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "start",
                  marginBottom: 14,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 18,
                      lineHeight: "24px",
                      fontWeight: 850,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Auto-lock
                  </div>

                  <div
                    style={{
                      marginTop: 4,
                      color: "var(--text-secondary, #777777)",
                      fontSize: 13,
                      lineHeight: "19px",
                    }}
                  >
                    Choose when SIMPLE locks after inactivity.
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Close auto-lock options"
                  onClick={() => setIsAutoLockSheetOpen(false)}
                  style={{
                    width: 36,
                    height: 36,
                    border: "1px solid var(--border, #dedede)",
                    borderRadius: 999,
                    background: "var(--bg, #ffffff)",
                    color: "var(--text-primary, #111111)",
                    cursor: "pointer",
                    fontSize: 20,
                    lineHeight: "20px",
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </div>

              <div className="row-list">
                {AUTO_LOCK_OPTIONS.map((minutes) => {
                  const selected = securityState.autoLockMinutes === minutes;

                  return (
                    <Row
                      key={minutes}
                      instrument="security"
                      title={`${minutes} min`}
                      subtitle={
                        minutes <= 5
                          ? "Best for maximum protection."
                          : minutes <= 15
                            ? "Recommended for everyday use."
                            : "More convenient, less strict."
                      }
                      value={selected ? "Selected" : "›"}
                      valueColor={selected ? getStatusColor("secure") : undefined}
                      onClick={() => applyAutoLock(minutes)}
                    />
                  );
                })}
              </div>

              <button
                type="button"
                className="btn secondary lg full"
                onClick={() => setIsAutoLockSheetOpen(false)}
                style={{ marginTop: 12 }}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}


    </main>
  );
}
