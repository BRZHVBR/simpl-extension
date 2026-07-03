// src/ui/primitives/index.tsx
//
// Minimal shared UI primitives + design tokens for the premium/minimalist simpl
// style (black/white, strict lines, no emoji-as-icons). Opt-in — screens adopt
// them incrementally to replace ad-hoc inline styles, especially in risk /
// approval surfaces. Uses the existing CSS variable palette; does not change
// brand colors. All tone → color mapping lives here (one source).

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type RiskTone = "info" | "warning" | "danger" | "blocked";
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type SurfaceTone = "base" | "raised" | "subtle";

// Tone → CSS variables (background / border / foreground). "blocked" reuses the
// danger palette with a stronger foreground.
export const TONE_STYLE: Record<RiskTone, { bg: string; border: string; fg: string }> = {
  info: { bg: "var(--bg-muted, #f4f4f5)", border: "var(--line, #e4e4e7)", fg: "var(--ink-2, #3f3f46)" },
  warning: { bg: "var(--warn-soft, #fef6e7)", border: "var(--warn-soft, #f5d78a)", fg: "var(--warn, #8a6d1a)" },
  danger: { bg: "var(--danger-soft, #fdecec)", border: "var(--danger-soft, #f3b4b4)", fg: "var(--danger, #b42318)" },
  blocked: { bg: "var(--danger-soft, #fdecec)", border: "var(--danger, #b42318)", fg: "var(--danger, #b42318)" },
};

export const SURFACE_STYLE: Record<SurfaceTone, { bg: string; border: string }> = {
  base: { bg: "var(--bg-surface, #fff)", border: "var(--line, #e4e4e7)" },
  raised: { bg: "var(--bg-surface, #fff)", border: "var(--border, var(--line, #e4e4e7))" },
  subtle: { bg: "var(--bg-muted, #f4f4f5)", border: "var(--line, #e4e4e7)" },
};

// Map a variant to the existing global `.btn` classes so styling stays
// consistent with the rest of the app.
export function buttonClassName(variant: ButtonVariant): string {
  switch (variant) {
    case "primary":
      return "btn primary";
    case "secondary":
      return "btn secondary";
    case "ghost":
      return "btn ghost";
    case "danger":
      return "btn danger";
  }
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  full?: boolean;
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  full = false,
  loading = false,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [
    buttonClassName(variant),
    size === "lg" ? "lg" : "",
    full ? "full" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading ? "…" : children}
    </button>
  );
}

export function Alert({ tone, title, children }: { tone: RiskTone; title?: string; children?: ReactNode }) {
  const s = TONE_STYLE[tone];
  return (
    <div
      role={tone === "danger" || tone === "blocked" ? "alert" : "status"}
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 12,
        lineHeight: "17px",
        fontWeight: 650,
      }}
    >
      {title ? <div style={{ fontWeight: 800, marginBottom: children ? 2 : 0 }}>{title}</div> : null}
      {children}
    </div>
  );
}

export function Badge({ tone = "info", children }: { tone?: RiskTone; children: ReactNode }) {
  const s = TONE_STYLE[tone];
  return (
    <span
      style={{
        background: s.bg,
        border: `1px solid ${s.border}`,
        color: s.fg,
        borderRadius: 999,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Card({ tone = "raised", children, style }: { tone?: SurfaceTone; children: ReactNode; style?: React.CSSProperties }) {
  const s = SURFACE_STYLE[tone];
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 16, padding: 16, ...style }}>
      {children}
    </div>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>{children}</div>;
}

export function Section({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return <section style={{ display: "grid", gap: 12, ...style }}>{children}</section>;
}

export function Skeleton({ width = "100%", height = 16 }: { width?: number | string; height?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: 8,
        background: "linear-gradient(90deg, var(--bg-muted, #eee) 25%, var(--line, #ddd) 50%, var(--bg-muted, #eee) 75%)",
      }}
    />
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-3, #888)" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "var(--ink-1, #111)" }}>{title}</div>
      {description ? <div style={{ marginTop: 6, fontSize: 12, lineHeight: "17px" }}>{description}</div> : null}
    </div>
  );
}

export function CopyButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  return (
    <button
      type="button"
      className="btn ghost"
      aria-label={label}
      onClick={(e) => {
        void navigator.clipboard?.writeText(value).catch(() => {});
        const el = e.currentTarget;
        const original = el.textContent;
        el.textContent = copiedLabel;
        window.setTimeout(() => {
          el.textContent = original;
        }, 1500);
      }}
    >
      {label}
    </button>
  );
}
