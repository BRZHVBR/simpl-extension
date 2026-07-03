# Chrome Web Store — Reviewer Notes

Calm, factual notes for the CWS review team. simpl is a self-custodial,
multi-chain crypto wallet browser extension (MV3).

## What the extension does

Create/import a wallet (recovery phrase or private key), manage accounts and
balances across Ethereum, BNB Chain, Base, Solana, Bitcoin, TRON and TON (plus
Sepolia / Bitcoin Testnet / Solana Devnet), send/receive, swap (same-chain) and
bridge (cross-chain), and connect to dApps via an injected provider and
WalletConnect — with an explicit approval popup for every connection, signature
and transaction.

## Permissions (why)

- `storage` — encrypted vault + local state/preferences/connected-sites.
- `tabs` — broadcast `accountsChanged`/`chainChanged` to connected dApp tabs and
  detect the active dApp origin for approvals (needs all tabs, not `activeTab`).
- `windows` — open the dedicated approval/signature popup windows.
- `offscreen` — run the WalletConnect engine (a service worker can't hold the
  long-lived socket/crypto).
- `sidePanel` — optional side-panel surface for the wallet.
- **No `nativeMessaging`**, no `scripting`, no `webRequest`, no `<all_urls>` in
  `host_permissions`. `host_permissions` is an explicit allowlist that matches
  the endpoints in `docs/endpoint-inventory.md` (RPC nodes, the Simpl API
  gateway, WalletConnect infra, token-metadata gateways).

## Why a content script on all http/https pages

The content scripts (`assets/inpage.js` + `assets/content.js`) inject the wallet
provider (`window.ethereum` / `window.tron`) so dApps on any site the user
chooses can request a connection — the same model as every mainstream wallet.
The content script only bridges provider requests between the page and the
background worker; it does **not** read arbitrary page content for analytics.
Every sensitive action (connect, sign, send, switch account/network) requires an
explicit user approval in a wallet popup, and connected sites can be revoked at
any time (Connected Sites).

## Not included

- No remote code execution: no `eval`/`new Function`, no remote/CDN script
  sources. CSP is `script-src 'self'; object-src 'self'`.
- No custody: keys stay in a local encrypted vault; the recovery phrase and
  private keys are never uploaded (see `docs/privacy-policy.md`).
- No native host in the public build (`nativeMessaging` absent).

## How to verify the main flows

1. Install → create a wallet (set a password, save + verify the recovery phrase).
2. Lock, then unlock with the password.
3. Receive (copy address / QR) and send on a testnet (Sepolia / Solana Devnet /
   Bitcoin Testnet).
4. Open a dApp → connect → observe the approval popup; try Approve and Reject.
5. Sign a message from a dApp → approval popup; Reject blocks it.
6. WalletConnect → pair a URI → approval; Reject creates no session.
7. Connected Sites → revoke a site → the dApp can no longer act without a new
   approval.
8. (Optional) Swap/bridge quote → review the fee/price-impact/minimum-received
   before confirming.

## Endpoints & privacy

Full endpoint inventory: `docs/endpoint-inventory.md`. Privacy policy:
`docs/privacy-policy.md`. Permission justification:
`docs/chrome-store-permissions.md`.

## Test notes

Use a fresh test wallet on a testnet; testnet faucets provide funds. Do not use a
personal seed phrase for review.
