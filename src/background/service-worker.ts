/// <reference types="chrome" />

import { walletService } from "../core/wallet/wallet.service";



function disableSidePanelOnActionClick() {
  if (!chrome.sidePanel?.setPanelBehavior) {
    console.debug("chrome.sidePanel API is not available.");
    return;
  }

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .then(() => {
      console.log("Side panel on action click disabled.");
    })
    .catch((error) => {
      console.error("Failed to disable side panel behavior:", error);
    });
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("Local EVM Wallet extension installed.");
  disableSidePanelOnActionClick();
  void pingWalletConnectEngine();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Local EVM Wallet extension started.");
  disableSidePanelOnActionClick();
  void pingWalletConnectEngine();
});

// Also run once when service worker is evaluated.
disableSidePanelOnActionClick();

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

  return createdWindow?.id;
}

chrome.windows?.onRemoved?.addListener((windowId) => {
  if (walletConnectApprovalWindowId === windowId) {
    walletConnectApprovalWindowId = null;
  }
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
        void chrome.storage.local.set({
          lastWalletConnectSelectedChainSwitch: {
            chainId,
            selectedChainId: walletState.selectedChainId,
            createdAt: new Date().toISOString(),
          },
        });

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
  resolve: (result: unknown) => void;
  reject: (error: { code: number; message: string }) => void;
};

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

// Read the connectedSites array from storage (same format as ConnectedSitesPage).
async function getDappConnectionForOrigin(origin: string): Promise<boolean> {
  const stored = await chrome.storage.local.get("connectedSites");
  const sites = stored["connectedSites"];
  if (!Array.isArray(sites)) return false;
  return sites.some(
    (s: unknown) =>
      s !== null &&
      typeof s === "object" &&
      (s as Record<string, unknown>)["origin"] === origin,
  );
}

// Save a new connection to the connectedSites array (same format as ConnectedSitesPage).
async function saveDappConnection(origin: string): Promise<void> {
  const stored = await chrome.storage.local.get("connectedSites");
  const existing = Array.isArray(stored["connectedSites"])
    ? (stored["connectedSites"] as unknown[])
    : [];

  // Avoid duplicates.
  const filtered = existing.filter(
    (s) =>
      s !== null &&
      typeof s === "object" &&
      (s as Record<string, unknown>)["origin"] !== origin,
  );

  const now = new Date().toISOString();
  filtered.push({
    id: origin,
    origin,
    connectedAt: now,
    lastUsedAt: now,
  });

  await chrome.storage.local.set({ connectedSites: filtered });
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

    switch (method) {
      case "eth_accounts": {
        const connected = await getDappConnectionForOrigin(origin);
        sendResponse({ ok: true, result: connected && address ? [address] : [] });
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
        // Already connected — return accounts immediately.
        const alreadyConnected = await getDappConnectionForOrigin(origin);
        if (alreadyConnected && address) {
          sendResponse({ ok: true, result: [address] });
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

// Route dApp RPC requests from content scripts.
chrome.runtime.onMessage.addListener(
  (message: any, sender, sendResponse: (response: unknown) => void) => {
    if (message?.type !== "SIMPL_DAPP_REQUEST") return false;

    void handleDappRequest(
      {
        method: message.method as string,
        params: Array.isArray(message.params) ? (message.params as unknown[]) : [],
        origin: (message.origin as string | undefined) ?? (sender.origin ?? sender.url ?? ""),
      },
      sendResponse,
    );

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

    pendingDappApprovals.delete(id);

    void walletService
      .bootstrap()
      .then(async (bootstrap) => {
        const address = bootstrap.selectedAccount?.address;
        if (!address) {
          pending.reject({ code: 4900, message: "Wallet is locked." });
          sendResponse({ ok: false, error: "Wallet is locked." });
          return;
        }

        await saveDappConnection(pending.origin);
        pending.resolve([address]);
        sendResponse({ ok: true });

        // Close the approval window.
        if (dappApprovalWindowId !== null) {
          try { await chrome.windows.remove(dappApprovalWindowId); } catch { /* already closed */ }
          dappApprovalWindowId = null;
        }
      })
      .catch((err) => {
        pending.reject({ code: -32603, message: getErrorMessage(err) });
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
