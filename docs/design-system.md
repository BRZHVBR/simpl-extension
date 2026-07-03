# Design System

The minimal shared UI layer for the simpl style: **minimalist black/white,
premium fintech, strict lines, no emoji-as-icons**. It does not change brand
colors; it centralizes tone/variant styling so screens (especially risk /
approval) stop hand-rolling inline styles.

## Tokens

- `RiskTone = 'info' | 'warning' | 'danger' | 'blocked'` — maps to the existing
  CSS-variable palette (`--ink-*`, `--warn*`, `--danger*`, `--line`, `--bg-*`) in
  one place (`TONE_STYLE`). `blocked` uses the danger palette with a stronger
  border/foreground.
- `ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'` — maps to the
  existing global `.btn` classes (`buttonClassName`).
- `SurfaceTone = 'base' | 'raised' | 'subtle'` — card/surface backgrounds.

## Primitives (`src/ui/primitives`)

`Button` (variants + `size`, `full`, `loading` → disabled + `aria-busy`),
`Alert` (tone + optional title; `role=alert` for danger/blocked, else `status`),
`Badge`, `Card`, `Row`, `Section`, `Skeleton`, `EmptyState`, `CopyButton`.

Opt-in: screens adopt them incrementally to replace ad-hoc inline styles. Risk /
approval surfaces are the priority; adoption there is ongoing (the approval
screens keep their current structure — see below — while chain labels and tone
mapping are already centralized).

## Chain labels (`src/core/networks/chain-display.ts`)

`getChainLabel(chainId)`, `getChainNamespace(chainId)`, `getChainIcon(chainId)`,
`formatChainBadge(chainId)`, `isKnownChain(chainId)` — all backed by
`chain-registry.ts`. No hardcoded per-screen chain subsets. Unknown chains render
safely as **"Unknown network"** / `Unknown network (<id>)` and never throw. The
dApp approval screen now uses `formatChainBadge` instead of a hardcoded map.

## Approval screen structure (target)

Header (site/app name · origin · source Browser dApp / WalletConnect) · Request
summary · Account/chain context (shortened address, network via chain-display) ·
Risk section (plain language, no panic; clear warning for signing/send) · Details
(expandable, sanitized payload only — never seed/private key/raw secrets) ·
Actions (Reject / Approve, disabled when invalid/expired/locked) · Locked state
(unlock path, Stage 4) · Expired state (no approve). Emoji are not used as risk
icons.

## Accessibility baseline

- Buttons carry accessible labels; `Button` sets `aria-busy` when loading.
- `Alert` uses `role=alert` for danger/blocked and `role=status` otherwise.
- Lazy routes show a non-empty `role=status` fallback (no blank flash) and a
  `RouteErrorBoundary` with a retry.
- Long addresses/payloads wrap; popup 360×600 scroll is preserved; critical
  flows avoid layout jumps.

## Enforced by

`npm run check:ui` (renders each primitive variant to static markup + verifies
chain-label safety) — part of `npm run check:release`.
