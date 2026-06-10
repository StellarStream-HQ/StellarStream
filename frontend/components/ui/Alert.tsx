'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'info' | 'success' | 'warning' | 'error';
  icon?: React.ReactNode;
  title?: string;
  closable?: boolean;
  onClose?: () => void;
}

/**
 * Alert component for messages and notifications
 * @example
 * <Alert variant="success" title="Success!" onClose={() => {}}>
 *   Your changes have been saved.
 * </Alert>
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    { variant = 'info', icon, title, closable = false, onClose, className, children, ...props },
    ref
  ) => {
    const [isVisible, setIsVisible] = React.useState(true);

    const handleClose = () => {
      setIsVisible(false);
      onClose?.();
    };

    if (!isVisible && closable) return null;

    const variantStyles = {
      info: 'bg-sky-50 text-sky-900 border border-sky-200',
      success: 'bg-green-50 text-green-900 border border-green-200',
      warning: 'bg-amber-50 text-amber-900 border border-amber-200',
      error: 'bg-red-50 text-red-900 border border-red-200',
    };

    const baseStyles = 'rounded-lg p-4 flex gap-3';

    return (
      <div ref={ref} className={cn(baseStyles, variantStyles[variant], className)} {...props}>
        {icon && <div className="flex-shrink-0 mt-0.5">{icon}</div>}

        <div className="flex-1">
          {title && <h4 className="font-semibold mb-1">{title}</h4>}
          {children && <p className="text-sm">{children}</p>}
        </div>

        {closable && (
          <button
            onClick={handleClose}
            className="flex-shrink-0 text-current opacity-70 hover:opacity-100 transition-opacity"
            aria-label="Close alert"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  }
);

Alert.displayName = 'Alert';
