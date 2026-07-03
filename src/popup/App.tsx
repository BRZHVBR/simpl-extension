import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { walletService } from "../core/wallet/wallet.service";
import { applyThemePreference } from "../core/theme/theme";
import { applyLocalePreference, t } from "../i18n";
import type { WalletAccount } from "../core/accounts/account.types";
import type { WalletRuntimeState } from "../core/wallet/wallet.types";
import type { WalletState } from "../core/storage/storage.types";
import type { WalletAssetBalance } from "../core/tokens/token-balance.service";

// Critical path — eager (onboarding + unlock + Home load instantly).
import { WelcomePage } from "./routes/WelcomePage";
import { CreateWalletPage } from "./routes/CreateWalletPage";
import { ImportWalletPage } from "./routes/ImportWalletPage";
import { UnlockPage } from "./routes/UnlockPage";
import { HomePage } from "./routes/HomePage";
import type { TransactionHistoryItem } from "../core/transactions/transaction-history.service";
import { parseBackupStatus, markSkipped, toSecuritySettingsPatch } from "../core/security/backup-status";
import { openSidePanel } from "./surface-actions";
import { isTronChainId } from "../core/networks/chain-registry";

// Heavy / secondary routes — lazy so opening the popup (Home) does not eagerly
// pull swap/bridge/multichain/QR/history code. Suspense + RouteErrorBoundary
// wrap the render below. Approval windows are separate entry points and are
// unaffected.
const TransactionHistoryPage = lazy(() =>
  import("./routes/TransactionHistoryPage").then((m) => ({ default: m.TransactionHistoryPage })),
);
const TransactionDetailsPage = lazy(() =>
  import("./routes/TransactionDetailsPage").then((m) => ({ default: m.TransactionDetailsPage })),
);
const AccountPage = lazy(() => import("./routes/AccountPage").then((m) => ({ default: m.AccountPage })));
const AddAccountPage = lazy(() => import("./routes/AddAccountPage").then((m) => ({ default: m.AddAccountPage })));
const AccountDetailsPage = lazy(() =>
  import("./routes/AccountDetailsPage").then((m) => ({ default: m.AccountDetailsPage })),
);
const AddWatchWalletPage = lazy(() =>
  import("./routes/AddWatchWalletPage").then((m) => ({ default: m.AddWatchWalletPage })),
);
const ImportAccountPage = lazy(() =>
  import("./routes/ImportAccountPage").then((m) => ({ default: m.ImportAccountPage })),
);
const AddCustomTokenPage = lazy(() =>
  import("./routes/AddCustomTokenPage").then((m) => ({ default: m.AddCustomTokenPage })),
);
const SendPage = lazy(() => import("./routes/SendPage").then((m) => ({ default: m.SendPage })));
const RevealSeedPage = lazy(() => import("./routes/RevealSeedPage").then((m) => ({ default: m.RevealSeedPage })));
const RevealPrivateKeyPage = lazy(() =>
  import("./routes/RevealPrivateKeyPage").then((m) => ({ default: m.RevealPrivateKeyPage })),
);
const SeedBackupVerificationPage = lazy(() => import("./routes/SeedBackupVerificationPage"));
const SettingsPage = lazy(() => import("./routes/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ReceivePage = lazy(() => import("./routes/ReceivePage").then((m) => ({ default: m.ReceivePage })));
const SwapPage = lazy(() => import("./routes/SwapPage").then((m) => ({ default: m.SwapPage })));
const BridgePage = lazy(() => import("./routes/BridgePage").then((m) => ({ default: m.BridgePage })));
import { LIFI_TRON_NATIVE_ADDRESS } from "../core/bridge/lifi-bridge.service";

// Minimal simpl-style fallback while a lazy route chunk loads.
function RouteFallback() {
  return (
    <div
      className="route-fallback"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 240,
        width: "100%",
        color: "var(--ink-3, #888)",
        fontSize: 13,
      }}
      role="status"
      aria-live="polite"
    >
      {t("common.loading")}
    </div>
  );
}

