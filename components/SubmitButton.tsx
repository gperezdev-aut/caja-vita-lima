"use client";

import type { CSSProperties, ReactNode } from "react";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingLabel = "Guardando...",
  style,
}: {
  children: ReactNode;
  pendingLabel?: string;
  style?: CSSProperties;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} style={style}>
      {pending ? pendingLabel : children}
    </button>
  );
}
