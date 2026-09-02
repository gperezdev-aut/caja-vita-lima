import type { ReactNode } from "react";

export function FormField({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="formField">
      {label}
      {children}
    </label>
  );
}
