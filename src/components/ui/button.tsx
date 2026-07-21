import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: ReactNode;
};

export function Button({ className, variant = "secondary", icon, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" &&
          "border-field-700 bg-field-700 text-white hover:bg-field-600 focus-visible:outline-field-700",
        variant === "secondary" &&
          "border-slate-200 bg-white text-ink-900 hover:border-field-600 hover:bg-field-50 focus-visible:outline-field-700",
        variant === "ghost" && "border-transparent bg-transparent text-ink-700 hover:bg-slate-100",
        variant === "danger" && "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:outline-red-700",
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
