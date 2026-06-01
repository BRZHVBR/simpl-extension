// src/popup/routes/ImportAccountPage.tsx
//
// Full-screen "Import wallet" flow opened from the Accounts page. Adds an
// EXISTING wallet (seed phrase or private key) as a signer account to the
// already-unlocked wallet — distinct from the onboarding ImportWalletPage,
// which restores a wallet from scratch. No modal / bottom sheet: each step is a
// full wallet screen rendered via an internal step state.
//
// Security: the seed phrase / private key is passed straight to walletService,
// which stores it ONLY inside the encrypted vault. Nothing is logged or written
// to plaintext storage, and the inputs are cleared after a successful import.

import { useMemo, useState, type ReactNode } from "react";
import { Wallet } from "ethers";
import { walletService } from "../../core/wallet/wallet.service";
import { mnemonicService } from "../../core/mnemonic/mnemonic.service";
import { SimpleInstrumentIcon } from "../components/SimpleInstrumentIcon";

type ImportAccountPageProps = {
  onBack: () => void;
  // Called after a successful import; the caller refreshes state and navigates.
  onImported: () => void | Promise<void>;
};

type ImportStep = "choose" | "seed" | "key" | "success";

function BackIcon() {
  return <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>;
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const MAX_LABEL_LENGTH = 32;

// Optional account label. Mirrors the AccountDetails rename rules (trim, cap at
// 32) but allows empty — an empty label falls back to the service default.
// Returns the trimmed label (or null to use the default) on success.
type LabelResult =
  | { ok: true; label: string | null }
  | { ok: false; error: string };

function normalizeAccountLabel(input: string): LabelResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, label: null };
  if (trimmed.length > MAX_LABEL_LENGTH) {
    return { ok: false, error: "Name must be 32 characters or less." };
  }
  return { ok: true, label: trimmed };
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="bar-top">
      <button className="icbtn" type="button" onClick={onBack} aria-label="Back">
        <BackIcon />
      </button>
      <span className="import-acct-title">{title}</span>
      <span style={{ width: 32, flexShrink: 0 }} />
    </div>
  );
}

function PhraseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="5" width="17" height="14" rx="3" />
      <path d="M7 9.5h6M7 13h8M7 16.5h4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.2 11.2l8.3 8.3M16 16l2-2M13.7 13.7l1.6 1.6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3z" />
      <path d="M9.5 12l1.8 1.8 3.2-3.6" />
    </svg>
  );
}

// Compact hero — icon in a soft neutral circle + title + subtitle, laid out as
// a flex row like the Receive / Asset screens.
function ImportHero({
  icon,
  title,
  subtitle,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="import-acct-hero2">
      <span className="import-acct-hero2__icon">{icon}</span>
      <div className="import-acct-hero2__text">
        <div className="import-acct-hero2__title">{title}</div>
        <div className="import-acct-hero2__sub">{subtitle}</div>
      </div>
    </div>
  );
}

// Compact warm security notice card.
function SecurityNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="import-acct-notice">
      <span className="import-acct-notice__icon">
        <ShieldIcon />
      </span>
      <div>
        <div className="import-acct-notice__title">{title}</div>
        <div className="import-acct-notice__body">{body}</div>
      </div>
    </div>
  );
}

