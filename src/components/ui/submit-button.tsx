"use client";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./index";

/** A submit button that shows it is working while its form's server action runs (long AI calls). */
export function SubmitButton({ children, pending, variant = "primary", className = "" }: { children: ReactNode; pending: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  const s = useFormStatus();
  return (
    <button type="submit" disabled={s.pending} aria-busy={s.pending} className={`${buttonClass(variant)} ${className}`}>
      {s.pending ? pending : children}
    </button>
  );
}
