# Chrome Web Store — Screenshots & Assets Plan

Plan for the CWS listing images. **Rules:** use a dedicated **test wallet on a
testnet**; never show a real recovery phrase, private key, or personal address;
mask any address that isn't a test address; no overclaim in captions; provide
both light and dark where noted. CWS screenshots are **1280×800** (or 640×400).

## Screenshots

| # | Route / screen | Show | Sensitive-data handling | Theme | Filename | Caption |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Home / portfolio | balance, accounts chip, asset list | test wallet; test addresses | light | `01-home.png` | "Your multi-chain portfolio at a glance" |
| 2 | Asset detail | price chart, balance, actions | test data | dark | `02-asset-detail.png` | "Per-asset detail with price history" |
| 3 | Send | recipient/amount/fee | test address, testnet | light | `03-send.png` | "Send on any supported network" |
| 4 | Receive | address + QR | test address only | light | `04-receive.png` | "Receive with address + QR" |
| 5 | Swap quote | you-pay/receive, **fee breakdown**, min received, price impact | test tokens | light | `05-swap.png` | "Swap with a clear fee and price-impact breakdown" |
| 6 | Bridge route | source/destination chain, est. time, fee | test data | dark | `06-bridge.png` | "Bridge across chains" |
| 7 | dApp approval | connect/sign approval popup | test origin | light | `07-dapp-approval.png` | "Explicit approval for every dApp request" |
| 8 | WalletConnect approval | proposal (peer, chains, methods) | test dApp | light | `08-wc-approval.png` | "Approve WalletConnect sessions explicitly" |
| 9 | Connected Sites | site list + scope + revoke | test sites | dark | `09-connected-sites.png` | "See and revoke connected sites anytime" |
| 10 | Security Center / backup | backup status, verify action | no phrase shown | light | `10-security.png` | "Back up and verify your recovery phrase" |
| 11 | Settings / privacy | networks, language, security | none | dark | `11-settings.png` | "Privacy-first settings" |

## Promo / branding

- Small promo tile 440×280 and marquee 1400×560 (optional): wordmark on the
  minimalist black/white background; no feature overclaim.
- Store icon: reuse the 128×128 extension icon (`public/icons/icon-128.png`).

## Do NOT

- Do not capture a screen that displays the recovery phrase or a private key
  (the backup/reveal screens must be shown only in a masked/placeholder state, or
  skipped).
- Do not show a real personal wallet address.
- Do not caption a feature that isn't shipped (e.g. networks not in the registry).
