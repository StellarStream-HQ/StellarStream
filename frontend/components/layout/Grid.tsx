'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: number | 'auto';
  gap?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  autoFlow?: 'row' | 'column' | 'dense';
  autoRows?: 'auto' | 'min' | 'max';
}

/**
 * Grid component - CSS Grid wrapper for complex layouts
 * @example
 * <Grid columns={3} gap="md">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 * </Grid>
 */
export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  (
    { columns = 'auto', gap = 'md', autoFlow = 'row', autoRows = 'auto', className, children, ...props },
    ref
  ) => {
    const gapMap = {
      xs: 'gap-1',
      sm: 'gap-2',
      md: 'gap-4',
      lg: 'gap-6',
      xl: 'gap-8',
    };

    const columnsClass =
      typeof columns === 'number'
        ? `grid-cols-${columns}`
        : 'grid-cols-auto-fit';

    const autoFlowMap = {
      row: 'auto-rows-auto',
      column: 'auto-cols-auto',
      dense: 'auto-flow-dense',
    };

    return (
      <div
        ref={ref}
        className={cn('grid', gapMap[gap], columnsClass, className)}
        style={{
          gridAutoFlow: autoFlow,
          gridAutoRows: autoRows === 'auto' ? 'auto' : autoRows === 'min' ? 'min-content' : 'max-content',
          gridTemplateColumns:
            typeof columns === 'number'
              ? `repeat(${columns}, minmax(0, 1fr))`
              : 'repeat(auto-fit, minmax(0, 1fr))',
        }}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Grid.displayName = 'Grid';
