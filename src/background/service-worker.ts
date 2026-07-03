/// <reference types="chrome" />

// Must be first: installs the Buffer/global polyfills @solana/web3.js needs at
// runtime, before any Solana code (reached via walletService) is evaluated.
import "../polyfills/buffer";
import { walletService } from "../core/wallet/wallet.service";
import { storageRepository } from "../core/storage/storage.repository";
import {
  getChainById,
  TRON_MAINNET_CHAIN_ID,
  BITCOIN_MAINNET_CHAIN_ID,
  BITCOIN_TESTNET_CHAIN_ID,
} from "../core/networks/chain-registry";
import type { WalletAccount } from "../core/accounts/account.types";
import {
  migrateConnectedSites,
  findByOrigin,
  isPermissionActive,
  hasMethodPermission,
  hasAccountPermission,
  hasChainPermission,
  getPermittedAddresses,
  grantConnectedSitePermission,
  touchConnectedSitePermission,
  appendAuditEvent,
  AUDIT_LOG_KEY,
  type ConnectedSitePermission,
  type ConnectedSiteAccount,
  type ConnectedSiteChain,
  type AuditEvent,
} from "../core/permissions/connected-site-permissions";

// EVM chains the wallet supports; used to scope an injected connect grant.
const SUPPORTED_EVM_CHAIN_IDS = [1, 56, 8453, 11155111];
const DEFAULT_EVM_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
];
const DEFAULT_TRON_METHODS = ["tron_accounts", "tron_sign", "tron_signMessage", "tron_sendTransaction"];

// ── Connected-site permission storage layer (see core/permissions) ───────────

async function readPermissions(): Promise<ConnectedSitePermission[]> {
  const stored = await chrome.storage.local.get("connectedSites");
  return migrateConnectedSites(stored["connectedSites"], new Date().toISOString());
}

async function writePermissions(perms: ConnectedSitePermission[]): Promise<void> {
  await chrome.storage.local.set({ connectedSites: perms });
}

// Active (not revoked / not expired) injected permission for an origin, or null.
async function getActiveOriginPermission(origin: string): Promise<ConnectedSitePermission | null> {
  const perm = findByOrigin(await readPermissions(), origin);
  return perm && isPermissionActive(perm, Date.now()) ? perm : null;
}

async function auditLog(event: AuditEvent): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(AUDIT_LOG_KEY);
    await chrome.storage.local.set({
      [AUDIT_LOG_KEY]: appendAuditEvent(stored[AUDIT_LOG_KEY], event),
    });
  } catch {
    // Audit logging must never break a request.
  }
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

// Grant an injected-dApp permission scoped to one account + all supported EVM
// chains + the default EVM method set (each signing/send action still requires
// its own explicit approval).
async function grantInjectedEvmPermission(
  origin: string,
  account: { id: string; address: string },
): Promise<void> {
  const perms = await readPermissions();
  const accounts: ConnectedSiteAccount[] = [
    { accountId: account.id, address: account.address, type: "evm" },
  ];
  const chains: ConnectedSiteChain[] = SUPPORTED_EVM_CHAIN_IDS.map((id) => ({
    namespace: "eip155",
    chainId: String(id),
    label: getChainById(id)?.name,
  }));
  await writePermissions(
    grantConnectedSitePermission(
      perms,
      { origin, source: "injected", accounts, chains, methods: DEFAULT_EVM_METHODS },
      new Date().toISOString(),
    ),
  );
}

// Message Settings sends after the user changes "Default open mode" so the
// service worker re-applies the toolbar-icon behavior without a reload.
export const DEFAULT_OPEN_MODE_CHANGED_MESSAGE = "SIMPL_DEFAULT_OPEN_MODE_CHANGED";

// Apply the user's "Default open mode" preference to the toolbar icon: when set
// to "sidePanel", clicking the action opens the slide-out side panel; otherwise
// it opens the classic popup (openPanelOnActionClick: false). Reads the stored,
// normalized setting — defaults to "popup" for fresh/legacy installs.
async function applyPanelBehaviorFromSettings() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    console.debug("chrome.sidePanel API is not available.");
    return;
  }

  let openPanelOnActionClick = false;

  try {
    const walletState = await storageRepository.getWalletState();
    openPanelOnActionClick =
      walletState.settings.defaultOpenMode === "sidePanel";
  } catch (error) {
    console.debug("Could not read defaultOpenMode; using popup:", error);
  }

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick });
    console.log(
      `Toolbar open mode: ${openPanelOnActionClick ? "side panel" : "popup"}.`,
    );
  } catch (error) {
    console.error("Failed to apply side panel behavior:", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("simpl extension installed.");
  void applyPanelBehaviorFromSettings();
  void pingWalletConnectEngine();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("simpl extension started.");
  void applyPanelBehaviorFromSettings();
  void pingWalletConnectEngine();
});

// Also run once when service worker is evaluated.
void applyPanelBehaviorFromSettings();

// Re-apply the toolbar behavior when Settings changes the default open mode.
chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type === DEFAULT_OPEN_MODE_CHANGED_MESSAGE) {
    void applyPanelBehaviorFromSettings();
  }
  return false;
});

type SimpleRuntimeMessage = {
  type?: string;
};

let walletConnectApprovalWindowId: number | null = null;

async function openWalletConnectApprovalWindow() {
  const url = chrome.runtime.getURL("walletconnect-approval.html?surface=approval");

  const popupWidth = 400;
  const popupHeight = 720;

  let left: number | undefined;
  let top: number | undefined;

  try {
    const currentWindow = await chrome.windows.getLastFocused();

    if (
      typeof currentWindow.left === "number" &&
      typeof currentWindow.top === "number" &&
      typeof currentWindow.width === "number"
    ) {
      left = Math.max(
        0,
        currentWindow.left + currentWindow.width - popupWidth - 24,
      );
      top = Math.max(0, currentWindow.top + 72);
    }
  } catch (error) {
    console.warn("Failed to calculate WalletConnect approval window position:", error);
  }

  const createdWindow = await chrome.windows.create({
    url,
    type: "popup",
    width: popupWidth,
    height: popupHeight,
    focused: true,
    ...(typeof left === "number" ? { left } : {}),
    ...(typeof top === "number" ? { top } : {}),
  });

  // Track the window so closing it without acting cleans up pending WC state.
  walletConnectApprovalWindowId = createdWindow?.id ?? null;

  return createdWindow?.id;
}

// Fire-and-forget message to the offscreen engine (no service-worker handler).
function notifyWalletConnectEngine(type: string): void {
  try {
    chrome.runtime.sendMessage({ type }, () => {
      void chrome.runtime.lastError?.message;
    });
  } catch {
    // Offscreen document may be gone; nothing to clean up.
  }
}

chrome.windows?.onRemoved?.addListener((windowId) => {
  if (walletConnectApprovalWindowId !== windowId) {
    return;
  }

  walletConnectApprovalWindowId = null;

  // The approval window was closed. If the user closed it WITHOUT approving,
  // reject any still-pending proposal/request so no session is created and the
  // dApp is not left hanging. Both are no-ops if approval already cleared them.
  notifyWalletConnectEngine("SIMPLE_WALLETCONNECT_REJECT_PROPOSAL");
  notifyWalletConnectEngine("SIMPLE_WALLETCONNECT_REJECT_REQUEST");
});

