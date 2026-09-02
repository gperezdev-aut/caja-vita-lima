import type { CSSProperties, ReactNode } from "react";

export type BadgeTone = "default" | "good" | "warn" | "danger";

const TONE_STYLES: Record<BadgeTone, CSSProperties> = {
  default: {
    background: "white",
    color: "var(--text)",
    border: "1px solid var(--line)",
  },
  good: {
    background: "var(--green-soft)",
    color: "var(--green)",
    border: "1px solid rgba(31, 107, 79, 0.18)",
  },
  warn: {
    background: "var(--warn)",
    color: "var(--text)",
    border: "1px solid var(--line)",
  },
  danger: {
    background: "var(--danger)",
    color: "var(--danger-text)",
    border: "1px solid rgba(163, 50, 37, 0.18)",
  },
};

export function Badge({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  title?: string;
}) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: "999px",
        padding: "7px 10px",
        fontSize: "12px",
        fontWeight: 850,
        whiteSpace: "nowrap",
        ...TONE_STYLES[tone],
      }}
    >
      {children}
    </span>
  );
}
