'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  error?: string;
  helperText?: string;
  label?: string;
  required?: boolean;
  variant?: 'default' | 'filled' | 'outlined';
}

/**
 * Input component with validation states and icons
 * @example
 * <Input
 *   label="Email"
 *   type="email"
 *   placeholder="Enter email"
 *   error="Invalid email"
 * />
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      icon,
      iconPosition = 'left',
      error,
      helperText,
      label,
      required,
      variant = 'default',
      className,
      disabled,
      type = 'text',
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      default: 'border border-neutral-300 bg-white',
      filled: 'border-0 bg-neutral-100',
      outlined: 'border-2 border-neutral-300 bg-transparent',
    };

    const baseStyles = cn(
      'w-full px-3 py-2.5 rounded-lg',
      'font-sm text-neutral-900 placeholder-neutral-500',
      'transition-colors duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500',
      'disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed',
      error && 'border-red-500 focus:ring-red-500'
    );

    const wrapperClass = icon ? (iconPosition === 'left' ? 'pl-10' : 'pr-10') : '';

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}

        <div className="relative w-full">
          {icon && iconPosition === 'left' && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none flex items-center">
              {icon}
            </div>
          )}

          <input
            ref={ref}
            type={type}
            disabled={disabled}
            className={cn(baseStyles, variantStyles[variant], wrapperClass, className)}
            {...props}
          />

          {icon && iconPosition === 'right' && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none flex items-center">
              {icon}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        {helperText && !error && <p className="text-sm text-neutral-600 mt-1">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';

/**
 * Textarea component
 */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  helperText?: string;
  label?: string;
  required?: boolean;
  rows?: number;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, helperText, label, required, rows = 4, className, disabled, ...props }, ref) => {
    const baseStyles = cn(
      'w-full px-3 py-2.5 rounded-lg',
      'font-sm text-neutral-900 placeholder-neutral-500',
      'border border-neutral-300 bg-white',
      'transition-colors duration-200',
      'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500',
      'disabled:bg-neutral-100 disabled:text-neutral-500 disabled:cursor-not-allowed',
      'resize-none',
      error && 'border-red-500 focus:ring-red-500'
    );

    return (
      <div className="w-full">
        {label && (
          <label className="block text-sm font-medium text-neutral-700 mb-1">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        )}

        <textarea
          ref={ref}
          rows={rows}
          disabled={disabled}
          className={cn(baseStyles, className)}
          {...props}
        />

        {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        {helperText && !error && <p className="text-sm text-neutral-600 mt-1">{helperText}</p>}
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
