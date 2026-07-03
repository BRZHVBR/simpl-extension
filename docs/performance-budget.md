# Performance Budget

Bundle + asset budgets and the lazy-loading / heavy-library policy. Enforced by
`npm run check:bundle` (after a build) and `npm run check:assets`, both in
`npm run check:release`.

## Bundle budget

| Target | Budget | Enforcement |
| --- | --- | --- |
| Popup main chunk (`App.js`) | ≤ 500 kB raw | hard fail |
| Any single chunk | ≤ 3 MB raw | hard fail (runaway) |
| Other chunks 500 kB–3 MB | — | warning |
| Allowlisted heavy chunks (`wallet.service`, `walletconnectOffscreen`, `runtime-overrides`) | tracked | warning only |

## Before / after (this stage)

| Chunk / asset | Before | After |
| --- | --- | --- |
| `App.js` | 645 kB | **262 kB** |
| `runtime-overrides.js` | 696 kB | **182 kB** |
| `simpl-logo.png` | 674 kB | **104 kB** (2172→640 px) |
| Heavy routes | bundled in App.js | separate lazy chunks (Swap 68, Bridge 49, Settings 44, Receive 36, Send 27, History 12 kB…) |
| `wallet.service.js` | 2.29 MB | 2.03 MB (shared crypto core — per-chain split is a follow-up) |

## Lazy-loading policy

Critical path (`WelcomePage`, `CreateWalletPage`, `ImportWalletPage`,
`UnlockPage`, `HomePage`) is eager so unlock + Home load instantly. Everything
else is `React.lazy` behind `<Suspense>` + a `RouteErrorBoundary` in
`src/popup/App.tsx`: Send, Swap, Bridge, Receive (QR), Accounts/AddAccount/
AccountDetails/AddWatchWallet/ImportAccount, AddCustomToken, Reveal seed/private
key, SeedBackupVerification, Settings, Transaction history/details. Approval
windows (`dapp-approval`, `walletconnect-approval`) are separate entry points and
are unaffected.

## Heavy-library policy

- Solana/Jupiter, Bitcoin, TRON, swap/bridge clients, QR, charts load only on the
  routes that use them (now lazy). Home no longer pulls swap/bridge/WC route code.
- WalletConnect libs live in the offscreen engine + the WC/approval entry points.
- **Follow-up (Stage 8):** `wallet.service.js` (~2 MB) is the shared multichain
  crypto core loaded on Home for balances. Splitting per-network signing/adapters
  behind dynamic imports is the next win; deferred here because it touches the
  security-sensitive signing path and must not be a risky partial change.

## Asset budget

- No shipped image > 500 kB (hard fail); > 150 kB warns.
- No `.DS_Store` / junk in `public/` or `src/assets`.
- Extension icons 16/32/48/128 present.
- No remote assets (CSP + inventory enforced elsewhere).
