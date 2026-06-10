'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface DividerProps extends React.HTMLAttributes<HTMLHRElement> {
  variant?: 'solid' | 'dashed' | 'dotted';
  spacing?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  vertical?: boolean;
}

/**
 * Divider component for visual separation
 * @example
 * <Divider />
 * <Divider variant="dashed" spacing="lg" />
 */
export const Divider = React.forwardRef<HTMLHRElement, DividerProps>(
  ({ variant = 'solid', spacing = 'md', vertical = false, className, ...props }, ref) => {
    const spacingMap = {
      xs: vertical ? 'mx-1' : 'my-1',
      sm: vertical ? 'mx-2' : 'my-2',
      md: vertical ? 'mx-4' : 'my-4',
      lg: vertical ? 'mx-6' : 'my-6',
      xl: vertical ? 'mx-8' : 'my-8',
    };

    const variantMap = {
      solid: 'border-solid',
      dashed: 'border-dashed',
      dotted: 'border-dotted',
    };

    if (vertical) {
      return (
        <div
          className={cn(
            'inline-block border-l border-neutral-300',
            spacingMap[spacing],
            className
          )}
          style={{ height: '100%' }}
          {...props}
        />
      );
    }

    return (
      <hr
        ref={ref}
        className={cn(
          'border-0 border-t border-neutral-300',
          variantMap[variant],
          spacingMap[spacing],
          className
        )}
        {...props}
      />
    );
  }
);

Divider.displayName = 'Divider';
