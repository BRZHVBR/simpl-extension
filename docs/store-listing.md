# Chrome Web Store — Listing (canonical)

Code-verified listing copy for simpl. Every claim here is checked against the
actual code (`src/core/networks/chain-registry.ts`, swap/bridge services,
manifest). No "best / safest / #1 / guaranteed" language; no unshipped features.
Replace `<placeholder>` values before submitting.

## Name

simpl — self-custodial crypto wallet

## Short description (≤132 chars)

> Self-custodial multi-chain crypto wallet: manage, send, receive, swap and
> bridge across Ethereum, Solana, Bitcoin, TRON, TON & more.

## Full description

> simpl is a clean, self-custodial multi-chain crypto wallet for everyday Web3.
> Your keys stay on your device — simpl never takes custody of your funds and
> never sends your recovery phrase or private keys to any server.
>
> **Supported networks:** Ethereum, BNB Chain, Base, Solana, Bitcoin, TRON and
> TON (plus Sepolia, Bitcoin Testnet and Solana Devnet for testing).
>
> **What you can do**
> • Create or import a wallet with a standard recovery phrase, or import a
>   private key; add watch-only accounts to track any address.
> • Manage multiple accounts and view your portfolio with per-asset detail.
> • Send and receive on every supported network.
> • Swap tokens on the same chain and bridge assets across chains, with a clear
>   fee and price-impact breakdown and a minimum-received amount before you confirm.
> • Connect to dApps via an injected provider and WalletConnect — with an
>   explicit approval popup for every connection, signature and transaction.
> • Control exactly which sites are connected, and revoke access at any time.
> • Back up and verify your recovery phrase, and review your Security Center.
> • Optional biometric unlock (Touch ID / Windows Hello) where your device
>   supports it.
> • Light/dark themes and multiple languages.

## Feature bullets

- Local encrypted vault — keys never leave your device
- Explicit approval for every dApp connection, signature and transaction
- Connected-sites control with per-site scope and one-tap revoke
- Multi-chain assets: Ethereum, BNB Chain, Base, Solana, Bitcoin, TRON, TON
- Same-chain swaps and cross-chain bridges with a transparent fee breakdown
- Watch-only accounts (view balances/activity, cannot sign)
- Recovery-phrase backup verification + Security Center

## What simpl does NOT do

- Does not take custody of your funds.
- Never asks for your recovery phrase outside the extension's own backup screen,
  and never uploads it or your private keys to any server.
- Does not sell or share your personal data.
- Does not silently approve dApp connections, signatures or transactions.

## Supported networks (authoritative — matches the app)

| Network | Type |
| --- | --- |
| Ethereum | mainnet |
| BNB Chain | mainnet |
| Base | mainnet |
| Solana | mainnet |
| Bitcoin | mainnet |
| TRON | mainnet |
| TON | mainnet |
| Sepolia | testnet |
| Bitcoin Testnet | testnet |
| Solana Devnet | testnet |

_No other networks are claimed._ Swaps use 0x (EVM) and Jupiter (Solana) via the
Simpl API; bridges use LI.FI via the Simpl API. Availability of a specific route
depends on those third-party providers.

## Risk disclaimer

Crypto transactions are irreversible. You are solely responsible for safely
storing your recovery phrase — if it is lost, simpl cannot recover your wallet.
Swap and bridge availability, pricing and execution depend on independent
third-party providers and networks.
