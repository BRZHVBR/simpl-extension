// src/popup/routes/AddAccountPage.tsx
//
// Full-screen "Add account" chooser, opened from the Accounts page header "+"
// and the bottom discovery card. A normal internal wallet screen (Back + title,
// no modal / bottom sheet / dimmed overlay) so it behaves the same in popup,
// fullscreen, and sidepanel surfaces.
//
// Presentation only — it reuses the existing add / import / watch handlers:
//   • Add account   → walletService.addAccount() (next account from this wallet)
//   • Import wallet  → existing ImportAccountPage flow (seed phrase / private key)
//   • Add watch      → existing AddWatchWalletPage flow (watch-only address)
// No key material is ever handled here.

import { useState } from "react";
import {
  SimpleInstrumentIcon,
  type SimpleInstrument,
} from "../components/SimpleInstrumentIcon";
import { walletService } from "../../core/wallet/wallet.service";
import "./AccountPage.css";

type AddAccountPageProps = {
  onBack: () => void;
  // Called after the next account is created; the caller refreshes state.
  onChanged: () => void | Promise<void>;
  onImportWallet: () => void;
  onAddWatchWallet: () => void;
};

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 19l-7-7 7-7" />
    </svg>
  );
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

// One option card — shared row/card style (matches the Import wallet chooser).
function OptionCard({
  instrument,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  instrument: SimpleInstrument;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="acct-action-card import-acct-option"
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.6, cursor: "default" } : undefined}
    >
      <SimpleInstrumentIcon instrument={instrument} />
      <div className="body">
        <div className="nm">{title}</div>
        <div className="sub">{subtitle}</div>
      </div>
      <div className="num">
        <span className="acct-chevron">
          <ChevronIcon />
        </span>
      </div>
    </button>
  );
}

export function AddAccountPage({
  onBack,
  onChanged,
  onImportWallet,
  onAddWatchWallet,
}: AddAccountPageProps) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAddAccount() {
    if (adding) return;
    try {
      setError(null);
      setAdding(true);
      await walletService.addAccount();
      await onChanged();
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : String(addError),
      );
      setAdding(false);
    }
  }

  return (
    <div className="ext-popup acct-page" data-screen-label="Add account">
      {/* ── Top bar ── */}
      <div className="bar-top">
        <button
          className="icbtn"
          type="button"
          onClick={onBack}
          aria-label="Back"
        >
          <BackIcon />
        </button>

        <span className="acct-title">Add account</span>

        <span style={{ width: 32, flexShrink: 0 }} />
      </div>

      {/* ── Scrollable body ── */}
      <div className="screen-body">
        <div className="import-acct-hero">
          <div className="import-acct-hero__title">Choose account type</div>
          <div className="import-acct-hero__sub">
            Add a new account, import an existing wallet, or track an address
            without private keys.
          </div>
        </div>

        {error ? <div className="acct-error">{error}</div> : null}

        <OptionCard
          instrument="multiWallet"
          title={adding ? "Adding account…" : "Add account"}
          subtitle="Create the next account from this wallet."
          disabled={adding}
          onClick={() => void handleAddAccount()}
        />

        <OptionCard
          instrument="security"
          title="Import wallet"
          subtitle="Use a seed phrase or private key."
          disabled={adding}
          onClick={onImportWallet}
        />

        <OptionCard
          instrument="addressBook"
          title="Add watch wallet"
          subtitle="Track an address without private keys."
          disabled={adding}
          onClick={onAddWatchWallet}
        />
      </div>
    </div>
  );
}

export default AddAccountPage;