chrome.runtime.onMessage.addListener(
  (
    message: SimpleRuntimeMessage,
    _sender,
    sendResponse: (response?: unknown) => void,
  ) => {
  if (message?.type === "SIMPLE_WALLETCONNECT_SET_SELECTED_CHAIN") {
    const messageWithChainId = message as { chainId?: unknown };
    const chainId = Number(messageWithChainId.chainId);

    if (!Number.isInteger(chainId) || chainId <= 0) {
      sendResponse({
        ok: false,
        error: `Invalid chainId: ${String(messageWithChainId.chainId)}`,
      });

      return true;
    }

    void walletService
      .setSelectedChainId(chainId)
      .then((walletState) => {
        sendResponse({
          ok: true,
          result: {
            chainId,
            selectedChainId: walletState.selectedChainId,
          },
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  }


    if (message?.type !== "SIMPLE_OPEN_WALLETCONNECT_APPROVAL_WINDOW") {
      return false;
    }

    void openWalletConnectApprovalWindow()
      .then((windowId) => {
        sendResponse({
          ok: true,
          windowId,
        });
      })
      .catch((error) => {
        console.error("Failed to open WalletConnect approval window:", error);

        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return true;
  },
);


const WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH = "walletconnect-offscreen.html";

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreenApi = (chrome as unknown as {
    offscreen?: {
      hasDocument?: () => Promise<boolean>;
    };
  }).offscreen;

  if (typeof offscreenApi?.hasDocument === "function") {
    return offscreenApi.hasDocument();
  }

  const clientsApi = (globalThis as unknown as {
    clients?: {
      matchAll?: () => Promise<Array<{ url?: string }>>;
    };
  }).clients;

  if (typeof clientsApi?.matchAll !== "function") {
    return false;
  }

  const extensionUrl = chrome.runtime.getURL(WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH);
  const matchedClients = await clientsApi.matchAll();

  return matchedClients.some((client) => client.url === extensionUrl);
}

async function ensureWalletConnectOffscreenDocument(): Promise<void> {
  const offscreenApi = (chrome as unknown as {
    offscreen?: {
      createDocument?: (input: {
        url: string;
        reasons: string[];
        justification: string;
      }) => Promise<void>;
    };
  }).offscreen;

  if (typeof offscreenApi?.createDocument !== "function") {
    console.warn("chrome.offscreen API is not available.");
    return;
  }

  if (await hasOffscreenDocument()) {
    return;
  }

  await offscreenApi.createDocument({
    url: WALLETCONNECT_OFFSCREEN_DOCUMENT_PATH,
    reasons: ["LOCAL_STORAGE"],
    justification: "Keep WalletConnect sessions and requests active while the wallet UI is closed.",
  });
}

async function pingWalletConnectEngine(): Promise<void> {
  await ensureWalletConnectOffscreenDocument();

  // The offscreen document self-starts its WalletConnect engine.
  // Do not immediately send a ping here: on cold start the offscreen
  // script may not have registered its message listener yet.
}

void pingWalletConnectEngine();


chrome.runtime.onMessage.addListener((message: { type?: string }) => {
  if (message?.type !== "SIMPLE_WALLETCONNECT_ENGINE_READY") {
    return false;
  }

  console.log("SIMPLE WalletConnect offscreen engine is ready.");

  return false;
});


function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (message?.type === "SIMPLE_WALLETCONNECT_STORAGE_GET") {
    void chrome.storage.local
      .get(message.keys)
      .then((value) => {
        sendResponse({
          ok: true,
          value,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_STORAGE_SET") {
    void chrome.storage.local
      .set(message.items ?? {})
      .then(() => {
        sendResponse({
          ok: true,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_GET_SELECTED_ACCOUNT") {
    void walletService
      .bootstrap()
      .then((bootstrap) => {
        const selectedAccount = bootstrap.selectedAccount;

        if (!selectedAccount) {
          throw new Error("No selected SIMPLE account.");
        }

        sendResponse({
          ok: true,
          account: {
            address: selectedAccount.address,
            chainId: bootstrap.walletState.selectedChainId,
          },
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_GET_SELECTED_TRON_ACCOUNT") {
    void walletService
      .getSelectedTronAccountInfo()
      .then((account) => {
        sendResponse({ ok: true, account });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_TRON_SIGN_TRANSACTION") {
    // Sign-only: return the signed tx; the dApp decides whether to broadcast.
    void walletService
      .signTronDappTransaction({
        transaction: message.params,
        password: typeof message.password === "string" ? message.password : undefined,
      })
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_TRON_SIGN_MESSAGE") {
    void walletService
      .signTronDappMessage({
        message: message.params,
        password: typeof message.password === "string" ? message.password : undefined,
      })
      .then((result) => {
        sendResponse({ ok: true, result: result.signature });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_TRON_SEND_TRANSACTION") {
    // Sign AND broadcast; return the txID to the dApp.
    void walletService
      .sendTronDappTransaction({
        transaction: message.params,
        password: typeof message.password === "string" ? message.password : undefined,
      })
      .then((result) => {
        sendResponse({ ok: true, result: result.txId });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: getErrorMessage(error) });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_SEND_PREPARED_TRANSACTION") {
    void walletService
      .sendSelectedPreparedTransaction({
        password: typeof message.password === "string" ? message.password : undefined,
        transaction: message.transaction,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_PERSONAL_SIGN") {
    void walletService
      .signSelectedPersonalMessage({
        password: typeof message.password === "string" ? message.password : undefined,
        params: message.params,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  if (message?.type === "SIMPLE_WALLETCONNECT_SIGN_TYPED_DATA_V4") {
    void walletService
      .signSelectedTypedDataV4({
        password: typeof message.password === "string" ? message.password : undefined,
        params: message.params,
      })
      .then((result) => {
        sendResponse({
          ok: true,
          result,
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: getErrorMessage(error),
        });
      });

    return true;
  }

  return false;
});


// =============================================================
//  dApp Injected Provider — Connect MVP
//  Handles: eth_accounts, eth_chainId, net_version,
//           eth_requestAccounts (opens approval popup)
// =============================================================

type DappPendingApproval = {
  id: string;
  origin: string;
  kind:
    | "connect"
    | "personal_sign"
    | "typed_data"
    | "switch_chain"
    | "switch_account"
    | "transaction"
    | "tron_connect"
    | "tron_sign";
  // "tron" for TRON-namespace requests, "evm" (default) otherwise.
  namespace?: "evm" | "tron";
  signingParams?: { method: string; params: unknown[] };
  switchChainId?: number;
  // Target account for an explicit-approval simpl_switchAccount request.
  switchAccountId?: string;
  switchAccountAddress?: string;
  transactionParams?: {
    from: string;
    to: string;
    value?: string;
    data?: string;
    gas?: string;
    gasPrice?: string;
  };
  // TRON connect/sign context.
  tronAddress?: string;
  tronAddressHex?: string;
  tronTransaction?: unknown;
  resolve: (result: unknown) => void;
  reject: (error: { code: number; message: string }) => void;
};

// TRON Mainnet chain id in the hex form TRON dApps expect (0x2b6653dc).
const TRON_CHAIN_ID_HEX = `0x${TRON_MAINNET_CHAIN_ID.toString(16)}`;

const pendingDappApprovals = new Map<string, DappPendingApproval>();
let dappApprovalWindowId: number | null = null;

// Reject all pending dApp approvals — called when the approval window is closed.
function rejectAllPendingDappApprovals(): void {
  for (const pending of pendingDappApprovals.values()) {
    pending.reject({ code: 4001, message: "User rejected the request." });
  }
  pendingDappApprovals.clear();
}

chrome.windows?.onRemoved?.addListener((windowId: number) => {
  if (dappApprovalWindowId === windowId) {
    dappApprovalWindowId = null;
    rejectAllPendingDappApprovals();
  }
});

async function openDappApprovalWindow(approvalId: string): Promise<void> {
  const url = chrome.runtime.getURL(`dapp-approval.html?id=${approvalId}`);
  const popupWidth = 400;
  const popupHeight = 580;

  let left: number | undefined;
  let top: number | undefined;

  try {
    const win = await chrome.windows.getLastFocused();
    if (
      typeof win.left === "number" &&
      typeof win.top === "number" &&
      typeof win.width === "number"
    ) {
      left = Math.max(0, win.left + win.width - popupWidth - 24);
      top = Math.max(0, win.top + 72);
    }
  } catch {
    // ignore — positioning is best-effort
  }

  // If there's already an open dApp approval window, focus it instead of opening a new one.
  if (dappApprovalWindowId !== null) {
    try {
      await chrome.windows.update(dappApprovalWindowId, { focused: true });
      return;
    } catch {
      dappApprovalWindowId = null;
    }
  }

  const created = await chrome.windows.create({
    url,
    type: "popup",
    width: popupWidth,
    height: popupHeight,
    focused: true,
    ...(typeof left === "number" ? { left } : {}),
    ...(typeof top === "number" ? { top } : {}),
  });

  dappApprovalWindowId = created?.id ?? null;
}

// True when the origin has an active (not revoked / not expired) permission.
// Presence-only guard — method/account/chain scoping is enforced per method.
async function getDappConnectionForOrigin(origin: string): Promise<boolean> {
  return (await getActiveOriginPermission(origin)) !== null;
}

// Grant/refresh a connected-site permission on connect approval. EVM grants the
// approving account + supported EVM chains; TRON grants the TRON account + the
// TRON chain. Each signing/send action still requires its own approval.
async function saveDappConnection(
  origin: string,
  type: "evm" | "tron" = "evm",
  account?: { id: string; address: string },
): Promise<void> {
  const perms = await readPermissions();
  const now = new Date().toISOString();

  if (type === "tron") {
    const accounts: ConnectedSiteAccount[] = account
      ? [{ accountId: account.id, address: account.address, type: "tron" }]
      : [];
    const chains: ConnectedSiteChain[] = [
      { namespace: "tron", chainId: String(TRON_MAINNET_CHAIN_ID), label: "TRON Mainnet" },
    ];
    await writePermissions(
      grantConnectedSitePermission(
        perms,
        { origin, source: "injected", accounts, chains, methods: DEFAULT_TRON_METHODS },
        now,
      ),
    );
    return;
  }

  // EVM: use the given account, else the currently selected one.
  const resolved =
    account ??
    (await (async () => {
      const b = await walletService.bootstrap();
      return b.selectedAccount
        ? { id: b.selectedAccount.id, address: b.selectedAccount.address }
        : undefined;
    })());
  if (resolved) {
    await grantInjectedEvmPermission(origin, resolved);
  }
}

function extractPersonalSignDisplay(params: unknown[]): string {
  const stringParams = params.filter((p): p is string => typeof p === "string" && p.length > 0);
  const addressParam = stringParams.find((p) => /^0x[a-fA-F0-9]{40}$/.test(p));
  const rawMsg = stringParams.find((p) => p !== addressParam) ?? stringParams[0] ?? "";
  if (!rawMsg) return "";
  if (/^0x[0-9a-fA-F]*$/.test(rawMsg)) {
    try {
      const hex = rawMsg.slice(2);
      const bytes = new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return rawMsg;
    }
  }
  return rawMsg;
}

type TypedDataDisplay = {
  domainName?: string;
  verifyingContract?: string;
  primaryType?: string;
  messageJson?: string;
};

function extractTypedDataDisplay(params: unknown[]): TypedDataDisplay {
  try {
    const raw = params[1];
    const td = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!td || typeof td !== "object") return {};
    const record = td as Record<string, unknown>;
    const domain = record["domain"] as Record<string, unknown> | undefined;
    return {
      domainName: typeof domain?.["name"] === "string" ? (domain["name"] as string) : undefined,
      verifyingContract: typeof domain?.["verifyingContract"] === "string" ? (domain["verifyingContract"] as string) : undefined,
      primaryType: typeof record["primaryType"] === "string" ? (record["primaryType"] as string) : undefined,
      messageJson: record["message"] ? JSON.stringify(record["message"], null, 2) : undefined,
    };
  } catch {
    return {};
  }
}

const ERC20_APPROVE_SELECTOR = "095ea7b3";

type DecodedErc20Approve = {
  spender: string;
  amountRaw: string;
  isUnlimited: boolean;
};

function decodeErc20Approve(data: string | undefined): DecodedErc20Approve | null {
  if (!data || typeof data !== "string") return null;
  const hex = data.toLowerCase().startsWith("0x") ? data.slice(2).toLowerCase() : data.toLowerCase();
  if (!hex.startsWith(ERC20_APPROVE_SELECTOR)) return null;
  // Need selector (8) + spender slot (64) + amount slot (64) = 136 hex chars minimum
  if (hex.length < 136) return null;
  try {
    // Spender: last 40 chars of first 32-byte slot (bytes 8..72)
    const spender = `0x${hex.slice(8, 72).slice(-40)}`;
    // Amount: second 32-byte slot (bytes 72..136)
    const amountSlot = hex.slice(72, 136);
    const isUnlimited = amountSlot === "f".repeat(64);
    const amountRaw = BigInt(`0x${amountSlot}`).toString();
    return { spender, amountRaw, isUnlimited };
  } catch {
    return null;
  }
}

// Summarize a TRON transaction for the approval popup: the contract type
// (e.g. TransferContract / TriggerSmartContract) and a truncated JSON preview.
function extractTronTxDisplay(tx: unknown): {
  contractType?: string;
  json?: string;
} {
  try {
    const t = tx as { raw_data?: { contract?: Array<{ type?: string }> } };
    const contractType = t?.raw_data?.contract?.[0]?.type;
    const json = JSON.stringify(tx, null, 2);
    return {
      contractType: typeof contractType === "string" ? contractType : undefined,
      json: json.length > 4000 ? `${json.slice(0, 4000)}…` : json,
    };
  } catch {
    return {};
  }
}

// Public, sanitized account metadata handed to a connected first-party surface
// (the SIMPL dashboard). ONLY public data: id, display name, type, active flag,
// avatar seed, and public chain addresses. NEVER key material, mnemonic,
// derivation paths, encrypted vault, or raw storage records.
type SimplDashboardAccount = {
  id: string;
  name: string;
  type: "primary" | "imported" | "watch-only";
  isActive: boolean;
  avatarSeed: string;
  addresses: {
    evm?: string;
    tron?: string;
    btc?: string;
    btcTestnet?: string;
    solana?: string;
    ton?: string;
  };
};

function toSafeAccountMeta(
  account: WalletAccount,
  selectedAccountId: string | null,
): SimplDashboardAccount {
  const typeMap: Record<WalletAccount["type"], SimplDashboardAccount["type"]> = {
    mnemonic: "primary",
    importedMnemonic: "imported",
    privateKey: "imported",
    watch: "watch-only",
  };

  // Only addresses already derived + persisted on the record are exposed — this
  // never triggers derivation and never touches key material.
  const addresses: SimplDashboardAccount["addresses"] = { evm: account.address };
  if ("tronAddress" in account && account.tronAddress) addresses.tron = account.tronAddress;
  if ("solanaAddress" in account && account.solanaAddress) addresses.solana = account.solanaAddress;
  if ("tonAddress" in account && account.tonAddress) addresses.ton = account.tonAddress;
  if ("bitcoinAddresses" in account && account.bitcoinAddresses) {
    const mainnet = account.bitcoinAddresses[BITCOIN_MAINNET_CHAIN_ID];
    const testnet = account.bitcoinAddresses[BITCOIN_TESTNET_CHAIN_ID];
    if (mainnet?.receive) addresses.btc = mainnet.receive;
    if (testnet?.receive) addresses.btcTestnet = testnet.receive;
  }

  return {
    id: account.id,
    name: account.label,
    type: typeMap[account.type],
    isActive: account.id === selectedAccountId,
    avatarSeed: account.address,
    addresses,
  };
}

// Routes the wallet UI may be deep-linked to from a first-party surface. Opening
// the wallet exposes no data, so this needs no connection — but the route is
// allow-listed so an arbitrary value can't drive navigation.
const WALLET_OPEN_ROUTES = new Set(["accounts", "settings", "home"]);

async function openWalletToRoute(route: string): Promise<void> {
  const safeRoute = WALLET_OPEN_ROUTES.has(route) ? route : "accounts";
  const url = chrome.runtime.getURL(`popup.html?route=${encodeURIComponent(safeRoute)}`);
  await chrome.windows.create({
    url,
    type: "popup",
    width: 400,
    height: 640,
    focused: true,
  });
}

async function broadcastProviderEvent(
  event: string,
  data: unknown,
  namespace: "evm" | "tron" = "evm",
): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      chrome.tabs
        .sendMessage(tab.id, { type: "SIMPL_PROVIDER_EVENT", event, data, namespace })
        .catch(() => {});
    }
  }
}

async function handleDappRequest(
  message: { method: string; params: unknown[]; origin: string },
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const { method, origin } = message;

  try {
    const bootstrap = await walletService.bootstrap();
    const address = bootstrap.selectedAccount?.address ?? null;
    const chainId = bootstrap.walletState.selectedChainId;
    const isWatchOnly = bootstrap.selectedAccount?.type === "watch";

    // Watch-only accounts cannot sign or send. Reject up-front with a clear
    // error instead of opening a signing approval that can never succeed.
    if (
      isWatchOnly &&
      (method === "personal_sign" ||
        method === "eth_signTypedData_v4" ||
        method === "eth_sendTransaction")
    ) {
      sendResponse({
        ok: false,
        error: {
          code: 4100,
          message:
            "Watch-only accounts can view balances and activity, but cannot sign transactions.",
        },
      });
      return;
    }

    switch (method) {
      case "eth_accounts": {
        // Return ONLY the accounts this origin was granted (and that still exist
        // in the wallet) — never the whole wallet, never an unpermitted account.
        const perm = await getActiveOriginPermission(origin);
        const walletAddrs = new Set(
          bootstrap.walletState.accounts.map((a) => a.address.toLowerCase()),
        );
        const permitted = perm
          ? getPermittedAddresses(perm, "evm").filter((a) => walletAddrs.has(a.toLowerCase()))
          : [];
        sendResponse({ ok: true, result: permitted });
        return;
      }

      case "eth_chainId": {
        sendResponse({ ok: true, result: `0x${chainId.toString(16)}` });
        return;
      }

      case "net_version": {
        sendResponse({ ok: true, result: String(chainId) });
        return;
      }

      case "eth_requestAccounts": {
        // Active permission with at least one still-valid account → return it,
        // no popup.
        const perm = await getActiveOriginPermission(origin);
        const walletAddrs = new Set(
          bootstrap.walletState.accounts.map((a) => a.address.toLowerCase()),
        );
        const permitted = perm
          ? getPermittedAddresses(perm, "evm").filter((a) => walletAddrs.has(a.toLowerCase()))
          : [];
        if (permitted.length > 0) {
          await writePermissions(
            touchConnectedSitePermission(await readPermissions(), { origin }, new Date().toISOString()),
          );
          sendResponse({ ok: true, result: permitted });
          return;
        }

        // Wallet locked — cannot show account in approval UI.
        if (!address) {
          sendResponse({
            ok: false,
            error: {
              code: 4900,
              message: "Wallet is locked. Please unlock SIMPL Wallet first.",
            },
          });
          return;
        }

        // New origin — open approval popup.
        const approvalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

        pendingDappApprovals.set(approvalId, {
          id: approvalId,
          origin,
          kind: "connect",
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });

        await openDappApprovalWindow(approvalId);
        return;
      }

      case "personal_sign": {
        const perm = await getActiveOriginPermission(origin);
        if (!perm) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }
        if (!hasMethodPermission(perm, "personal_sign")) {
          void auditLog({ type: "method_rejected", at: new Date().toISOString(), origin, method });
          sendResponse({ ok: false, error: { code: 4100, message: "This site is not permitted to request signatures. Reconnect to grant it." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
          return;
        }
        // The signer address (personal_sign params: [message, address]) must be
        // one the site was granted.
        const signer = (message.params.find(
          (p): p is string => typeof p === "string" && /^0x[a-fA-F0-9]{40}$/.test(p),
        ) ?? address);
        if (!hasAccountPermission(perm, signer)) {
          sendResponse({ ok: false, error: { code: 4100, message: "This account is not permitted for this site." } });
          return;
        }
        const signApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(signApprovalId, {
          id: signApprovalId,
          origin,
          kind: "personal_sign",
          signingParams: { method, params: message.params },
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(signApprovalId);
        return;
      }

      case "eth_signTypedData_v4": {
        const perm = await getActiveOriginPermission(origin);
        if (!perm) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }
        if (!hasMethodPermission(perm, "eth_signTypedData_v4")) {
          void auditLog({ type: "method_rejected", at: new Date().toISOString(), origin, method });
          sendResponse({ ok: false, error: { code: 4100, message: "This site is not permitted to request signatures. Reconnect to grant it." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
          return;
        }
        // The signer address (typedData params: [address, data]) must be granted.
        const signer = (message.params.find(
          (p): p is string => typeof p === "string" && /^0x[a-fA-F0-9]{40}$/.test(p),
        ) ?? address);
        if (!hasAccountPermission(perm, signer)) {
          sendResponse({ ok: false, error: { code: 4100, message: "This account is not permitted for this site." } });
          return;
        }
        const tdApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(tdApprovalId, {
          id: tdApprovalId,
          origin,
          kind: "typed_data",
          signingParams: { method, params: message.params },
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(tdApprovalId);
        return;
      }

      case "wallet_switchEthereumChain": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }

        // Parse chainId from params[0].chainId (hex string or number).
        const rawParam = (message.params[0] as Record<string, unknown> | undefined)?.chainId;
        if (rawParam === undefined || rawParam === null) {
          sendResponse({ ok: false, error: { code: -32602, message: "Missing chainId parameter." } });
          return;
        }
        const requestedChainId =
          typeof rawParam === "number"
            ? rawParam
            : Number.parseInt(String(rawParam), 16);
        if (!Number.isFinite(requestedChainId) || requestedChainId <= 0) {
          sendResponse({ ok: false, error: { code: -32602, message: "Invalid chainId." } });
          return;
        }

        // Check supported.
        const requestedChain = getChainById(requestedChainId);
        if (!requestedChain) {
          sendResponse({ ok: false, error: { code: 4902, message: "Unrecognized chain." } });
          return;
        }

        // Already active — return null immediately per EIP-3326.
        if (requestedChainId === chainId) {
          sendResponse({ ok: true, result: null });
          return;
        }

        // If the target chain is already granted to this site, switch directly
        // (no popup) — it was approved at connect / a prior switch. Otherwise fall
        // through to an explicit approval that will grant it.
        const switchPerm = await getActiveOriginPermission(origin);
        if (
          switchPerm &&
          hasChainPermission(switchPerm, { namespace: "eip155", chainId: String(requestedChainId) })
        ) {
          await walletService.setSelectedChainId(requestedChainId);
          await writePermissions(
            touchConnectedSitePermission(await readPermissions(), { origin }, new Date().toISOString()),
          );
          void auditLog({
            type: "chain_switch_approved",
            at: new Date().toISOString(),
            origin,
            detail: String(requestedChainId),
          });
          await broadcastProviderEvent("chainChanged", `0x${requestedChainId.toString(16)}`);
          sendResponse({ ok: true, result: null });
          return;
        }

        const switchApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(switchApprovalId, {
          id: switchApprovalId,
          origin,
          kind: "switch_chain",
          switchChainId: requestedChainId,
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(switchApprovalId);
        return;
      }

      // First-party network switch for SIMPL surfaces (e.g. the dashboard).
      // Namespace-agnostic: works for EVM and non-EVM chains alike, and routes
      // through the SAME approval popup as wallet_switchEthereumChain — so the
      // dashboard never opens a standalone wallet window. A locked wallet is
      // unlocked inside that approval popup before the switch is applied.
      case "simpl_switchChain": {
        const rawChainId = (message.params[0] as Record<string, unknown> | undefined)?.chainId;
        // Accept a numeric chainId (or hex/decimal string) in params[0].chainId.
        const requestedChainId =
          typeof rawChainId === "number"
            ? rawChainId
            : typeof rawChainId === "string"
              ? Number.parseInt(rawChainId, rawChainId.startsWith("0x") ? 16 : 10)
              : Number.NaN;

        const connected = await getDappConnectionForOrigin(origin);
        const matchedChain = Number.isFinite(requestedChainId) ? getChainById(requestedChainId) : null;

        if (import.meta.env.DEV) {
          console.debug("[simpl:bg] simpl_switchChain", {
            origin,
            rawChainId,
            rawChainIdType: typeof rawChainId,
            requestedChainId,
            matchedChain: matchedChain
              ? { chainId: matchedChain.chainId, family: matchedChain.family, name: matchedChain.name }
              : null,
            selectedChainId: chainId,
            connected,
          });
        }

        // Connection guard — namespace-agnostic (same connectedSites check as
        // every other dApp method; not EVM-specific).
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }

        if (!Number.isFinite(requestedChainId)) {
          sendResponse({ ok: false, error: { code: -32602, message: "Invalid chainId." } });
          return;
        }

        if (!matchedChain) {
          sendResponse({
            ok: false,
            error: {
              code: 4902,
              message: "Unrecognized chain.",
              data: { chainId: requestedChainId },
            },
          });
          return;
        }

        // Already active — succeed immediately, no approval popup.
        if (requestedChainId === chainId) {
          sendResponse({ ok: true, result: null });
          return;
        }

        const simplSwitchApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(simplSwitchApprovalId, {
          id: simplSwitchApprovalId,
          origin,
          kind: "switch_chain",
          switchChainId: requestedChainId,
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        if (import.meta.env.DEV) {
          console.debug("[simpl:bg] simpl_switchChain → approval popup", {
            approvalId: simplSwitchApprovalId,
            switchChainId: requestedChainId,
          });
        }
        await openDappApprovalWindow(simplSwitchApprovalId);
        return;
      }

      case "eth_sendTransaction": {
        const perm = await getActiveOriginPermission(origin);
        if (!perm) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized: connect wallet first." } });
          return;
        }
        if (!hasMethodPermission(perm, "eth_sendTransaction")) {
          void auditLog({ type: "method_rejected", at: new Date().toISOString(), origin, method });
          sendResponse({ ok: false, error: { code: 4100, message: "This site is not permitted to send transactions. Reconnect to grant it." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
          return;
        }
        // The current network must be one this site was granted.
        if (!hasChainPermission(perm, { namespace: "eip155", chainId: String(chainId) })) {
          sendResponse({ ok: false, error: { code: 4100, message: "This network is not permitted for this site." } });
          return;
        }

        const txParam = message.params[0] as Record<string, unknown> | undefined;
        if (!txParam || typeof txParam !== "object") {
          sendResponse({ ok: false, error: { code: -32602, message: "Invalid transaction parameters." } });
          return;
        }

        const txTo = typeof txParam["to"] === "string" ? txParam["to"] : null;
        if (!txTo) {
          sendResponse({ ok: false, error: { code: -32602, message: "Invalid transaction parameters." } });
          return;
        }

        const txFrom = typeof txParam["from"] === "string" ? txParam["from"] : null;
        if (txFrom && txFrom.toLowerCase() !== address.toLowerCase()) {
          sendResponse({ ok: false, error: { code: 4100, message: "Transaction from address does not match active account." } });
          return;
        }
        // The signer account must be one the site was granted.
        if (!hasAccountPermission(perm, txFrom ?? address)) {
          sendResponse({ ok: false, error: { code: 4100, message: "This account is not permitted for this site." } });
          return;
        }

        const txApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(txApprovalId, {
          id: txApprovalId,
          origin,
          kind: "transaction",
          transactionParams: {
            from: txFrom ?? address,
            to: txTo,
            value: typeof txParam["value"] === "string" ? txParam["value"] : undefined,
            data: typeof txParam["data"] === "string" ? txParam["data"] : undefined,
            gas: typeof txParam["gas"] === "string" ? txParam["gas"] : undefined,
            gasPrice: typeof txParam["gasPrice"] === "string" ? txParam["gasPrice"] : undefined,
          },
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(txApprovalId);
        return;
      }

      // ── SIMPL first-party account methods ──────────────────────────────
      // Richer account metadata + active-account switching + deep-linking the
      // wallet UI. Used by the SIMPL dashboard. Gated on the same connect
      // approval model as eth_* methods; never expose key material.

      case "simpl_getAccounts": {
        const connected = await getDappConnectionForOrigin(origin);
        // Only a connected (approved) origin may see the full account list.
        if (!connected) {
          sendResponse({ ok: true, result: [] });
          return;
        }
        const result = bootstrap.walletState.accounts.map((a) =>
          toSafeAccountMeta(a, bootstrap.walletState.selectedAccountId),
        );
        sendResponse({ ok: true, result });
        return;
      }

      // Switch the active signer account. `simpl_switchAccount` is the preferred
      // name (accepts accountId); `simpl_setActiveAccount` is kept as an alias.
      //
      // SECURITY: the active account decides which key signs the next
      // transaction/message, so a connected dApp must NOT be able to reassign it
      // silently. This routes through the same explicit user-approval popup as
      // wallet_switchEthereumChain — the account only changes after the user
      // confirms. (Was previously applied immediately for any connected origin.)
      case "simpl_switchAccount":
      case "simpl_setActiveAccount": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }
        const param = message.params[0] as Record<string, unknown> | undefined;
        const targetId =
          typeof param?.["accountId"] === "string"
            ? (param["accountId"] as string)
            : typeof param?.["id"] === "string"
              ? (param["id"] as string)
              : null;
        const targetAddress = typeof param?.["address"] === "string" ? (param["address"] as string) : null;
        const match = bootstrap.walletState.accounts.find(
          (a) =>
            (targetId !== null && a.id === targetId) ||
            (targetAddress !== null && a.address.toLowerCase() === targetAddress.toLowerCase()),
        );
        if (!match) {
          sendResponse({ ok: false, error: { code: -32602, message: "Unknown account." } });
          return;
        }
        // Already active — no-op success, no approval popup.
        if (match.id === bootstrap.walletState.selectedAccountId) {
          sendResponse({ ok: true, result: [match.address] });
          return;
        }

        const switchAccountApprovalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(switchAccountApprovalId, {
          id: switchAccountApprovalId,
          origin,
          kind: "switch_account",
          switchAccountId: match.id,
          switchAccountAddress: match.address,
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(switchAccountApprovalId);
        return;
      }

      case "simpl_openWallet": {
        const param = message.params[0] as Record<string, unknown> | undefined;
        const route = typeof param?.["route"] === "string" ? (param["route"] as string) : "accounts";
        await openWalletToRoute(route);
        sendResponse({ ok: true, result: true });
        return;
      }

      default: {
        sendResponse({
          ok: false,
          error: { code: 4200, message: `Method not supported: ${method}` },
        });
        return;
      }
    }
  } catch (err) {
    sendResponse({
      ok: false,
      error: { code: -32603, message: getErrorMessage(err) },
    });
  }
}

// =============================================================
//  TRON Injected Provider (TronLink-compatible) — Connect MVP
//  Requests arrive with namespace "tron" so they never collide
//  with the EVM provider. Accounts are always TRON base58 (T...),
//  never EVM 0x addresses. chainId is the TRON mainnet id.
// =============================================================
async function handleTronDappRequest(
  message: { method: string; params: unknown[]; origin: string },
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const { method, origin } = message;

  // Resolve the selected account's TRON address (base58 + hex). Returns null
  // when the wallet is locked or has no TRON-capable account.
  const getInfo = () =>
    walletService.getSelectedTronAccountInfo().catch(() => null);

  try {
    switch (method) {
      // Silent: current accounts if already connected, else [].
      case "tron_accounts":
      case "eth_accounts": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: true, result: [] });
          return;
        }
        const info = await getInfo();
        sendResponse({ ok: true, result: info ? [info.base58] : [] });
        return;
      }

      // Silent hydrate for window.tronWeb.defaultAddress — only when connected.
      case "tron_getAccount": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: true, result: null });
          return;
        }
        const info = await getInfo();
        sendResponse({
          ok: true,
          result: info
            ? { base58: info.base58, hex: info.hex, chainId: TRON_CHAIN_ID_HEX }
            : null,
        });
        return;
      }

      case "tron_chainId":
      case "eth_chainId": {
        sendResponse({ ok: true, result: TRON_CHAIN_ID_HEX });
        return;
      }

      case "net_version": {
        sendResponse({ ok: true, result: String(TRON_MAINNET_CHAIN_ID) });
        return;
      }

      case "tron_requestAccounts":
      case "eth_requestAccounts": {
        const info = await getInfo();

        // Wallet locked / no TRON account — cannot show or return an address.
        if (!info) {
          sendResponse({
            ok: false,
            error: {
              code: 4900,
              message: "Wallet is locked. Please unlock SIMPL Wallet first.",
            },
          });
          return;
        }

        // Already connected — return the TRON address immediately.
        if (await getDappConnectionForOrigin(origin)) {
          sendResponse({ ok: true, result: [info.base58] });
          return;
        }

        // A connect approval for this origin is already open — EIP-1193 -32002.
        for (const existing of pendingDappApprovals.values()) {
          if (existing.origin === origin && existing.kind === "tron_connect") {
            sendResponse({
              ok: false,
              error: {
                code: -32002,
                message: "A connection request is already pending. Open SIMPL to continue.",
              },
            });
            return;
          }
        }

        const approvalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(approvalId, {
          id: approvalId,
          origin,
          kind: "tron_connect",
          namespace: "tron",
          tronAddress: info.base58,
          tronAddressHex: info.hex,
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(approvalId);
        return;
      }

      // Return the connected account as a permission object if connected.
      case "wallet_getPermissions":
      case "tron_getPermissions": {
        const connected = await getDappConnectionForOrigin(origin);
        const info = connected ? await getInfo() : null;
        sendResponse({
          ok: true,
          result: info
            ? [
                {
                  parentCapability: "tron_accounts",
                  caveats: [
                    { type: "restrictReturnedAccounts", value: [info.base58] },
                  ],
                },
              ]
            : [],
        });
        return;
      }

      case "tron_signTransaction":
      case "tron_sign": {
        if (!(await getDappConnectionForOrigin(origin))) {
          sendResponse({
            ok: false,
            error: { code: 4100, message: "Unauthorized. Connect the site first." },
          });
          return;
        }

        const info = await getInfo();
        if (!info) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
          return;
        }

        const tx = message.params[0];
        if (!tx || typeof tx !== "object") {
          sendResponse({
            ok: false,
            error: { code: -32602, message: "Invalid TRON transaction." },
          });
          return;
        }

        const approvalId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        pendingDappApprovals.set(approvalId, {
          id: approvalId,
          origin,
          kind: "tron_sign",
          namespace: "tron",
          tronAddress: info.base58,
          tronAddressHex: info.hex,
          tronTransaction: tx,
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });
        await openDappApprovalWindow(approvalId);
        return;
      }

      default: {
        sendResponse({
          ok: false,
          error: { code: 4200, message: `Method not supported: ${method}` },
        });
        return;
      }
    }
  } catch (err) {
    sendResponse({
      ok: false,
      error: { code: -32603, message: getErrorMessage(err) },
    });
  }
}

// Route dApp RPC requests from content scripts. TRON-namespace requests go to
// the TRON-specific handler; everything else uses the EVM handler.
chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SIMPL_DAPP_REQUEST") return false;

    const request = {
      method: message.method as string,
      params: Array.isArray(message.params) ? (message.params as unknown[]) : [],
      origin: (message.origin as string | undefined) ?? (sender.origin ?? sender.url ?? ""),
    };

    if (message.namespace === "tron") {
      void handleTronDappRequest(request, sendResponse);
    } else {
      void handleDappRequest(request, sendResponse);
    }

    return true; // keep channel open for async response
  },
);

// Approval popup queries pending approval details.
chrome.runtime.onMessage.addListener(
  (message: any, _sender, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SIMPL_DAPP_GET_PENDING") return false;

    const id = message.id as string;
    const pending = pendingDappApprovals.get(id);

    if (!pending) {
      sendResponse({ ok: false, error: "Approval request not found or already handled." });
      return true;
    }

    void walletService
      .bootstrap()
      .then((bootstrap) => {
        sendResponse({
          ok: true,
          pending: {
            origin: pending.origin,
            address: bootstrap.selectedAccount?.address ?? null,
            chainId: bootstrap.walletState.selectedChainId,
            kind: pending.kind,
            ...(pending.kind === "personal_sign"
              ? { displayMessage: extractPersonalSignDisplay(pending.signingParams?.params ?? []) }
              : {}),
            ...(pending.kind === "typed_data"
              ? { typedDataDisplay: extractTypedDataDisplay(pending.signingParams?.params ?? []) }
              : {}),
            ...(pending.kind === "switch_chain" && pending.switchChainId !== undefined
              ? {
                  switchChain: {
                    requestedChainId: pending.switchChainId,
                    requestedChainName: getChainById(pending.switchChainId)?.name ?? `Chain ${pending.switchChainId}`,
                    currentChainId: bootstrap.walletState.selectedChainId,
                    currentChainName: getChainById(bootstrap.walletState.selectedChainId)?.name ?? `Chain ${bootstrap.walletState.selectedChainId}`,
                  },
                }
              : {}),
            ...(pending.kind === "switch_account" && pending.switchAccountId
              ? {
                  switchAccount: (() => {
                    const requested = bootstrap.walletState.accounts.find(
                      (a) => a.id === pending.switchAccountId,
                    );
                    const current = bootstrap.selectedAccount;
                    return {
                      requestedAccountLabel: requested?.label ?? "Account",
                      requestedAccountAddress: pending.switchAccountAddress ?? requested?.address ?? "",
                      currentAccountLabel: current?.label ?? "Account",
                      currentAccountAddress: current?.address ?? "",
                    };
                  })(),
                }
              : {}),
            ...(pending.kind === "transaction" && pending.transactionParams
              ? {
                  transaction: {
                    from: pending.transactionParams.from,
                    to: pending.transactionParams.to,
                    value: pending.transactionParams.value ?? "0x0",
                    data: pending.transactionParams.data,
                    networkName: getChainById(bootstrap.walletState.selectedChainId)?.name ?? `Chain ${bootstrap.walletState.selectedChainId}`,
                    nativeCurrencySymbol: getChainById(bootstrap.walletState.selectedChainId)?.nativeCurrency.symbol ?? "ETH",
                    erc20Approve: decodeErc20Approve(pending.transactionParams.data) ?? undefined,
                  },
                }
              : {}),
            // TRON connect/sign: override with the TRON base58 address and a
            // TRON-Mainnet network label (the popup must never show a 0x addr).
            ...(pending.namespace === "tron"
              ? {
                  address: pending.tronAddress ?? null,
                  network: "TRON Mainnet",
                  chainIdHex: TRON_CHAIN_ID_HEX,
                  ...(pending.kind === "tron_sign"
                    ? { tronTransaction: extractTronTxDisplay(pending.tronTransaction) }
                    : {}),
                }
              : {}),
          },
        });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: getErrorMessage(err) });
      });

    return true;
  },
);

// Approval popup — user clicked "Connect".
chrome.runtime.onMessage.addListener(
  (message: any, _sender, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SIMPL_DAPP_APPROVE") return false;

    const id = message.id as string;
    const pending = pendingDappApprovals.get(id);

    if (!pending) {
      sendResponse({ ok: false, error: "Approval not found." });
      return true;
    }

    const password = typeof message.password === "string" ? message.password : undefined;

    void walletService
      .bootstrap()
      .then(async (bootstrap) => {
        const address = bootstrap.selectedAccount?.address;
        if (!address) {
          pendingDappApprovals.delete(id);
          pending.reject({ code: 4900, message: "Wallet is locked." });
          sendResponse({ ok: false, error: "Wallet is locked." });
          return;
        }

        if (pending.kind === "connect") {
          pendingDappApprovals.delete(id);
          const acct = bootstrap.selectedAccount;
          await saveDappConnection(
            pending.origin,
            "evm",
            acct ? { id: acct.id, address: acct.address } : undefined,
          );
          void auditLog({ type: "site_connected", at: new Date().toISOString(), origin: pending.origin, detail: shortAddr(address) });
          pending.resolve([address]);
        } else if (pending.kind === "tron_connect") {
          pendingDappApprovals.delete(id);
          await saveDappConnection(
            pending.origin,
            "tron",
            pending.tronAddress ? { id: pending.tronAddress, address: pending.tronAddress } : undefined,
          );
          void auditLog({ type: "site_connected", at: new Date().toISOString(), origin: pending.origin, detail: "TRON" });
          pending.resolve(pending.tronAddress ? [pending.tronAddress] : []);
          // Notify the TRON provider so window.tronWeb hydrates immediately.
          await broadcastProviderEvent("connect", { chainId: TRON_CHAIN_ID_HEX }, "tron");
          await broadcastProviderEvent("accountsChanged", pending.tronAddress ? [pending.tronAddress] : [], "tron");
          await broadcastProviderEvent("chainChanged", { chainId: TRON_CHAIN_ID_HEX }, "tron");
        } else if (pending.kind === "tron_sign") {
          const signed = await walletService.signTronDappTransaction({
            transaction: pending.tronTransaction,
            password,
          });
          pendingDappApprovals.delete(id);
          void auditLog({ type: "method_approved", at: new Date().toISOString(), origin: pending.origin, method: "tron_sign" });
          pending.resolve(signed);
        } else if (pending.kind === "personal_sign") {
          const result = await walletService.signSelectedPersonalMessage({
            params: pending.signingParams?.params ?? [],
            password,
          });
          pendingDappApprovals.delete(id);
          void auditLog({ type: "method_approved", at: new Date().toISOString(), origin: pending.origin, method: "personal_sign" });
          pending.resolve(result.signature);
        } else if (pending.kind === "typed_data") {
          const result = await walletService.signSelectedTypedDataV4({
            params: pending.signingParams?.params ?? [],
            password,
          });
          pendingDappApprovals.delete(id);
          void auditLog({ type: "method_approved", at: new Date().toISOString(), origin: pending.origin, method: "eth_signTypedData_v4" });
          pending.resolve(result.signature);
        } else if (pending.kind === "switch_chain" && pending.switchChainId !== undefined) {
          await walletService.setSelectedChainId(pending.switchChainId);
          // Record the newly-approved chain on the site's permission so future
          // switches to it are direct.
          const chainPerms = await readPermissions();
          const current = findByOrigin(chainPerms, pending.origin);
          if (current) {
            const nextChains: ConnectedSiteChain[] = hasChainPermission(current, {
              namespace: "eip155",
              chainId: String(pending.switchChainId),
            })
              ? current.chains
              : [
                  ...current.chains,
                  {
                    namespace: "eip155" as const,
                    chainId: String(pending.switchChainId),
                    label: getChainById(pending.switchChainId)?.name,
                  },
                ];
            await writePermissions(
              grantConnectedSitePermission(
                chainPerms,
                {
                  origin: current.origin,
                  source: current.source,
                  ...(current.topic ? { topic: current.topic } : {}),
                  ...(current.name ? { name: current.name } : {}),
                  ...(current.icon ? { icon: current.icon } : {}),
                  accounts: current.accounts,
                  chains: nextChains,
                  methods: current.methods,
                  ...(current.expiresAt ? { expiresAt: current.expiresAt } : {}),
                },
                new Date().toISOString(),
              ),
            );
          }
          pendingDappApprovals.delete(id);
          void auditLog({ type: "chain_switch_approved", at: new Date().toISOString(), origin: pending.origin, detail: String(pending.switchChainId) });
          pending.resolve(null);
          await broadcastProviderEvent("chainChanged", `0x${pending.switchChainId.toString(16)}`);
        } else if (pending.kind === "switch_account" && pending.switchAccountId) {
          const { walletState: nextState, selectedAccount: nextSelected } =
            await walletService.selectAccount({ accountId: pending.switchAccountId });
          // Add the newly-active account to this site's permission so
          // eth_accounts reflects it.
          const acctPerms = await readPermissions();
          const currentPerm = findByOrigin(acctPerms, pending.origin);
          if (currentPerm && !hasAccountPermission(currentPerm, nextSelected.address)) {
            await writePermissions(
              grantConnectedSitePermission(
                acctPerms,
                {
                  origin: currentPerm.origin,
                  source: currentPerm.source,
                  ...(currentPerm.topic ? { topic: currentPerm.topic } : {}),
                  ...(currentPerm.name ? { name: currentPerm.name } : {}),
                  ...(currentPerm.icon ? { icon: currentPerm.icon } : {}),
                  accounts: [
                    ...currentPerm.accounts,
                    { accountId: nextSelected.id, address: nextSelected.address, type: "evm" },
                  ],
                  chains: currentPerm.chains,
                  methods: currentPerm.methods,
                  ...(currentPerm.expiresAt ? { expiresAt: currentPerm.expiresAt } : {}),
                },
                new Date().toISOString(),
              ),
            );
          }
          pendingDappApprovals.delete(id);
          void auditLog({ type: "account_switch_approved", at: new Date().toISOString(), origin: pending.origin, detail: shortAddr(nextSelected.address) });
          // Notify every connected dApp of the new active account (standard
          // event) + push the sanitized list so first-party surfaces update.
          await broadcastProviderEvent("accountsChanged", [nextSelected.address]);
          await broadcastProviderEvent(
            "simpl_accountsChanged",
            nextState.accounts.map((a) => toSafeAccountMeta(a, nextState.selectedAccountId)),
          );
          pending.resolve([nextSelected.address]);
        } else if (pending.kind === "transaction" && pending.transactionParams) {
          const result = await walletService.sendSelectedPreparedTransaction({
            transaction: {
              to: pending.transactionParams.to,
              value: pending.transactionParams.value,
              data: pending.transactionParams.data,
              gas: pending.transactionParams.gas,
              gasPrice: pending.transactionParams.gasPrice,
            },
            password,
          });
          pendingDappApprovals.delete(id);
          void auditLog({ type: "method_approved", at: new Date().toISOString(), origin: pending.origin, method: "eth_sendTransaction" });
          pending.resolve(result.hash);
        }
        sendResponse({ ok: true });

        // Close the approval window.
        if (dappApprovalWindowId !== null) {
          try { await chrome.windows.remove(dappApprovalWindowId); } catch { /* already closed */ }
          dappApprovalWindowId = null;
        }
      })
      .catch((err) => {
        // connect, tron_connect and switch_chain have no retry — reject and clean
        // up immediately. personal_sign, typed_data, transaction and tron_sign
        // keep pending alive for password retry.
        if (
          pending.kind === "connect" ||
          pending.kind === "tron_connect" ||
          pending.kind === "switch_chain" ||
          pending.kind === "switch_account"
        ) {
          pendingDappApprovals.delete(id);
          pending.reject({ code: -32603, message: getErrorMessage(err) });
        }
        sendResponse({ ok: false, error: getErrorMessage(err) });
      });

    return true;
  },
);

// Approval popup — user clicked "Reject".
chrome.runtime.onMessage.addListener(
  (message: any, _sender, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SIMPL_DAPP_REJECT") return false;

    const id = message.id as string;
    const pending = pendingDappApprovals.get(id);

    if (pending) {
      pendingDappApprovals.delete(id);
      const rejectAudit: AuditEvent["type"] =
        pending.kind === "connect" || pending.kind === "tron_connect"
          ? "site_rejected"
          : pending.kind === "switch_chain"
            ? "chain_switch_rejected"
            : pending.kind === "switch_account"
              ? "account_switch_rejected"
              : "method_rejected";
      void auditLog({ type: rejectAudit, at: new Date().toISOString(), origin: pending.origin });
      pending.reject({ code: 4001, message: "User rejected the request." });
    }

    sendResponse({ ok: true });

    // Close the approval window.
    if (dappApprovalWindowId !== null) {
      void chrome.windows.remove(dappApprovalWindowId).catch(() => {/* already closed */});
      dappApprovalWindowId = null;
    }

    return true;
  },
);
