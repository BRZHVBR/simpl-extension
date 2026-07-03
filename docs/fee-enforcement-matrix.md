# Fee Enforcement Matrix

Where and how the simpl swap/bridge fee is enforced per provider. Source of
truth (code): `src/core/trade/fee-policy.ts`. Principle: **in production a fee
must never depend on client-only logic** where it affects monetization or
compliance — it is enforced by the provider or the Simpl backend.

## Fee bounds

`SIMPL_FEE_DEFAULT_BPS = 50` (0.5%), `MIN = 0`, `MAX = 100` (1%). A configured
`VITE_SIMPLE_SWAP_FEE_BPS` outside `[0, 100]` is rejected by `isSimplFeeBpsValid`.

## Matrix

| Provider | Kind | Default | Max | Enforcement | Requires proxy | Prod | If not enforceable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x | swap | 50 bps | 100 | `provider_enforced` (`swapFeeBps`) | yes | ✅ | n/a (0x collects it) |
| LI.FI | bridge | 50 bps | 100 | `backend_authoritative` | yes | ✅ | gateway enforces; client fee is display/hint only |
| Jupiter | swap | 50 bps | 100 | `backend_authoritative` | yes | ✅ | gateway applies `platformFeeBps` |
| Pancake V2 | swap | 0 | 0 | `unsupported` | no | fallback | **no fee; must warn, not silent** |

## Enforcement modes

- **`provider_enforced`** — the provider collects the fee from a signed request
  param it honours (0x `swapFeeBps`). Not tamperable post-quote.
- **`backend_authoritative`** — the getsimpl-api gateway injects/enforces the fee
  server-side (LI.FI integrator+fee, Jupiter platform fee) and may strip client
  fee params. The client value is a request hint, never authoritative.
- **`client_display_only`** — a client can only *display* a fee. Not permitted as
  a monetized production route (none used today).
- **`unsupported`** — no fee mechanism (Pancake V2 fallback).

## Rules enforced

1. Production 0x never calls `api.0x.org` directly nor uses `VITE_0X_API_KEY` as
   a production secret (`getZeroXBaseUrl()` throws in a prod build without the
   proxy — Stage 5) → `check:proxy`.
2. LI.FI fee is **not** client-authoritative (`enforcement: backend_authoritative`)
   → `check:proxy` + `check:trade`.
3. Pancake fallback carries **no** simpl fee and `feeIsProductionSafe()` is
   `false` for it → it must surface a fallback warning and must not imply a
   monetized route.
4. The UI shows the simpl fee **separately** only when it is actually applied; a
   route with no fee never claims one; an unknown fee is shown as "unavailable",
   not hidden.

## getsimpl-api follow-ups (backend)

- Verify the swap proxy route covers **all** production 0x usage.
- Enforce the LI.FI integrator + fee server-side (do not rely on the client
  `VITE_LIFI_FEE` if the gateway whitelists/strips request fields).

These are backend-authoritative concerns; the client must not partial-fix them.
