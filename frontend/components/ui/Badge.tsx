'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  outline?: boolean;
  dot?: boolean;
}

/**
 * Badge component for status indicators
 * @example
 * <Badge variant="success">Active</Badge>
 * <Badge variant="error" outline>Failed</Badge>
 */
export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'default', size = 'md', outline = false, dot = false, className, children, ...props }, ref) => {
    const variantStyles = {
      default: outline
        ? 'bg-transparent text-neutral-700 border border-neutral-300'
        : 'bg-neutral-200 text-neutral-800',
      success: outline
        ? 'bg-transparent text-green-700 border border-green-300'
        : 'bg-green-100 text-green-800',
      warning: outline
        ? 'bg-transparent text-amber-700 border border-amber-300'
        : 'bg-amber-100 text-amber-800',
      error: outline
        ? 'bg-transparent text-red-700 border border-red-300'
        : 'bg-red-100 text-red-800',
      info: outline
        ? 'bg-transparent text-sky-700 border border-sky-300'
        : 'bg-sky-100 text-sky-800',
      neutral: outline
        ? 'bg-transparent text-neutral-600 border border-neutral-300'
        : 'bg-neutral-100 text-neutral-700',
    };

    const sizeStyles = {
      sm: 'px-2 py-0.5 text-xs font-medium',
      md: 'px-2.5 py-0.5 text-sm font-medium',
      lg: 'px-3 py-1 text-base font-medium',
    };

    const baseStyles = 'inline-flex items-center gap-1.5 rounded-full whitespace-nowrap';

    return (
      <span
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              'inline-block rounded-full',
              variant === 'success'
                ? 'bg-green-600'
                : variant === 'warning'
                  ? 'bg-amber-600'
                  : variant === 'error'
                    ? 'bg-red-600'
                    : variant === 'info'
                      ? 'bg-sky-600'
                      : 'bg-neutral-600',
              size === 'sm' ? 'w-1.5 h-1.5' : size === 'lg' ? 'w-2.5 h-2.5' : 'w-2 h-2'
            )}
          />
        )}
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
