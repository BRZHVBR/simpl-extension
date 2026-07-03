# simpl — Privacy Policy

_Last updated: `<date>`. Contact: support@getsimpl.io_

simpl is a self-custodial browser wallet. This policy describes what stays on
your device, what is sent to third-party networks to make the wallet work, and
what is never collected. It reflects the actual behavior of the extension.

## Stored locally on your device (never on simpl servers)

- Your **encrypted vault** (recovery phrase / private keys), encrypted with a key
  derived from your password.
- Accounts and addresses, selected network, and preferences (theme, language).
- Connected-sites permissions and the local audit trail of approvals.
- Activity/portfolio cache and any custom RPC configuration you add.
- Backup status (whether your recovery phrase has been verified).

Your **recovery phrase and private keys are never sent to simpl servers** and
never leave your device unencrypted. Your password is never stored or logged.

## Sent to third-party network providers (to make the wallet function)

Using any blockchain wallet inherently reveals some data to the networks you
interact with:

- **Public account addresses** — sent to RPC nodes / block APIs to read balances,
  activity and history.
- **Transaction data** — signed/raw transactions are broadcast to the network.
- **Swap/bridge quote parameters** — token pair, amount and your address (as
  taker/recipient) are sent to the quote provider (via the Simpl API).
- **RPC requests** and **WalletConnect pairing metadata** for connected sessions.

The exact hosts are listed in `docs/endpoint-inventory.md`. Requests to the Simpl
API gateway (`api.getsimpl.io`) proxy price/swap/bridge providers; upstream API
keys are held server-side, not in the extension.

## Not collected

simpl does not collect, transmit for analytics, or sell: your recovery phrase,
private keys, password, biometric secrets, or raw signatures. There is no
analytics/telemetry SDK. Production builds do not log sensitive payloads
(addresses, raw transactions, signatures, or dApp request payloads) — this is
enforced by an automated check (`npm run check:privacy`).

## Third-party providers

Blockchain RPC nodes (PublicNode, drpc, TronGrid, Solana public RPC, Bitcoin
Esplora), the Simpl API gateway, 0x / Jupiter (swaps), LI.FI (bridges), the
WalletConnect/Reown relay, and IPFS/Arweave gateways for token metadata. Each
processes data under its own policy.

## Logs & diagnostics

Diagnostics are local-only and gated to development builds; production builds do
not emit sensitive payloads to the console or storage.

## Your controls

Lock the wallet; revoke any connected site; add/remove a custom RPC; back up and
verify your recovery phrase; and clear all local data by removing the extension.

## Data retention

All wallet data is stored locally and retained until you remove it or uninstall
the extension. simpl does not retain your wallet data on its servers.

## Changes

We may update this policy; material changes will be reflected here with a new
date.