export function ImportAccountPage({ onBack, onImported }: ImportAccountPageProps) {
  const [step, setStep] = useState<ImportStep>("choose");

  // Shared
  const [walletPassword, setWalletPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What was imported, for the success screen copy.
  const [importedKind, setImportedKind] = useState<"seed" | "key">("seed");
  const [importedCustomName, setImportedCustomName] = useState<string | null>(
    null,
  );

  const nameCheck = normalizeAccountLabel(accountName);
  const nameError = nameCheck.ok ? null : nameCheck.error;

  // Seed step
  const [seedPhrase, setSeedPhrase] = useState("");
  // Private key step
  const [privateKey, setPrivateKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);

  const seedWordCount = useMemo(
    () => mnemonicService.getWordCount(seedPhrase),
    [seedPhrase],
  );
  const seedValidation = useMemo(
    () => mnemonicService.validateMnemonic(seedPhrase),
    [seedPhrase],
  );

  // Live address preview for a structurally valid private key.
  const keyPreviewAddress = useMemo(() => {
    const trimmed = privateKey.trim();
    const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
    try {
      return new Wallet(withPrefix).address;
    } catch {
      return null;
    }
  }, [privateKey]);

  function goChoose() {
    setError(null);
    setStep("choose");
  }

  function clearSecrets() {
    setSeedPhrase("");
    setPrivateKey("");
    setWalletPassword("");
    setAccountName("");
  }

  async function handleImportSeed() {
    setError(null);

    if (!seedValidation.valid) {
      setError(
        seedPhrase.trim()
          ? seedValidation.message
          : "Enter a valid recovery phrase.",
      );
      return;
    }

    if (!walletPassword) {
      setError("Enter your wallet password to confirm.");
      return;
    }

    const label = normalizeAccountLabel(accountName);
    if (!label.ok) {
      setError(label.error);
      return;
    }

    setImporting(true);
    try {
      await walletService.importMnemonicAccount({
        mnemonic: seedPhrase,
        label: label.label ?? undefined,
        password: walletPassword,
      });
      setImportedKind("seed");
      setImportedCustomName(label.label);
      clearSecrets();
      setStep("success");
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : String(importError),
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleImportKey() {
    setError(null);

    if (!keyPreviewAddress) {
      setError("Enter a valid EVM private key.");
      return;
    }

    if (!walletPassword) {
      setError("Enter your wallet password to confirm.");
      return;
    }

    const label = normalizeAccountLabel(accountName);
    if (!label.ok) {
      setError(label.error);
      return;
    }

    setImporting(true);
    try {
      await walletService.importPrivateKeyAccount({
        privateKey,
        label: label.label ?? undefined,
        password: walletPassword,
      });
      setImportedKind("key");
      setImportedCustomName(label.label);
      clearSecrets();
      setStep("success");
    } catch (importError) {
      setError(
        importError instanceof Error ? importError.message : String(importError),
      );
    } finally {
      setImporting(false);
    }
  }

  // ── Success ──
  if (step === "success") {
    const successTitle =
      importedKind === "seed" ? "Wallet imported" : "Account imported";
    const successSub = importedCustomName
      ? `${importedCustomName} was added as a signer account.`
      : "Signer account added.";

    return (
      <div className="ext-popup import-acct-page" data-screen-label="Import done">
        <Header title="Imported" onBack={() => void onImported()} />
        <div className="screen-body import-acct-body">
          <div className="import-acct-success">
            <div className="import-acct-success__check" aria-hidden="true">
              ✓
            </div>
            <div className="import-acct-success__title">{successTitle}</div>
            <div className="import-acct-success__sub">{successSub}</div>
          </div>

          <button
            className="btn primary lg full"
            type="button"
            onClick={() => void onImported()}
          >
            Use this account
          </button>
        </div>
      </div>
    );
  }

  // ── Seed phrase ──
  if (step === "seed") {
    const seedInvalid = seedPhrase.trim().length > 0 && !seedValidation.valid;
    const canImport =
      seedPhrase.trim().length > 0 && walletPassword.length > 0 && nameCheck.ok;

    return (
      <div className="ext-popup import-acct-page" data-screen-label="Import seed">
        <Header title="Seed phrase" onBack={goChoose} />
        <div className="screen-body import-acct-body">
          <ImportHero
            icon={<PhraseIcon />}
            title="Import recovery phrase"
            subtitle="Restore accounts from a wallet you own."
          />

          <SecurityNotice
            title="Keep it private"
            body="Anyone with this phrase can control your funds."
          />

          <div className="import-acct-field">
            <div className="import-acct-label-row">
              <span className="import-acct-field-label">Recovery phrase</span>
              <span className="import-acct-wordcount">
                {seedWordCount} {seedWordCount === 1 ? "word" : "words"}
              </span>
            </div>

            <textarea
              className="import-acct-textarea"
              placeholder="Enter 12, 18, or 24 words"
              value={seedPhrase}
              onChange={(event) => setSeedPhrase(event.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              rows={3}
            />

            {seedInvalid ? (
              <div className="send-field-error">{seedValidation.message}</div>
            ) : (
              <p className="import-acct-help">Separate each word with a space.</p>
            )}
          </div>

          <div className="import-acct-field">
            <div className="import-acct-label-row">
              <label
                className="import-acct-field-label"
                htmlFor="import-seed-name"
              >
                Account name
              </label>
              <span className="import-acct-optional">Optional</span>
            </div>
            <input
              id="import-seed-name"
              className="import-acct-input"
              type="text"
              placeholder="Name this wallet"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
            />
            {nameError ? (
              <div className="send-field-error">{nameError}</div>
            ) : (
              <p className="import-acct-help">You can rename it later.</p>
            )}
          </div>

          <div className="import-acct-field">
            <label className="import-acct-field-label" htmlFor="import-seed-pwd">
              Wallet password
            </label>
            <input
              id="import-seed-pwd"
              className="import-acct-input"
              type="password"
              placeholder="Enter wallet password"
              value={walletPassword}
              onChange={(event) => setWalletPassword(event.target.value)}
              autoComplete="current-password"
            />
            <p className="import-acct-help">
              Required to encrypt imported accounts.
            </p>
          </div>

          {error ? <div className="send-field-error">{error}</div> : null}

          <button
            className="btn primary lg full"
            type="button"
            disabled={importing || !canImport}
            onClick={() => void handleImportSeed()}
          >
            {importing ? "Importing…" : "Import wallet"}
          </button>
        </div>
      </div>
    );
  }

  // ── Private key ──
  if (step === "key") {
    const keyEntered = privateKey.trim().length > 0;
    const keyInvalid = keyEntered && !keyPreviewAddress;
    const canImport =
      Boolean(keyPreviewAddress) && walletPassword.length > 0 && nameCheck.ok;

    return (
      <div className="ext-popup import-acct-page" data-screen-label="Import key">
        <Header title="Private key" onBack={goChoose} />
        <div className="screen-body import-acct-body">
          <ImportHero
            icon={<KeyIcon />}
            title="Import private key"
            subtitle="Add one EVM signer account."
          />

          <SecurityNotice
            title="Keep it private"
            body="A private key gives full access to this account."
          />

          <div className="import-acct-field">
            <label className="import-acct-field-label" htmlFor="import-key-input">
              Private key
            </label>
            <div className="import-acct-key-wrap">
              <input
                id="import-key-input"
                className="import-acct-input import-acct-input--key"
                type={keyVisible ? "text" : "password"}
                placeholder="0x..."
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                className="import-acct-reveal"
                onClick={() => setKeyVisible((visible) => !visible)}
                aria-label={keyVisible ? "Hide private key" : "Show private key"}
              >
                {keyVisible ? "Hide" : "Show"}
              </button>
            </div>

            {keyInvalid ? (
              <div className="send-field-error">
                Enter a valid EVM private key.
              </div>
            ) : (
              <p className="import-acct-help">Imports one account only.</p>
            )}
          </div>

          {keyPreviewAddress ? (
            <div className="import-acct-preview">
              <div className="import-acct-preview__label">Address</div>
              <div className="import-acct-preview__value">
                <span>{shortAddress(keyPreviewAddress)}</span>
                <span className="import-acct-preview__check" aria-hidden="true">
                  ✓
                </span>
              </div>
            </div>
          ) : null}

          <div className="import-acct-field">
            <div className="import-acct-label-row">
              <label
                className="import-acct-field-label"
                htmlFor="import-key-name"
              >
                Account name
              </label>
              <span className="import-acct-optional">Optional</span>
            </div>
            <input
              id="import-key-name"
              className="import-acct-input"
              type="text"
              placeholder="Name this account"
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              autoComplete="off"
              autoCapitalize="words"
              autoCorrect="off"
              spellCheck={false}
            />
            {nameError ? (
              <div className="send-field-error">{nameError}</div>
            ) : (
              <p className="import-acct-help">You can rename it later.</p>
            )}
          </div>

          <div className="import-acct-field">
            <label className="import-acct-field-label" htmlFor="import-key-pwd">
              Wallet password
            </label>
            <input
              id="import-key-pwd"
              className="import-acct-input"
              type="password"
              placeholder="Enter wallet password"
              value={walletPassword}
              onChange={(event) => setWalletPassword(event.target.value)}
              autoComplete="current-password"
            />
            <p className="import-acct-help">
              Required to encrypt imported account.
            </p>
          </div>

          {error ? <div className="send-field-error">{error}</div> : null}

          <button
            className="btn primary lg full"
            type="button"
            disabled={importing || !canImport}
            onClick={() => void handleImportKey()}
          >
            {importing ? "Importing…" : "Import account"}
          </button>
        </div>
      </div>
    );
  }

  // ── Chooser ──
  return (
    <div className="ext-popup import-acct-page" data-screen-label="Import wallet">
      <Header title="Import wallet" onBack={onBack} />
      <div className="screen-body import-acct-body">
        <div className="import-acct-hero">
          <div className="import-acct-hero__title">Import existing wallet</div>
          <div className="import-acct-hero__sub">
            Use a seed phrase or private key to add a signer account.
          </div>
        </div>

        <button
          type="button"
          className="acct-action-card import-acct-option"
          onClick={() => {
            setError(null);
            setStep("seed");
          }}
        >
          <SimpleInstrumentIcon instrument="security" />
          <div className="body">
            <div className="nm">Seed phrase</div>
            <div className="sub">Import accounts from a recovery phrase.</div>
          </div>
          <div className="num">
            <span className="acct-chevron">
              <ChevronIcon />
            </span>
          </div>
        </button>

        <button
          type="button"
          className="acct-action-card import-acct-option"
          onClick={() => {
            setError(null);
            setStep("key");
          }}
        >
          <SimpleInstrumentIcon instrument="developer" />
          <div className="body">
            <div className="nm">Private key</div>
            <div className="sub">Import one account.</div>
          </div>
          <div className="num">
            <span className="acct-chevron">
              <ChevronIcon />
            </span>
          </div>
        </button>

        <div className="import-acct-warning">
          Your seed phrase or private key gives full access to your funds. Never
          import a wallet you do not trust.
        </div>
      </div>
    </div>
  );
}

export default ImportAccountPage;
