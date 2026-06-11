// src/popup/routes/SettingsPage.tsx

import { useState, type ReactNode } from "react";
import type { WalletState } from "../../core/storage/storage.types";
import { walletService } from "../../core/wallet/wallet.service";
import { storageRepository } from "../../core/storage/storage.repository";
import { nativeMessagingClient } from "../../core/native/native-messaging.client";
import {
  encodeSecretToBase64,
  getBiometricWalletId,
} from "../../core/security/biometric-unlock.helpers";
import { openFullscreenApp, openSidePanel } from "../surface-actions";
import { getNetworkDisplayName } from "../../core/networks/chain-registry";
import { NetworkIcon } from "../components/NetworkIcon";
import { SelectNetworkPage } from "../components/SelectNetworkPage";

import SecurityCenterPage from "./SecurityCenterPage";

type SettingsPageProps = {
  walletState: WalletState;
  onBack: () => void;
  onChanged: () => void | Promise<void>;
  onRevealSeed: () => void;
  onRevealPrivateKey: () => void;
};

type ChainOption = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  subtitle: string;
};

const CHAIN_OPTIONS: ChainOption[] = [
  {
    chainId: 1,
    name: "Ethereum Mainnet",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 1",
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    nativeSymbol: "BNB",
    subtitle: "BNB · Chain 56",
  },
  {
    chainId: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 8453",
  },
  {
    chainId: 11155111,
    name: "Sepolia",
    nativeSymbol: "ETH",
    subtitle: "ETH · Chain 11155111",
  },
];

// Detect the current surface so the Display section can mark "Open full screen"
// as the active surface (a small "Current" pill instead of a chevron).
function getSurface(): "popup" | "sidepanel" | "fullscreen" {
  const attr = document.documentElement.getAttribute("data-simple-surface");
  if (attr === "fullscreen") return "fullscreen";
  if (attr === "sidepanel") return "sidepanel";
  return "popup";
}

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z"
        fill="none"
        stroke="currentColor"
      />
      <path
        d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.6 8.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A8.6 8.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.6 8.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a8.6 8.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5z"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function PanelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M14 5v14" fill="none" stroke="currentColor" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.5 11a6.5 6.5 0 0 1 13 0M8 11a4 4 0 0 1 8 0v1.5M12 11v3.5M9.2 13.5c0 2.5.6 4 1.3 5.4M14.8 13v2c0 1.6.3 2.8.8 4M6.5 14.5c0 2 .4 3.5 1 4.7"
        fill="none"
        stroke="currentColor"
      />
    </svg>
  );
}

function PhraseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" />
      <path d="M7 9.5h6M7 13h8M7 16.5h4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" />
      <path d="M11 12l8-8M16 4l4 4" fill="none" stroke="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2.5" fill="none" stroke="currentColor" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      className="set-row__chev"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

type RowTone = "brand" | "neutral" | "secure" | "warn" | "danger";

// Clickable settings row: tinted icon + title/subtitle + right-side affordance.
// The whole row is the button so the hit area is the full width.
function ActionRow({
  icon,
  tone = "neutral",
  title,
  subtitle,
  aside,
  onClick,
}: {
  icon: ReactNode;
  tone?: RowTone;
  title: string;
  subtitle: string;
  aside?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className="set-row"
      onClick={onClick}
      disabled={!onClick}
    >
      <span className={`set-row__icon set-row__icon--${tone}`}>{icon}</span>

      <span className="set-row__body">
        <span className="set-row__title">{title}</span>
        <span className="set-row__sub">{subtitle}</span>
      </span>

      <span className="set-row__aside">{aside ?? (onClick ? <Chevron /> : null)}</span>
    </button>
  );
}

