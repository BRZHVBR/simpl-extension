/// <reference types="chrome" />

import { walletService } from "../core/wallet/wallet.service";
import { getChainById } from "../core/networks/chain-registry";



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
  kind: "connect" | "personal_sign" | "typed_data" | "switch_chain" | "transaction";
  signingParams?: { method: string; params: unknown[] };
  switchChainId?: number;
  transactionParams?: {
    from: string;
    to: string;
    value?: string;
    data?: string;
    gas?: string;
    gasPrice?: string;
  };
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

async function broadcastProviderEvent(event: string, data: unknown): Promise<void> {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      chrome.tabs.sendMessage(tab.id, { type: "SIMPL_PROVIDER_EVENT", event, data }).catch(() => {});
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
          kind: "connect",
          resolve: (result) => sendResponse({ ok: true, result }),
          reject: (error) => sendResponse({ ok: false, error }),
        });

        await openDappApprovalWindow(approvalId);
        return;
      }

      case "personal_sign": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
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
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized. Connect the site first." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
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

      case "eth_sendTransaction": {
        const connected = await getDappConnectionForOrigin(origin);
        if (!connected) {
          sendResponse({ ok: false, error: { code: 4100, message: "Unauthorized: connect wallet first." } });
          return;
        }
        if (!address) {
          sendResponse({ ok: false, error: { code: 4900, message: "Wallet is locked." } });
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
            ...(pending.kind === "transaction" && pending.transactionParams
              ? {
                  transaction: {
                    from: pending.transactionParams.from,
                    to: pending.transactionParams.to,
                    value: pending.transactionParams.value ?? "0x0",
                    data: pending.transactionParams.data,
                    networkName: getChainById(bootstrap.walletState.selectedChainId)?.name ?? `Chain ${bootstrap.walletState.selectedChainId}`,
                    nativeCurrencySymbol: getChainById(bootstrap.walletState.selectedChainId)?.nativeCurrency.symbol ?? "ETH",
                  },
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
          await saveDappConnection(pending.origin);
          pending.resolve([address]);
        } else if (pending.kind === "personal_sign") {
          const result = await walletService.signSelectedPersonalMessage({
            params: pending.signingParams?.params ?? [],
            password,
          });
          pendingDappApprovals.delete(id);
          pending.resolve(result.signature);
        } else if (pending.kind === "typed_data") {
          const result = await walletService.signSelectedTypedDataV4({
            params: pending.signingParams?.params ?? [],
            password,
          });
          pendingDappApprovals.delete(id);
          pending.resolve(result.signature);
        } else if (pending.kind === "switch_chain" && pending.switchChainId !== undefined) {
          await walletService.setSelectedChainId(pending.switchChainId);
          pendingDappApprovals.delete(id);
          pending.resolve(null);
          await broadcastProviderEvent("chainChanged", `0x${pending.switchChainId.toString(16)}`);
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
        // connect and switch_chain have no retry — reject and clean up immediately.
        // personal_sign, typed_data, and transaction keep pending alive for password retry.
        if (pending.kind === "connect" || pending.kind === "switch_chain") {
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
