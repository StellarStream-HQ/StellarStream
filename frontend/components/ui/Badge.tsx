"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "error" | "info" | "neutral";
  size?: "sm" | "md" | "lg";
  outline?: boolean;
  dot?: boolean;
}

/**
 * Badge component for status indicators — moon-theme (dark) optimized.
 * @example
 * <Badge variant="success">Active</Badge>
 * <Badge variant="error" outline>Failed</Badge>
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      variant = "default",
      size = "md",
      outline = false,
      dot = false,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const variantStyles = {
      default: outline
        ? "bg-transparent text-white/40 border border-white/10"
        : "bg-white/10 text-white/70",
      success: outline
        ? "bg-transparent text-emerald-400 border border-emerald-500/30"
        : "bg-emerald-500/10 text-emerald-400",
      warning: outline
        ? "bg-transparent text-amber-400 border border-amber-500/30"
        : "bg-amber-500/10 text-amber-400",
      error: outline
        ? "bg-transparent text-red-400 border border-red-500/30"
        : "bg-red-500/10 text-red-400",
      info: outline
        ? "bg-transparent text-sky-400 border border-sky-500/30"
        : "bg-sky-500/10 text-sky-400",
      neutral: outline
        ? "bg-transparent text-white/30 border border-white/10"
        : "bg-white/5 text-white/50",
    };

    const sizeStyles = {
      sm: "px-2 py-0.5 text-[10px] font-medium",
      md: "px-2.5 py-0.5 text-xs font-medium",
      lg: "px-3 py-1 text-sm font-medium",
    };

    const baseStyles =
      "inline-flex items-center gap-1.5 rounded-full whitespace-nowrap";

    return (
      <span
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              "inline-block rounded-full",
              variant === "success"
                ? "bg-emerald-400"
                : variant === "warning"
                  ? "bg-amber-400"
                  : variant === "error"
                    ? "bg-red-400"
                    : variant === "info"
                      ? "bg-sky-400"
                      : "bg-white/30",
              size === "sm"
                ? "h-1.5 w-1.5"
                : size === "lg"
                  ? "h-2.5 w-2.5"
                  : "h-2 w-2",
            )}
          />
        )}
        {children}
      </span>
    );
  },
);

Badge.displayName = "Badge";
