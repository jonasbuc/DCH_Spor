import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition placeholder:text-slate-400 focus:border-field-600 focus:ring-2 focus:ring-field-100",
        className
      )}
      {...props}
    />
  );
}