// Toggle switch (role=switch) used for the single-row Touch ID control.
function Toggle({
  checked,
  disabled,
  onClick,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`set-toggle${checked ? " set-toggle--on" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="set-toggle__knob" />
    </button>
  );
}

// Non-clickable row wrapper (the right-side control owns the interaction).
function ControlRow({
  icon,
  tone = "neutral",
  title,
  subtitle,
  control,
}: {
  icon: ReactNode;
  tone?: RowTone;
  title: string;
  subtitle: string;
  control: ReactNode;
}) {
  return (
    <div className="set-row set-row--static">
      <span className={`set-row__icon set-row__icon--${tone}`}>{icon}</span>

      <span className="set-row__body">
        <span className="set-row__title">{title}</span>
        <span className="set-row__sub">{subtitle}</span>
      </span>

      <span className="set-row__aside">{control}</span>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <div className="set-section__label">{label}</div>
      <div className="set-card">{children}</div>
    </section>
  );
}

function getActiveChain(chainId: number): ChainOption {
  return (
    CHAIN_OPTIONS.find((chain) => chain.chainId === chainId) ?? {
      chainId,
      name: `Chain ${chainId}`,
      nativeSymbol: "EVM",
      subtitle: `Chain ${chainId}`,
    }
  );
}

export function SettingsPage({
  walletState,
  onBack,
  onChanged,
  onRevealSeed,
  onRevealPrivateKey,
}: SettingsPageProps) {
  const [showSecurityCenter, setShowSecurityCenter] = useState(false);

  const [nativeStatus, setNativeStatus] = useState<string | null>(null);
  const [touchIdPassword, setTouchIdPassword] = useState("");
  // Inline enable form (password) shown when turning Touch ID ON — enabling
  // biometrics requires the wallet password, disabling does not.
  const [touchIdFormOpen, setTouchIdFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [networkSelectorOpen, setNetworkSelectorOpen] = useState(false);

  const biometricEnabled = walletState.settings.biometricUnlock.enabled;
  const walletId = getBiometricWalletId(walletState);
  const activeChain = getActiveChain(walletState.selectedChainId);
  const surface = getSurface();

  async function handleChanged() {
    await onChanged();
  }

  async function selectChain(chainId: number) {
    setNetworkSelectorOpen(false);
    await walletService.setSelectedChainId(chainId);
    await handleChanged();
  }

  // The Touch ID toggle: enabled → disable directly; disabled → reveal the
  // inline password form so the user can confirm and enable.
  function onToggleTouchId() {
    if (saving) return;
    if (biometricEnabled) {
      void disableTouchIdUnlock();
    } else {
      setNativeStatus(null);
      setTouchIdFormOpen((open) => !open);
    }
  }

  async function enableTouchIdUnlock() {
    setNativeStatus(null);

    if (!touchIdPassword) {
      setNativeStatus("Enter wallet password first.");
      return;
    }

    setSaving(true);
    setNativeStatus("Checking wallet password...");

    try {
      await walletService.unlockWallet({
        password: touchIdPassword,
      });
    } catch {
      setNativeStatus("Wrong wallet password.");
      setSaving(false);
      return;
    }

    setNativeStatus("Saving unlock secret to macOS Keychain...");

    const passwordBase64 = encodeSecretToBase64(touchIdPassword);

    const response = await nativeMessagingClient.storeVaultKey(
      walletId,
      passwordBase64,
    );

    if (!response.ok) {
      setNativeStatus(`Touch ID setup error: ${response.error}`);
      setSaving(false);
      return;
    }

    const verifyResponse = await nativeMessagingClient.getVaultKey(walletId);

    if (!verifyResponse.ok) {
      setNativeStatus(`Touch ID verification error: ${verifyResponse.error}`);
      setSaving(false);
      return;
    }

    await storageRepository.updateSettings({
      biometricUnlock: {
        enabled: true,
        credentialId: walletId,
        createdAt: new Date().toISOString(),
      },
    });

    setTouchIdPassword("");
    setTouchIdFormOpen(false);
    setNativeStatus("Touch ID unlock enabled.");
    setSaving(false);

    await handleChanged();
  }

  async function disableTouchIdUnlock() {
    setSaving(true);
    setNativeStatus("Disabling Touch ID unlock...");

    const credentialId =
      walletState.settings.biometricUnlock.credentialId ?? walletId;

    const response = await nativeMessagingClient.deleteVaultKey(credentialId);

    if (!response.ok) {
      setNativeStatus(`Touch ID disable error: ${response.error}`);
      setSaving(false);
      return;
    }

    await storageRepository.updateSettings({
      biometricUnlock: {
        enabled: false,
        credentialId: null,
        createdAt: null,
      },
    });

    setNativeStatus("Touch ID unlock disabled.");
    setSaving(false);

    await handleChanged();
  }

  async function lockWallet() {
    walletService.lockWallet();
    await handleChanged();
  }

  // Destructive wallet removal. The Danger Zone UI + confirmation now live in
  // Security Center; this owns the actual deletion (vault key + wallet clear +
  // state refresh) because walletState / walletId live here. Behavior is
  // unchanged from when the action was in Settings.
  async function clearWalletNow() {
    const credentialId =
      walletState.settings.biometricUnlock.credentialId ?? walletId;

    await nativeMessagingClient.deleteVaultKey(credentialId);
    await walletService.clearWallet();

    await handleChanged();
  }

  // Network selection — the shared full-screen selector (no modal/sheet).
  if (networkSelectorOpen) {
    return (
      <SelectNetworkPage
        purpose="active"
        selectedChainId={walletState.selectedChainId}
        onSelect={(chainId) => void selectChain(chainId)}
        onBack={() => setNetworkSelectorOpen(false)}
      />
    );
  }

  if (showSecurityCenter) {
    return (
      <SecurityCenterPage
        onBack={() => {
          setShowSecurityCenter(false);
          void handleChanged();
        }}
        onClearWallet={clearWalletNow}
        initialSnapshot={{
          settings: walletState.settings,
          biometricUnlock: walletState.settings.biometricUnlock,
          selectedChainId: walletState.selectedChainId,
        }}
      />
    );
  }

  return (
    <div className="ext-popup settings-page" data-screen-label="08 Settings">
        <div className="bar-top">
          <button className="icbtn" type="button" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>

          <div
            style={{
              fontSize: 13,
              fontWeight: 650,
              color: "var(--ink-1)",
            }}
          >
            Settings
          </div>

          <span style={{ flex: 1 }} />

          <button className="icbtn" type="button" onClick={onBack} aria-label="Settings">
            <SettingsIcon />
          </button>
        </div>

        <div className="screen-body settings-body">
          <header className="set-hero">
            <div className="set-hero__title">Wallet settings</div>
            <div className="set-hero__sub">
              Manage security, recovery, display, and wallet session.
            </div>
          </header>

          {nativeStatus ? <div className="set-status">{nativeStatus}</div> : null}

          <div className="set-grid">
            <Section label="Wallet">
              <ActionRow
                icon={
                  <NetworkIcon
                    chainId={walletState.selectedChainId}
                    size={36}
                  />
                }
                tone="brand"
                title={getNetworkDisplayName(walletState.selectedChainId)}
                subtitle={activeChain.subtitle}
                aside={<span className="set-row__change">Change</span>}
                onClick={() => setNetworkSelectorOpen(true)}
              />
            </Section>

            <Section label="Display">
              <ActionRow
                icon={<PanelIcon />}
                tone="neutral"
                title="Open side panel"
                subtitle="Use SIMPLE in a slide-out browser panel."
                aside={
                  surface === "sidepanel" ? (
                    <span className="set-row__pill">Current</span>
                  ) : undefined
                }
                onClick={() => void openSidePanel()}
              />

              <ActionRow
                icon={<ExpandIcon />}
                tone="neutral"
                title="Open full screen"
                subtitle="Open SIMPLE in a dedicated browser tab."
                aside={
                  surface === "fullscreen" ? (
                    <span className="set-row__pill">Current</span>
                  ) : undefined
                }
                onClick={surface === "fullscreen" ? undefined : openFullscreenApp}
              />
            </Section>

            <Section label="Security">
              <ActionRow
                icon={<ShieldIcon />}
                tone="secure"
                title="Security Center"
                subtitle="Backup, biometrics, auto-lock, and privacy controls."
                onClick={() => setShowSecurityCenter(true)}
              />

              <ControlRow
                icon={<FingerprintIcon />}
                tone="secure"
                title="Touch ID"
                subtitle="Unlock this wallet with biometrics on this device."
                control={
                  <Toggle
                    checked={biometricEnabled}
                    disabled={saving}
                    onClick={onToggleTouchId}
                    label="Toggle Touch ID unlock"
                  />
                }
              />

              {!biometricEnabled && touchIdFormOpen ? (
                <div className="set-touchid-form">
                  <input
                    className="input lg"
                    type="password"
                    value={touchIdPassword}
                    placeholder="Wallet password"
                    autoComplete="current-password"
                    onChange={(event) => setTouchIdPassword(event.target.value)}
                  />

                  <div className="set-touchid-form__actions">
                    <button
                      type="button"
                      className="btn secondary lg"
                      onClick={() => {
                        setTouchIdFormOpen(false);
                        setTouchIdPassword("");
                        setNativeStatus(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      className="btn primary lg"
                      onClick={() => void enableTouchIdUnlock()}
                      disabled={saving || !touchIdPassword}
                    >
                      {saving ? "Enabling…" : "Enable"}
                    </button>
                  </div>
                </div>
              ) : null}
            </Section>

            <Section label="Recovery">
              <ActionRow
                icon={<PhraseIcon />}
                tone="warn"
                title="Reveal seed phrase"
                subtitle="View your wallet recovery phrase."
                onClick={onRevealSeed}
              />

              <ActionRow
                icon={<KeyIcon />}
                tone="warn"
                title="Reveal private key"
                subtitle="View the private key for the selected account."
                onClick={onRevealPrivateKey}
              />
            </Section>

            <Section label="Session">
              <ActionRow
                icon={<LockIcon />}
                tone="neutral"
                title="Lock wallet"
                subtitle="Return to the unlock screen."
                onClick={() => void lockWallet()}
              />
            </Section>
          </div>
        </div>
      </div>
  );
}

export default SettingsPage;