// Isolates a lazy chunk that fails to load (e.g. offline) so it never blanks the
// whole popup; offers a reload of the extension surface.
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div style={{ padding: 24, textAlign: "center", color: "var(--ink-2)" }}>
          <p style={{ fontSize: 14, fontWeight: 700, margin: "0 0 8px" }}>{t("errors.generic")}</p>
          <button
            type="button"
            className="btn secondary lg"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export type PopupRoute =
  | "welcome"
  | "create-wallet"
  | "import-wallet"
  | "unlock"
  | "home"
  | "receive"
  | "send"
  | "swap"
  | "bridge"
  | "accounts"
  | "add-account"
  | "account-details"
  | "add-watch-wallet"
  | "import-account"
  | "add-custom-token"
  | "reveal-seed"
  | "reveal-private-key"
  | "backup-verify"
  | "settings"
  | "transaction-history"
  | "transaction-details";

export type PopupViewState = {
  runtimeState: WalletRuntimeState;
  walletState: WalletState | null;
  selectedAccount: WalletAccount | null;
};

// Deep-link target passed via `?route=` when the wallet is opened from a
// first-party surface (e.g. the dashboard's "Manage accounts" action). Allow-
// listed so an arbitrary value can never drive navigation. Consumed once, after
// unlock, then cleared — normal opens always land on Home.
function readDeepLinkRoute(): PopupRoute | null {
  try {
    const value = new URLSearchParams(window.location.search).get("route");
    if (value === "accounts" || value === "settings") return value;
  } catch {
    /* no/invalid location — ignore */
  }
  return null;
}

