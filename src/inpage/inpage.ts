// src/inpage/inpage.ts
// Runs in the page's MAIN world (declared via manifest content_scripts world: "MAIN").
// ZERO runtime imports — must compile to a flat classic script with no import/export.
// Wrapped in IIFE to avoid polluting the page's global scope.

(function () {
  "use strict";

  // Guard: don't inject twice (e.g. in multi-frame pages).
  if ((window as unknown as Record<string, unknown>)["__simplInjected"]) return;
  (window as unknown as Record<string, unknown>)["__simplInjected"] = true;

  const SIMPL_REQ = "SIMPL_PROVIDER_REQUEST";
  const SIMPL_RES = "SIMPL_PROVIDER_RESPONSE";
  const SIMPL_EVT = "SIMPL_PROVIDER_EVENT";

  type RpcError = { code: number; message: string };
  type EthHandler = (...args: unknown[]) => void;
  type RequestArgs = { method: string; params?: readonly unknown[] | unknown[] };

  interface SimplProvider {
    isMetaMask: boolean;
    isSimpl: boolean;
    request(args: RequestArgs): Promise<unknown>;
    on(event: string, handler: EthHandler): SimplProvider;
    removeListener(event: string, handler: EthHandler): SimplProvider;
    off(event: string, handler: EthHandler): SimplProvider;
    sendAsync(
      payload: { id?: number; method: string; params?: unknown[] },
      cb: (err: Error | null, res: unknown) => void,
    ): void;
  }

  const pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  const listeners = new Map<string, Set<EthHandler>>();

  let idCounter = 0;
  function nextId(): string {
    idCounter += 1;
    return `simpl-${Date.now().toString(36)}-${idCounter.toString(36)}`;
  }

  window.addEventListener("message", (ev: MessageEvent) => {
    if (ev.source !== window) return;
    const d = ev.data as Record<string, unknown> | null;
    if (!d || typeof d !== "object") return;

    if (d["type"] === SIMPL_RES) {
      const id = d["id"] as string;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);

      if (d["error"]) {
        const e = d["error"] as Partial<RpcError>;
        const err = new Error(e.message ?? "Request failed");
        (err as unknown as Record<string, unknown>)["code"] = e.code ?? -32603;
        entry.reject(err);
      } else {
        entry.resolve(d["result"]);
      }
      return;
    }

    if (d["type"] === SIMPL_EVT) {
      const eventName = d["event"] as string;
      const eventData = d["data"];
      listeners.get(eventName)?.forEach((h) => {
        try {
          h(eventData);
        } catch {
          // Swallow handler errors to keep other handlers running.
        }
      });
    }
  });

  function sendRpcRequest(method: string, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      window.postMessage({ type: SIMPL_REQ, id, method, params }, "*");
    });
  }

  const provider: SimplProvider = {
    isMetaMask: false,
    isSimpl: true,

    request(args: RequestArgs): Promise<unknown> {
      const { method, params = [] } = args;
      return sendRpcRequest(method, Array.from(params));
    },

    on(event: string, handler: EthHandler): SimplProvider {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
      return provider;
    },

    removeListener(event: string, handler: EthHandler): SimplProvider {
      listeners.get(event)?.delete(handler);
      return provider;
    },

    off(event: string, handler: EthHandler): SimplProvider {
      return provider.removeListener(event, handler);
    },

    sendAsync(
      payload: { id?: number; method: string; params?: unknown[] },
      cb: (err: Error | null, res: unknown) => void,
    ): void {
      provider
        .request({ method: payload.method, params: payload.params })
        .then((result: unknown) => {
          cb(null, { jsonrpc: "2.0", id: payload.id, result });
        })
        .catch((err: unknown) => {
          cb(err instanceof Error ? err : new Error(String(err)), null);
        });
    },
  };

  // Always expose SIMPL on a dedicated namespace.
  // Set window.ethereum only if no other wallet has claimed it.
  const win = window as unknown as Record<string, unknown>;
  win["simplEthereum"] = provider;

  if (!win["ethereum"]) {
    win["ethereum"] = provider;
  }

  // EIP-6963: announce for multi-wallet dApps.
  const eip6963Info = {
    uuid: "b1a4c8d2-3f5e-4a7b-9c0d-1e2f3a4b5c6d",
    name: "SIMPL Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHJ4PSI4IiBmaWxsPSIjMTExMTExIi8+PHRleHQgeD0iMTYiIHk9IjIxIiB0ZXh0LUFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjE0IiBmb250LXdlaWdodD0iNzAwIiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCBzYW5zLXNlcmlmIiBmaWxsPSJ3aGl0ZSI+UzwvdGV4dD48L3N2Zz4=",
    rdns: "com.simplwallet",
  };

  function announce(): void {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info: eip6963Info, provider }),
      }),
    );
  }

  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
