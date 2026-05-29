import { useEffect, useState } from "react";

// chrome is a global in extension pages
declare const chrome: typeof globalThis extends { chrome: infer C } ? C : never;

type PendingData = {
  origin: string;
  address: string | null;
  chainId: number;
  chainName: string;
};

type PageState =
  | { status: "loading" }
  | { status: "locked" }
  | { status: "ready"; data: PendingData }
  | { status: "error"; message: string };

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainLabel(chainId: number): string {
  const names: Record<number, string> = {
    1: "Ethereum Mainnet",
    56: "BNB Smart Chain",
    8453: "Base",
    11155111: "Sepolia Testnet",
  };
  return names[chainId] ?? `Chain ${chainId}`;
}

function safeHostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

export default function DappApprovalPage() {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const approvalId = new URLSearchParams(location.search).get("id") ?? "";

  useEffect(() => {
    if (!approvalId) {
      setState({ status: "error", message: "Missing approval ID." });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      { type: "SIMPL_DAPP_GET_PENDING", id: approvalId },
      (response: { ok: boolean; pending?: PendingData; error?: string } | null) => {
        if (!response?.ok) {
          setState({ status: "error", message: response?.error ?? "Request not found." });
          return;
        }

        const pending = response.pending!;

        if (!pending.address) {
          setState({ status: "locked" });
          return;
        }

        setState({ status: "ready", data: pending });
      },
    );
  }, [approvalId]);

  function reject() {
    setWorking(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      { type: "SIMPL_DAPP_REJECT", id: approvalId },
      () => { window.close(); },
    );
  }

  function approve() {
    if (state.status !== "ready") return;
    setWorking(true);
    setErrorMsg("");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (chrome as any).runtime.sendMessage(
      { type: "SIMPL_DAPP_APPROVE", id: approvalId },
      (response: { ok: boolean; error?: string } | null) => {
        if (response?.ok) {
          window.close();
        } else {
          setWorking(false);
          setErrorMsg(response?.error ?? "Failed to connect.");
        }
      },
    );
  }

  // --- Render states ---

  if (state.status === "loading") {
    return (
      <div className="simple-page" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 360 }}>
        <span style={{ color: "var(--fg-muted)", fontSize: 14 }}>Loading…</span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="simple-page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 360, padding: 24 }}>
        <span style={{ fontSize: 32 }}>⚠</span>
        <p style={{ color: "var(--fg-muted)", fontSize: 14, textAlign: "center" }}>{state.message}</p>
        <button className="icbtn" onClick={() => window.close()} style={{ marginTop: 8 }}>Close</button>
      </div>
    );
  }

  if (state.status === "locked") {
    return (
      <div className="simple-page" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, minHeight: 360, padding: 24 }}>
        <span style={{ fontSize: 40 }}>🔒</span>
        <p style={{ fontWeight: 650, fontSize: 16, margin: 0 }}>Wallet is locked</p>
        <p style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center", margin: 0 }}>
          Open the SIMPL extension and unlock your wallet, then try connecting again.
        </p>
        <button className="icbtn" onClick={() => window.close()} style={{ marginTop: 4 }}>Close</button>
      </div>
    );
  }

  const { data } = state;
  const domain = safeHostname(data.origin);

  return (
    <div className="simple-page" style={{ display: "flex", flexDirection: "column", minHeight: 480 }}>

      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 650, color: "var(--fg-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Connect Wallet
        </span>
        <button
          type="button"
          className="icbtn"
          onClick={reject}
          disabled={working}
          style={{ fontSize: 18, lineHeight: 1 }}
          aria-label="Reject"
        >
          ×
        </button>
      </div>

      {/* Site info */}
      <div style={{ padding: "24px 20px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1 }}>
        {/* Globe icon placeholder */}
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: "var(--bg-sunken)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28,
        }}>
          🌐
        </div>

        <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{domain}</div>
        <div style={{ color: "var(--fg-muted)", fontSize: 13, textAlign: "center" }}>
          wants to connect to your wallet
        </div>

        {/* Divider */}
        <div style={{ width: "100%", height: 1, background: "var(--border)", margin: "16px 0 8px" }} />

        {/* Account row */}
        <div style={{
          width: "100%", padding: "12px 14px",
          background: "var(--bg-sunken)", borderRadius: 14,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 12,
            background: "var(--fg-base)", opacity: 0.08,
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: "var(--fg-muted)" }}>Wallet</div>
            <div style={{
              fontSize: 14, fontWeight: 600,
              fontFamily: "monospace", letterSpacing: "-0.02em",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {shortAddress(data.address!)}
            </div>
          </div>
          <div style={{
            fontSize: 11, fontWeight: 650, color: "var(--secure)",
            background: "var(--secure-bg, #e8f8ef)", padding: "3px 8px", borderRadius: 8,
          }}>
            Active
          </div>
        </div>

        {/* Network row */}
        <div style={{
          width: "100%", padding: "10px 14px",
          background: "var(--bg-sunken)", borderRadius: 14,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 13, color: "var(--fg-muted)" }}>Network</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{chainLabel(data.chainId)}</span>
        </div>

        {/* Permissions summary */}
        <div style={{
          width: "100%", padding: "12px 14px",
          background: "var(--bg-sunken)", borderRadius: 14,
          marginTop: 4,
        }}>
          <div style={{ fontSize: 12, fontWeight: 650, color: "var(--fg-muted)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Permissions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(["View your wallet address", "View your account balance"] as string[]).map((p) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--secure)", fontSize: 14 }}>✓</span>
                <span style={{ fontSize: 13 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>

        {errorMsg && (
          <div style={{ color: "var(--danger, #dc2626)", fontSize: 13, textAlign: "center", marginTop: 4 }}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{
        padding: "16px 20px 24px",
        display: "flex", gap: 10,
      }}>
        <button
          type="button"
          className="btn-secondary"
          onClick={reject}
          disabled={working}
          style={{ flex: 1, padding: "12px 0", borderRadius: 14, fontSize: 15, fontWeight: 650 }}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={approve}
          disabled={working}
          style={{ flex: 1, padding: "12px 0", borderRadius: 14, fontSize: 15, fontWeight: 650 }}
        >
          {working ? "Connecting…" : "Connect"}
        </button>
      </div>
    </div>
  );
}