// Read the persisted securitySettings (chrome.storage.local, localStorage mirror
// fallback) without importing the wallet service.
async function readSecuritySettings(): Promise<unknown> {
  const local = (globalThis as unknown as {
    chrome?: { storage?: { local?: { get?: (k: string[], cb: (i: Record<string, unknown>) => void) => void } } };
  }).chrome?.storage?.local;
  const get = local?.get;
  if (get) {
    const stored = await new Promise<Record<string, unknown>>((resolve) => {
      try {
        get.call(local, ["securitySettings"], (i) => resolve(i ?? {}));
      } catch {
        resolve({});
      }
    });
    if (stored.securitySettings !== undefined) return stored.securitySettings;
  }
  try {
    const raw = localStorage.getItem("securitySettings");
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

// Record an explicit "remind me later" on the fresh-wallet backup gate so the
// user lands on Home (with a reminder banner) instead of being trapped — but the
// action is explicit, never a silent skip.
async function markBackupSkipped(): Promise<void> {
  const settings = await readSecuritySettings();
  const current =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const next = { ...current, ...toSecuritySettingsPatch(markSkipped(parseBackupStatus(settings), Date.now())) };
  const local = (globalThis as unknown as {
    chrome?: { storage?: { local?: { set?: (i: Record<string, unknown>, cb?: () => void) => void } } };
  }).chrome?.storage?.local;
  const set = local?.set;
  if (set) {
    await new Promise<void>((resolve) => {
      try {
        set.call(local, { securitySettings: next }, () => resolve());
      } catch {
        resolve();
      }
    });
  }
  try {
    localStorage.setItem("securitySettings", JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// Gate a fresh mnemonic wallet into seed verification: only when a v2
// backupStatus exists that is required, unverified, and not yet skipped.
// Never gates migrated/legacy wallets (they carry no `backupStatus` object).
async function shouldGateToBackupVerify(): Promise<boolean> {
  const settings = await readSecuritySettings();
  const record =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  if (!record.backupStatus || typeof record.backupStatus !== "object") {
    return false;
  }
  const status = parseBackupStatus(settings);
  return status.required && !status.verified && status.skippedAt === undefined;
}

function SidePanelIcon() {
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
      <rect x="4" y="5" width="16" height="14" rx="3" />
      <path d="M14 5v14" />
    </svg>
  );
}

export function App() {
  const [route, setRoute] = useState<PopupRoute>("welcome");
  const [viewState, setViewState] = useState<PopupViewState | null>(null);
  const [selectedAsset, setSelectedAsset] =
    useState<WalletAssetBalance | null>(null);
  const [selectedTransaction, setSelectedTransaction] =
    useState<TransactionHistoryItem | null>(null);
  // Asset preselected as the receive/TO token when Swap is opened from an
  // asset details modal. null when Swap is opened from the main action.
  const [swapToAsset, setSwapToAsset] = useState<WalletAssetBalance | null>(
    null,
  );
  // Asset preselected as the cross-chain bridge SOURCE (FROM) when Swap is opened
  // for a TRON asset — TRON has no same-chain swap, so it goes to BridgePage.
  const [bridgeFromAsset, setBridgeFromAsset] =
    useState<WalletAssetBalance | null>(null);
  // Asset preselected when Receive is opened from asset details. null when
  // Receive is opened from the main action (defaults to native asset).
  const [receiveAsset, setReceiveAsset] = useState<WalletAssetBalance | null>(
    null,
  );
  // Account whose details/management screen is open (from the Accounts list).
  const [detailsAccount, setDetailsAccount] = useState<WalletAccount | null>(
    null,
  );
  // When true, opening Settings jumps straight into Security Center (Danger
  // Zone) — set by the "Reset wallet data" action on a primary account.
  const [openSecurityCenter, setOpenSecurityCenter] = useState(false);
  const [loading, setLoading] = useState(true);
  // One-shot deep-link target (e.g. "accounts") consumed on first unlock.
  const deepLinkRouteRef = useRef<PopupRoute | null>(readDeepLinkRoute());

  async function refresh() {
    const overview = await walletService.getOverview();

    const nextViewState: PopupViewState = {
      runtimeState: overview.runtimeState,
      walletState: overview.walletState,
      selectedAccount: overview.selectedAccount,
    };

    setViewState(nextViewState);

    if (overview.runtimeState.status === "not_initialized") {
      setSelectedAsset(null);
      setRoute("welcome");
      return;
    }

    if (overview.runtimeState.status === "locked") {
      setSelectedAsset(null);
      setRoute("unlock");
      return;
    }

    setSelectedAsset(null);
    // Honor a one-shot deep-link (e.g. opened to "accounts" from the dashboard).
    if (deepLinkRouteRef.current) {
      const target = deepLinkRouteRef.current;
      deepLinkRouteRef.current = null;
      setRoute(target);
      return;
    }
    // Steer a freshly-created (unverified, not-yet-skipped) mnemonic wallet into
    // the seed-verification flow before Home. Migrated wallets (no v2 backup
    // status) and "remind me later" (skippedAt set) are NOT gated — they land on
    // Home with a reminder banner instead.
    if (await shouldGateToBackupVerify()) {
      setRoute("backup-verify");
      return;
    }
    setRoute("home");
  }

  async function syncViewState() {
    const overview = await walletService.getOverview();

    const nextViewState: PopupViewState = {
      runtimeState: overview.runtimeState,
      walletState: overview.walletState,
      selectedAccount: overview.selectedAccount,
    };

    setViewState(nextViewState);

    if (overview.runtimeState.status === "not_initialized") {
      setSelectedAsset(null);
      setRoute("welcome");
      return;
    }

    if (overview.runtimeState.status === "locked") {
      setSelectedAsset(null);
      setRoute("unlock");
    }
  }

  useEffect(() => {
    refresh().finally(() => {
      setLoading(false);
    });
  }, []);

  // Re-sync the appearance from the authoritative wallet settings whenever they
  // load or change. initThemeEarly() already applied the localStorage mirror
  // before render; this keeps the mirror and document in sync with storage.
  const themePreference = viewState?.walletState?.settings.theme;
  useEffect(() => {
    if (themePreference) {
      applyThemePreference(themePreference);
    }
  }, [themePreference]);

  // Re-sync the interface language from the authoritative wallet settings.
  // initLocaleEarly() applied the localStorage mirror before render; this keeps
  // the mirror, document, and live UI in sync with storage.
  const localePreference = viewState?.walletState?.settings.locale;
  useEffect(() => {
    if (localePreference) {
      applyLocalePreference(localePreference);
    }
  }, [localePreference]);

  function getAddWatchWalletBackRoute(): PopupRoute {
    if (!viewState || viewState.runtimeState.status === "not_initialized") {
      return "welcome";
    }

    return "accounts";
  }

  function openSendPage(asset: WalletAssetBalance) {
    setSelectedAsset(asset);
    setRoute("send");
  }

  // Open the swap screen. When an asset is provided (Swap from an asset
  // details modal), it becomes the preselected receive/TO token and the
  // selected network is aligned to the asset's chain. With no asset (main
  // Swap action) the page keeps its default token pair.
  async function openSwapPage(asset?: WalletAssetBalance) {
    // TRON has no same-chain swap; its assets are cross-chain BRIDGE SOURCES via
    // LI.FI. Open the cross-chain BridgePage with the asset preselected as the
    // FROM token — never the 0x same-chain SwapPage (which 400s for TRON).
    if (asset && isTronChainId(asset.chainId)) {
      setSwapToAsset(null);
      setBridgeFromAsset(asset);
      setRoute("bridge");
      return;
    }
    if (asset) {
      if (asset.chainId !== viewState?.walletState?.selectedChainId) {
        await walletService.setSelectedChainId(asset.chainId);
        await syncViewState();
      }
      setSwapToAsset(asset);
    } else {
      setSwapToAsset(null);
    }

    setRoute("swap");
  }

  // Open the receive screen. When an asset is provided (Receive from asset
  // details), it's shown as the receive asset and the selected network is
  // aligned to the asset's chain. With no asset the page shows the native
  // asset of the selected network.
  async function openReceivePage(asset?: WalletAssetBalance) {
    if (asset) {
      if (asset.chainId !== viewState?.walletState?.selectedChainId) {
        await walletService.setSelectedChainId(asset.chainId);
        await syncViewState();
      }
      setReceiveAsset(asset);
    } else {
      setReceiveAsset(null);
    }

    setRoute("receive");
  }

  function renderRoute() {
    if (loading || !viewState) {
      return (
        <section className="simple-page simple-loading-page">
          <div className="simple-card simple-loading-card">
            <div className="simple-logo">
              <span className="simple-logo__mark" aria-hidden="true" />
              <span className="simple-logo__text">SIMPLE</span>
            </div>

            <p className="simple-loading-text">{t("app.loadingWallet")}</p>
          </div>
        </section>
      );
    }

    switch (route) {
      case "welcome":
        return (
          <WelcomePage
            onCreateWallet={() => setRoute("create-wallet")}
            onImportWallet={() => setRoute("import-wallet")}
            onAddWatchWallet={() => setRoute("add-watch-wallet")}
          />
        );

      case "create-wallet":
        return (
          <CreateWalletPage
            onCreated={async () => {
              await refresh();
            }}
            onBack={() => setRoute("welcome")}
          />
        );

      case "import-wallet":
        return (
          <ImportWalletPage
            onImported={async () => {
              await refresh();
            }}
            onBack={() => setRoute("welcome")}
          />
        );

      case "unlock":
        return (
          <UnlockPage
            walletState={viewState.walletState}
            onUnlocked={async () => {
              await refresh();
            }}
            onRestoreFromSeed={() => setRoute("import-wallet")}
          />
        );

      case "home":
        if (!viewState.walletState) {
          return null;
        }

        return (
  <HomePage
    selectedAccount={viewState.selectedAccount}
    walletState={viewState.walletState}
    onAccounts={() => setRoute("accounts")}
    onReceive={(asset) => void openReceivePage(asset)}
    onSwap={(asset) => void openSwapPage(asset)}
    onRevealSeed={() => setRoute("reveal-seed")}
    onRevealPrivateKey={() => setRoute("reveal-private-key")}
    onSettings={() => setRoute("settings")}
    onAddCustomToken={() => setRoute("add-custom-token")}
    onSendAsset={openSendPage}
    onRefresh={refresh}
    onHistory={() => setRoute("transaction-history")}
    onBackup={() => setRoute("backup-verify")}
  />
);

      case "swap":
  if (!viewState.walletState) {
    return null;
  }

  return (
    <SwapPage
      selectedAccount={viewState.selectedAccount}
      walletState={viewState.walletState}
      initialToAsset={swapToAsset}
      onChanged={syncViewState}
      onNavigateHome={() => {
        setSwapToAsset(null);
        setRoute("home");
      }}
      onBack={() => {
        setSwapToAsset(null);
        setRoute("home");
      }}
    />
  );

      case "bridge": {
        if (!viewState.walletState || !bridgeFromAsset) {
          return null;
        }
        const fromAsset = bridgeFromAsset;
        const fromIsNative = fromAsset.contractAddress == null;
        return (
          <BridgePage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            initialFromChainId={fromAsset.chainId}
            initialFromToken={{
              chainId: fromAsset.chainId,
              // Native TRX uses LI.FI's base58 sentinel; a TRC-20 uses its
              // contract address (which is LI.FI's identifier).
              address: fromIsNative
                ? LIFI_TRON_NATIVE_ADDRESS
                : (fromAsset.contractAddress as string),
              symbol: fromAsset.symbol,
              name: fromAsset.name,
              decimals: fromAsset.decimals,
              isNative: fromIsNative,
              logoUrl: fromAsset.logoUrl ?? null,
            }}
            onBridgeCompleted={syncViewState}
            onNavigateHome={() => {
              setBridgeFromAsset(null);
              setRoute("home");
            }}
            onBack={() => {
              setBridgeFromAsset(null);
              setRoute("home");
            }}
          />
        );
      }


      case "transaction-history":
        if (!viewState?.selectedAccount || !viewState.walletState) {
          return null;
        }

        return (
          <TransactionHistoryPage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
            onViewTransaction={(item) => {
              setSelectedTransaction(item);
              setRoute("transaction-details");
            }}
          />
        );

      case "transaction-details":
        return (
          <TransactionDetailsPage
            item={selectedTransaction}
            onBack={() => {
              setSelectedTransaction(null);
              setRoute("transaction-history");
            }}
          />
        );

      case "send":
        if (
          !viewState.walletState ||
          !viewState.selectedAccount ||
          !selectedAsset
        ) {
          return null;
        }

        return (
          <SendPage
            asset={selectedAsset}
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            onBack={() => {
              setSelectedAsset(null);
              setRoute("home");
            }}
            onChanged={syncViewState}
            onSent={async () => {
              setSelectedAsset(null);
              await refresh();
            }}
          />
        );

      case "receive":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <ReceivePage
            selectedAccount={viewState.selectedAccount}
            walletState={viewState.walletState}
            receiveAsset={receiveAsset}
            onBack={() => {
              setReceiveAsset(null);
              setRoute("home");
            }}
            onChanged={syncViewState}
          />
        );

      case "accounts":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AccountPage
            walletState={viewState.walletState}
            onBack={() => setRoute("home")}
            onAddAccount={() => setRoute("add-account")}
            onOpenAccountDetails={(account) => {
              setDetailsAccount(account);
              setRoute("account-details");
            }}
          />
        );

      case "add-account":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AddAccountPage
            onBack={() => setRoute("accounts")}
            onChanged={refresh}
            onImportWallet={() => setRoute("import-account")}
            onAddWatchWallet={() => setRoute("add-watch-wallet")}
          />
        );

      case "account-details":
        if (!viewState.walletState || !detailsAccount) {
          return null;
        }

        return (
          <AccountDetailsPage
            account={detailsAccount}
            chainId={viewState.walletState.selectedChainId}
            isActive={
              detailsAccount.id === viewState.walletState.selectedAccountId
            }
            onBack={() => {
              setDetailsAccount(null);
              setRoute("accounts");
            }}
            onUseAccount={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              // refresh() re-syncs state and lands on Home with the new active
              // account.
              await refresh();
            }}
            onReceive={async () => {
              // Quick actions operate on the selected account, so switch to
              // this one first, then open the page.
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              await syncViewState();
              setReceiveAsset(null);
              setRoute("receive");
            }}
            onSend={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              await syncViewState();
              setDetailsAccount(null);
              // Send needs an asset — default to the account's native asset.
              try {
                const portfolio = await walletService.getSelectedPortfolio();
                const native =
                  portfolio.assets.find((asset) => asset.type === "native") ??
                  portfolio.assets[0] ??
                  null;
                if (native) {
                  setSelectedAsset(native);
                  setRoute("send");
                  return;
                }
              } catch {
                // Fall through to Home if balances can't be loaded.
              }
              setRoute("home");
            }}
            onSwap={async () => {
              await walletService.selectAccount({
                accountId: detailsAccount.id,
              });
              setDetailsAccount(null);
              await syncViewState();
              setSwapToAsset(null);
              setRoute("swap");
            }}
            onRenamed={async (updated) => {
              // Stay on the details screen with the new name; refresh the list.
              setDetailsAccount(updated);
              await syncViewState();
            }}
            onRemoved={async () => {
              setDetailsAccount(null);
              await refresh();
              setRoute("accounts");
            }}
            onResetWallet={() => {
              // Primary accounts can't be removed individually — send the user to
              // Settings with the Security Center (Danger Zone) opened.
              setDetailsAccount(null);
              setOpenSecurityCenter(true);
              setRoute("settings");
            }}
          />
        );

      case "import-account":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <ImportAccountPage
            onBack={() => setRoute("accounts")}
            onImported={async () => {
              await refresh();
              setRoute("accounts");
            }}
          />
        );

      case "add-watch-wallet":
        return (
          <AddWatchWalletPage
            onAdded={async () => {
              await refresh();
            }}
            onBack={() => {
              setRoute(getAddWatchWalletBackRoute());
            }}
          />
        );

      case "add-custom-token":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <AddCustomTokenPage
            walletState={viewState.walletState}
            selectedAccount={viewState.selectedAccount}
            onBack={() => setRoute("home")}
            onChanged={syncViewState}
            onAdded={async () => {
              await syncViewState();
              setRoute("home");
            }}
          />
        );

      case "backup-verify":
        return (
          <SeedBackupVerificationPage
            allowBack={false}
            onVerified={async () => {
              await refresh();
            }}
            onSkip={async () => {
              await markBackupSkipped();
              await refresh();
            }}
          />
        );

      case "reveal-seed":
        return <RevealSeedPage onBack={() => setRoute("settings")} />;

      case "reveal-private-key":
        return <RevealPrivateKeyPage onBack={() => setRoute("settings")} />;

      case "settings":
        if (!viewState.walletState) {
          return null;
        }

        return (
          <SettingsPage
            walletState={viewState.walletState}
            initialShowSecurityCenter={openSecurityCenter}
            onBack={() => {
              setOpenSecurityCenter(false);
              setRoute("home");
            }}
            onChanged={syncViewState}
            onRevealSeed={() => setRoute("reveal-seed")}
            onRevealPrivateKey={() => setRoute("reveal-private-key")}
          />
        );

      default:
        return null;
    }
  }

  const surface =
    new URLSearchParams(window.location.search).get("surface") === "fullscreen"
      ? "fullscreen"
      : "popup";

  const isFullscreen = surface === "fullscreen";
  const routeContent = renderRoute();

  return (
    <div className={`app-root app-root--${surface}`} data-surface={surface}>
      {isFullscreen ? (
        <div className="fullscreen-shell">
          <main className="fullscreen-wallet-frame" data-route={route}>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>{routeContent}</Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
      ) : (
        <div className="popup-app-shell">
          <main className="popup-app-frame" data-route={route}>
            <RouteErrorBoundary>
              <Suspense fallback={<RouteFallback />}>{routeContent}</Suspense>
            </RouteErrorBoundary>
          </main>
        </div>
      )}
    </div>
  );
}

export default App;