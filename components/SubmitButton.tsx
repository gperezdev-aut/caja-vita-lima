"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel = "Guardando...",
  style,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} style={style} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
